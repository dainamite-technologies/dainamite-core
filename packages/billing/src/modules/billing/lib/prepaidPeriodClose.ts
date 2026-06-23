import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BillingAccount,
  BillingAccountBalance,
  BillingAccountTransaction,
  BillingItem,
  BillingStatement,
  BillRun,
} from '../data/entities'
import type { BillCycle } from '../data/validators'
import { advanceNextBillDate, addDays, deriveBillPeriod, isCycleDue, type BillPeriod } from './billPeriod'
import { applyBalanceMovement } from './balanceLedger'
import { resolveLowBalanceThreshold } from './balanceStatus'
import { buildInvoiceLinesFromItems } from './invoiceWriter'
import { selectItemsForPeriod, type SelectableItem } from './itemSelector'
import { absMoney, addMoney, fromUnits, subMoney, toUnits } from './money'
import {
  getLowBalanceThresholdDefault,
  getNearLimitBufferDefault,
  getStatementEnabled,
} from './prepaidConfig'
import { buildBalanceCrossingEvents, type DomainEvent } from './balanceEvents'

/**
 * Prepaid period close (SPEC-002 P3).
 *
 * A prepaid account never gets a payable draft invoice. Instead the Bill Run,
 * for a due prepaid account:
 *   1. charges its `recurring` / `one_time` items to the **balance** (atomic
 *      debit + transaction, deterministic `source_ref =
 *      recurring-{itemId}-{periodEndISO}`, then `billed_to_date = period_end`),
 *   2. builds a non-fiscal **BillingStatement** (opening, topups, usage,
 *      recurring, closing + per-item breakdown).
 *
 * Metered usage was already rated + debited in real time during the period —
 * it is NOT re-rated here; the statement only summarizes it.
 *
 * Three anti-duplicate guards: the statement unique
 * `(bill_account_id, period_start, period_end)`, the per-item `billed_to_date`,
 * and the deterministic charge `source_ref`.
 */

export type PrepaidCloseMode = 'real' | 'test' | 'dry'

export type PrepaidAccountWarnings = {
  // Reserved for future per-close warnings (e.g. negative-balance close).
  closed_negative?: boolean
}

export type PrepaidAccountResult =
  | {
      status: 'success' | 'success_with_warnings' | 'skipped_existing_statement'
      warnings: PrepaidAccountWarnings | null
      statementId: string | null
      cyclesEmitted: number
      statementEvents: DomainEvent[]
    }
  | { status: 'failed'; errorMessage: string }

const SCHEDULED_CYCLE_LIMIT = 1
const CATCH_UP_HARD_CAP = 60

export type ProcessPrepaidParams = {
  asOfDate: Date
  mode: PrepaidCloseMode
  triggeredBy: 'schedule' | 'manual'
  catchUp?: boolean
}

/**
 * Multi-cycle prepaid account processing (mirrors the postpaid engine's
 * catch-up loop). One statement + one set of recurring debits per missed
 * period — never combined.
 */
export async function processPrepaidAccount(
  em: EntityManager,
  account: BillingAccount,
  billRun: BillRun,
  params: ProcessPrepaidParams,
): Promise<PrepaidAccountResult> {
  const maxCycles =
    params.triggeredBy === 'schedule' || !params.catchUp
      ? SCHEDULED_CYCLE_LIMIT
      : CATCH_UP_HARD_CAP

  const statementEnabled = await getStatementEnabled(em)
  // Resolve the crossing thresholds once — they don't change during the run.
  const balanceRow = await em.findOne(BillingAccountBalance, {
    tenantId: account.tenantId,
    billAccountId: account.id,
  })
  const threshold = resolveLowBalanceThreshold(
    balanceRow?.lowBalanceThreshold ?? null,
    await getLowBalanceThresholdDefault(em),
  )
  const nearLimitBuffer = await getNearLimitBufferDefault(em)
  const creditLimit = account.creditLimit ?? '0'

  let cyclesEmitted = 0
  let lastStatementId: string | null = null
  const statementEvents: DomainEvent[] = []
  // Chain opening → closing across cycles in a catch-up run. Null on the first
  // cycle → closePrepaidPeriod resolves it from the prior statement / ledger.
  let previousClosing: string | null = null

  while (cyclesEmitted < maxCycles && isCycleDue(account.nextBillDate, params.asOfDate)) {
    const period = deriveBillPeriod(account.nextBillDate, account.billCycle as BillCycle)

    // Statement anti-duplicate (only when we would actually persist).
    if (params.mode !== 'dry') {
      const existing = await em.findOne(BillingStatement, {
        tenantId: account.tenantId,
        billAccountId: account.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      })
      if (existing) {
        return {
          status: 'skipped_existing_statement',
          warnings: null,
          statementId: existing.id,
          cyclesEmitted,
          statementEvents,
        }
      }
    }

    const cycle = await closePrepaidPeriod(em, account, period, billRun, {
      mode: params.mode,
      statementEnabled,
      previousClosing,
      threshold,
      nearLimitBuffer,
      creditLimit,
    })
    previousClosing = cycle.closingBalance
    // Recurring charges move the balance too, so they can trip the same
    // low/exhausted/over_limit crossings as a usage debit (SPEC-002). These
    // are accumulated and emitted by the engine AFTER the run commits.
    statementEvents.push(...cycle.crossingEvents)

    // A negative closing balance is NORMAL for prepaid (the customer overspent;
    // it's cleared by the next top-up), so it is not flagged as a warning.
    if (cycle.statementId) {
      lastStatementId = cycle.statementId
      statementEvents.push({
        id: 'billing.statement.generated',
        payload: {
          statementId: cycle.statementId,
          billAccountId: account.id,
          tenantId: account.tenantId,
          organizationId: account.organizationId,
          billRunId: billRun.id,
          periodStart: period.periodStart.toISOString().slice(0, 10),
          periodEnd: period.periodEnd.toISOString().slice(0, 10),
          currencyCode: account.currencyCode,
          openingBalance: cycle.openingBalance,
          closingBalance: cycle.closingBalance,
          totalTopups: cycle.totalTopups,
          totalUsage: cycle.totalUsage,
          totalRecurring: cycle.totalRecurring,
          totalAdjustments: cycle.totalAdjustments,
        },
      })
    }

    if (params.mode === 'real') {
      account.nextBillDate = advanceNextBillDate(
        account.nextBillDate,
        account.billCycle as BillCycle,
      )
      account.lastBillDate = period.periodEnd
      account.updatedAt = new Date()
      await em.flush()
    } else {
      // test / dry: do not advance state; one iteration only.
      cyclesEmitted += 1
      break
    }
    cyclesEmitted += 1
  }

  return {
    status: 'success',
    warnings: null,
    statementId: lastStatementId,
    cyclesEmitted,
    statementEvents,
  }
}

type ClosePeriodResult = {
  statementId: string | null
  openingBalance: string
  totalTopups: string
  totalUsage: string
  totalRecurring: string
  totalAdjustments: string
  closingBalance: string
  crossingEvents: DomainEvent[]
}

type DebitBreakdownEntry = {
  billing_item_id: string
  billing_type: string
  uom_code?: string
  quantity: string
  amount: string
}

async function closePrepaidPeriod(
  em: EntityManager,
  account: BillingAccount,
  period: BillPeriod,
  billRun: BillRun,
  opts: {
    mode: PrepaidCloseMode
    statementEnabled: boolean
    previousClosing: string | null
    threshold: string
    nearLimitBuffer: string
    creditLimit: string
  },
): Promise<ClosePeriodResult> {
  const periodEndISO = period.periodEnd.toISOString().slice(0, 10)

  // Recurring + one_time items eligible for this period (usage excluded by the
  // selector — it was rated in real time).
  const items = await em.find(BillingItem, {
    tenantId: account.tenantId,
    organizationId: account.organizationId,
    billAccountId: account.id,
    deletedAt: null,
  } as never)
  const { included } = selectItemsForPeriod(items as unknown as SelectableItem[], period)
  const billableItems = included as unknown as BillingItem[]
  const lines = buildInvoiceLinesFromItems(billableItems)

  // Window bounds for categorized sums (topups / usage already in the ledger).
  const windowStart = period.periodStart
  const windowEnd = addDays(period.periodEnd, 1) // exclusive upper bound

  // Opening chains from the prior statement's closing — NOT a created_at sum.
  // Recurring debits are stamped at run time (after period_end), so a
  // `SUM(amount WHERE created_at < period_start)` would drop the prior period's
  // recurring charge and break the chain. Resolution order:
  //   1. previous cycle's closing (catch-up, in this run),
  //   2. the prior persisted statement's closing (month-over-month),
  //   3. the ledger balance before the first-ever statement window.
  const openingBalance = await resolveOpeningBalance(em, account, period, opts.previousClosing)
  const totalTopups = await sumByTypeInWindow(em, account, 'topup', windowStart, windowEnd)
  const totalUsage = absMoney(
    await sumByTypeInWindow(em, account, 'usage', windowStart, windowEnd),
  )
  // Manual adjustments / reversals that landed in the window — SIGNED (a credit
  // is +, a debit −). Kept as a first-class term so the statement is
  // self-consistent and the opening→closing chain never drifts.
  const totalAdjustments = addMoney(
    await sumByTypeInWindow(em, account, 'adjustment', windowStart, windowEnd),
    await sumByTypeInWindow(em, account, 'reversal', windowStart, windowEnd),
  )

  let totalRecurring = '0.0000'
  const breakdown: DebitBreakdownEntry[] = []
  const chargeTransactionIds: string[] = []
  // The balance just before / after the recurring batch — for crossing events.
  let recurringBalanceBefore: string | null = null
  let recurringBalanceAfter: string | null = null

  if (opts.mode === 'real') {
    const now = new Date()
    for (const line of lines) {
      const movement = await applyBalanceMovement(em, {
        organizationId: account.organizationId,
        tenantId: account.tenantId,
        billAccountId: account.id,
        currencyCode: account.currencyCode,
        type: line.billingType === 'one_time' ? 'one_time' : 'recurring',
        amount: fromUnits(-toUnits(line.totalNetAmount)),
        description: line.description,
        billingItemId: line.billingItemId,
        sourceRef: `recurring-${line.billingItemId}-${periodEndISO}`,
        metadata: {
          bill_period_start: period.periodStart.toISOString().slice(0, 10),
          bill_period_end: periodEndISO,
          bill_run_id: billRun.id,
        },
      })
      if (recurringBalanceBefore === null) recurringBalanceBefore = movement.balanceBefore
      recurringBalanceAfter = movement.balanceAfter
      totalRecurring = addMoney(totalRecurring, line.totalNetAmount)
      if (!movement.deduplicated) chargeTransactionIds.push(movement.transaction.id)
      breakdown.push({
        billing_item_id: line.billingItemId,
        billing_type: line.billingType,
        quantity: line.quantity,
        amount: line.totalNetAmount,
      })
      const item = billableItems.find((it) => it.id === line.billingItemId)
      if (item) {
        item.billedToDate = period.periodEnd
        item.updatedAt = now
      }
    }
    await em.flush()
  } else {
    // test / dry: compute the would-be charges, persist nothing.
    for (const line of lines) {
      totalRecurring = addMoney(totalRecurring, line.totalNetAmount)
      breakdown.push({
        billing_item_id: line.billingItemId,
        billing_type: line.billingType,
        quantity: line.quantity,
        amount: line.totalNetAmount,
      })
    }
  }

  // closing = opening + topups + adjustments − usage − recurring.
  const closingBalance = subMoney(
    subMoney(addMoney(addMoney(openingBalance, totalTopups), totalAdjustments), totalUsage),
    totalRecurring,
  )

  // The recurring batch can push the balance low / exhausted / over-limit —
  // emit those crossings (real mode only; dry/test never move the balance).
  const crossingEvents =
    recurringBalanceBefore !== null && recurringBalanceAfter !== null
      ? buildBalanceCrossingEvents({
          scope: {
            billAccountId: account.id,
            tenantId: account.tenantId,
            organizationId: account.organizationId,
            currencyCode: account.currencyCode,
          },
          balanceBefore: recurringBalanceBefore,
          balanceAfter: recurringBalanceAfter,
          threshold: opts.threshold,
          creditLimit: opts.creditLimit,
          nearLimitBuffer: opts.nearLimitBuffer,
        })
      : []

  let statementId: string | null = null
  if (opts.mode === 'real' && opts.statementEnabled) {
    const now = new Date()
    const statement = em.create(BillingStatement, {
      organizationId: account.organizationId,
      tenantId: account.tenantId,
      billAccountId: account.id,
      billRunId: billRun.id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      currencyCode: account.currencyCode,
      openingBalance,
      totalTopups,
      totalUsage,
      totalRecurring,
      totalAdjustments,
      closingBalance,
      debitBreakdown: { items: breakdown },
      status: 'generated',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(statement)
    await em.flush()
    statementId = statement.id

    // Backfill statement_id on the charge transactions for attribution.
    if (chargeTransactionIds.length > 0) {
      await em.nativeUpdate(
        BillingAccountTransaction,
        { id: { $in: chargeTransactionIds } } as never,
        { statementId } as never,
      )
    }
  }

  return {
    statementId,
    openingBalance,
    totalTopups,
    totalUsage,
    totalRecurring,
    totalAdjustments,
    closingBalance,
    crossingEvents,
  }
}

/**
 * Resolve a period's opening balance by chaining from the prior statement's
 * closing (the spec's "chains cleanly"), with a ledger fallback for the very
 * first statement. See the call site for why a created_at sum alone is wrong.
 */
async function resolveOpeningBalance(
  em: EntityManager,
  account: BillingAccount,
  period: BillPeriod,
  previousClosing: string | null,
): Promise<string> {
  if (previousClosing !== null) return previousClosing
  const prior = await em.findOne(
    BillingStatement,
    {
      tenantId: account.tenantId,
      organizationId: account.organizationId,
      billAccountId: account.id,
      periodEnd: { $lt: period.periodStart },
    } as never,
    { orderBy: { periodEnd: 'DESC' } },
  )
  if (prior) return fromUnits(toUnits(prior.closingBalance))
  // First-ever statement: the ledger balance just before the period window
  // (only top-ups/usage exist before the first close, so created_at is safe).
  return sumAmountsBefore(em, account, period.periodStart)
}

/** Balance at `before` = SUM(amount) of transactions created strictly before it. */
async function sumAmountsBefore(
  em: EntityManager,
  account: BillingAccount,
  before: Date,
): Promise<string> {
  const rows = (await em.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM billing_account_transactions
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ?
        AND deleted_at IS NULL AND created_at < ?`,
    [account.tenantId, account.organizationId, account.id, before],
  )) as unknown as Array<{ total: string }>
  return fromUnits(toUnits(rows?.[0]?.total ?? 0))
}

/** SUM(amount) for one transaction type within [from, to). */
async function sumByTypeInWindow(
  em: EntityManager,
  account: BillingAccount,
  type: string,
  from: Date,
  to: Date,
): Promise<string> {
  const rows = (await em.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM billing_account_transactions
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ?
        AND deleted_at IS NULL AND type = ?
        AND created_at >= ? AND created_at < ?`,
    [account.tenantId, account.organizationId, account.id, type, from, to],
  )) as unknown as Array<{ total: string }>
  return fromUnits(toUnits(rows?.[0]?.total ?? 0))
}
