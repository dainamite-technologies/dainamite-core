import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BillingAccountBalance,
  BillingAccountTransaction,
} from '../data/entities'
import type { TransactionType } from '../data/validators'
import { fromUnits, subMoney, toUnits } from './money'

/**
 * Prepaid balance ledger (SPEC-002).
 *
 * Two append-only primitives back every balance change:
 *   - `BillingAccountBalance` — the O(1) running-balance cache, one row per
 *     prepaid account; the row the atomic `UPDATE … RETURNING` locks.
 *   - `BillingAccountTransaction` — the source of truth; `balance == SUM(amount)`.
 *
 * Concurrency correctness: the single-statement `UPDATE … RETURNING`
 * serializes via the Postgres row lock on the balance row, so N concurrent
 * uploads apply N debits with no lost update and each gets a distinct
 * `balance_after`. The transaction insert in the SAME DB transaction carries
 * that exact snapshot.
 *
 * **All functions here MUST be called inside an `em.transactional(...)`** so
 * the balance move and the transaction insert commit (or roll back) together.
 */

// Sentinel `rated_in_bill_run_id` stamped on a usage record the moment it is
// rated in real time, so a postpaid-style Bill Run never re-rates it. It is a
// fixed, recognizable UUID (not a real run id) — its presence simply means
// "already rated at ingest, paired with a BillingAccountTransaction".
export const PREPAID_USAGE_SENTINEL_RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

export type BalanceRowInit = {
  organizationId: string
  tenantId: string
  billAccountId: string
  currencyCode: string
  lowBalanceThreshold?: string | null
}

/**
 * Find-or-create the 1:1 balance row for an account. Idempotent — safe to
 * call on every prepaid account create. Uses the ORM (this runs at account
 * create, not on the hot consume path).
 */
export async function ensureBalanceRow(
  em: EntityManager,
  init: BalanceRowInit,
): Promise<BillingAccountBalance> {
  const existing = await em.findOne(BillingAccountBalance, {
    tenantId: init.tenantId,
    billAccountId: init.billAccountId,
  })
  if (existing) {
    // Allow create-time threshold to land even if a prior (defensive) row
    // already exists with no threshold set.
    if (
      init.lowBalanceThreshold !== undefined &&
      init.lowBalanceThreshold !== null &&
      (existing.lowBalanceThreshold === null || existing.lowBalanceThreshold === undefined)
    ) {
      existing.lowBalanceThreshold = init.lowBalanceThreshold
      existing.updatedAt = new Date()
    }
    return existing
  }
  const now = new Date()
  const row = em.create(BillingAccountBalance, {
    organizationId: init.organizationId,
    tenantId: init.tenantId,
    billAccountId: init.billAccountId,
    currencyCode: init.currencyCode,
    balance: '0',
    lowBalanceThreshold: init.lowBalanceThreshold ?? null,
    lastMovementAt: null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(row)
  await em.flush()
  return row
}

export type ApplyMovementParams = {
  organizationId: string
  tenantId: string
  billAccountId: string
  currencyCode: string
  /** Transaction type. */
  type: TransactionType
  /** SIGNED amount: > 0 credit, < 0 debit. */
  amount: string
  description: string
  usageId?: string | null
  billingItemId?: string | null
  topupId?: string | null
  statementId?: string | null
  /** Idempotency key — when set, a duplicate is a no-op (returns the prior row). */
  sourceRef?: string | null
  metadata?: Record<string, unknown> | null
  userId?: string | null
}

export type ApplyMovementResult = {
  /** Running balance BEFORE this movement (4dp string). */
  balanceBefore: string
  /** Running balance AFTER this movement — authoritative (4dp string). */
  balanceAfter: string
  transaction: BillingAccountTransaction
  /** True when `sourceRef` already existed — no balance was moved. */
  deduplicated: boolean
}

/**
 * Atomically move the balance and append the paired transaction.
 *
 * Idempotent on `sourceRef`: if a transaction with the same
 * `(tenant_id, bill_account_id, source_ref)` already exists, NO balance move
 * happens and the existing row is returned (`deduplicated: true`). The unique
 * constraint is the correctness backstop if a race slips past the pre-check —
 * the duplicate insert fails and rolls back the whole (caller's) transaction,
 * so the balance move is undone too. Never double-moves.
 */
export async function applyBalanceMovement(
  em: EntityManager,
  params: ApplyMovementParams,
): Promise<ApplyMovementResult> {
  if (params.sourceRef) {
    const existing = await em.findOne(BillingAccountTransaction, {
      tenantId: params.tenantId,
      billAccountId: params.billAccountId,
      sourceRef: params.sourceRef,
      deletedAt: null,
    })
    if (existing) {
      return {
        balanceBefore: subMoney(existing.balanceAfter, existing.amount),
        balanceAfter: existing.balanceAfter,
        transaction: existing,
        deduplicated: true,
      }
    }
  }

  const now = new Date()
  // Self-healing: ensure the balance row exists (race-safe via the unique
  // constraint), then the atomic single-statement move. `amount` is signed
  // so one statement covers both credit and debit.
  await em.execute(
    `INSERT INTO billing_account_balances
       (id, organization_id, tenant_id, bill_account_id, currency_code, balance, created_at, updated_at)
     VALUES (gen_random_uuid(), ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT (tenant_id, bill_account_id) DO NOTHING`,
    [
      params.organizationId,
      params.tenantId,
      params.billAccountId,
      params.currencyCode,
      now,
      now,
    ],
  )
  const rows = (await em.execute(
    `UPDATE billing_account_balances
        SET balance = balance + ?, last_movement_at = ?, updated_at = ?
      WHERE tenant_id = ? AND bill_account_id = ?
      RETURNING balance`,
    [params.amount, now, now, params.tenantId, params.billAccountId],
  )) as unknown as Array<{ balance: string }>

  if (!rows || rows.length === 0) {
    // Should be unreachable — the upsert above guarantees a row exists.
    throw new Error(
      `balanceLedger: balance row missing for account ${params.billAccountId} after upsert`,
    )
  }
  // Normalize whatever the driver hands back (string or number) to 4dp.
  const balanceAfter = fromUnits(toUnits(rows[0].balance))
  const balanceBefore = subMoney(balanceAfter, params.amount)

  const transaction = em.create(BillingAccountTransaction, {
    organizationId: params.organizationId,
    tenantId: params.tenantId,
    billAccountId: params.billAccountId,
    type: params.type,
    amount: params.amount,
    currencyCode: params.currencyCode,
    balanceAfter,
    usageId: params.usageId ?? null,
    billingItemId: params.billingItemId ?? null,
    topupId: params.topupId ?? null,
    statementId: params.statementId ?? null,
    description: params.description,
    sourceRef: params.sourceRef ?? null,
    metadata: params.metadata ?? null,
    userId: params.userId ?? null,
    createdAt: now,
  })
  em.persist(transaction)
  await em.flush()

  return { balanceBefore, balanceAfter, transaction, deduplicated: false }
}

export type ReconcileResult = {
  /** The denormalized running balance (cache). */
  cachedBalance: string
  /** SUM(amount) over all (non-deleted) transactions. */
  sumOfAmounts: string
  /** The most recent transaction's balance_after, or '0.0000' if none. */
  latestBalanceAfter: string
  /** True when all three agree. */
  reconciled: boolean
}

/**
 * Assert the ledger invariant for one account:
 * `cachedBalance == SUM(amount) == latest.balance_after`.
 *
 * The optional reconciliation worker (P5) runs this per account and alerts on
 * drift — a cheap guard against any future non-atomic write slipping in.
 */
export async function reconcileAccountBalance(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string; billAccountId: string },
): Promise<ReconcileResult> {
  const balanceRow = await em.findOne(BillingAccountBalance, {
    tenantId: scope.tenantId,
    billAccountId: scope.billAccountId,
  })
  const cachedBalance = balanceRow ? fromUnits(toUnits(balanceRow.balance)) : '0.0000'

  const sumRows = (await em.execute(
    `SELECT COALESCE(SUM(amount), 0) AS sum_amount
       FROM billing_account_transactions
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ? AND deleted_at IS NULL`,
    [scope.tenantId, scope.organizationId, scope.billAccountId],
  )) as unknown as Array<{ sum_amount: string }>
  const sumOfAmounts = fromUnits(toUnits(sumRows?.[0]?.sum_amount ?? 0))

  const latest = await em.findOne(
    BillingAccountTransaction,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      billAccountId: scope.billAccountId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'DESC' } },
  )
  const latestBalanceAfter = latest ? fromUnits(toUnits(latest.balanceAfter)) : '0.0000'

  const reconciled =
    toUnits(cachedBalance) === toUnits(sumOfAmounts) &&
    (latest === null || toUnits(cachedBalance) === toUnits(latestBalanceAfter))

  return { cachedBalance, sumOfAmounts, latestBalanceAfter, reconciled }
}
