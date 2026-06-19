import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingAccount, BillingAccountBalance } from '../data/entities'
import type { BalanceStatus, BillingMode } from '../data/validators'
import {
  computeBalanceStatus,
  resolveLowBalanceThreshold,
} from './balanceStatus'
import { computeCreditSnapshot, type CreditSnapshot } from './creditStatus'
import { formatMoney } from './money'
import {
  getLowBalanceThresholdDefault,
  getNearLimitBufferDefault,
} from './prepaidConfig'

/**
 * Read-model helpers for an account's prepaid balance + credit status
 * (SPEC-002). Shared by `GET …/balance`, `GET …/credit-status`, and the
 * admin Prepaid panel so the math lives in exactly one place.
 */

export type BalanceSnapshot = {
  billAccountId: string
  currencyCode: string
  balance: string
  balanceStatus: BalanceStatus
  /** The resolved threshold (account row → tenant config default). */
  lowBalanceThreshold: string
  lastMovementAt: string | null
}

export async function getBalanceSnapshot(
  em: EntityManager,
  account: BillingAccount,
): Promise<BalanceSnapshot> {
  const row = await em.findOne(BillingAccountBalance, {
    tenantId: account.tenantId,
    billAccountId: account.id,
  })
  const balance = row?.balance ?? '0.0000'
  const threshold = resolveLowBalanceThreshold(
    row?.lowBalanceThreshold ?? null,
    await getLowBalanceThresholdDefault(em),
  )
  return {
    billAccountId: account.id,
    currencyCode: account.currencyCode,
    balance: formatMoney(balance),
    balanceStatus: computeBalanceStatus(balance, threshold),
    lowBalanceThreshold: formatMoney(threshold),
    lastMovementAt: row?.lastMovementAt ? row.lastMovementAt.toISOString() : null,
  }
}

/**
 * Σ outstanding of POSTED (not-yet-paid) core/sales invoices the engine
 * emitted for this account — the postpaid `credit_used` (v1; mid-period
 * accrued usage is not counted, see SPEC-002 Open Question #5). Top-up
 * receipts are `paid`, so they never count here.
 */
export async function getPostpaidOutstanding(
  em: EntityManager,
  account: BillingAccount,
): Promise<string> {
  const rows = (await em.execute(
    `SELECT COALESCE(SUM(outstanding_amount), 0) AS total
       FROM sales_invoices
      WHERE tenant_id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
        AND status = 'posted'
        AND metadata->>'bill_account_id' = ?`,
    [account.tenantId, account.organizationId, account.id],
  )) as unknown as Array<{ total: string }>
  return formatMoney(rows?.[0]?.total ?? 0)
}

export type CreditSnapshotResult = CreditSnapshot & { currencyCode: string }

export async function getCreditSnapshot(
  em: EntityManager,
  account: BillingAccount,
): Promise<CreditSnapshotResult> {
  const mode = (account.billingMode as BillingMode) ?? 'postpaid'
  const nearLimitBuffer = await getNearLimitBufferDefault(em)

  let balance: string | null = null
  let outstanding: string | null = null
  if (mode === 'prepaid') {
    const row = await em.findOne(BillingAccountBalance, {
      tenantId: account.tenantId,
      billAccountId: account.id,
    })
    balance = row?.balance ?? '0.0000'
  } else {
    outstanding = await getPostpaidOutstanding(em, account)
  }

  const snapshot = computeCreditSnapshot({
    mode,
    creditLimit: account.creditLimit ?? '0',
    nearLimitBuffer,
    balance,
    outstanding,
  })
  return { ...snapshot, currencyCode: account.currencyCode }
}
