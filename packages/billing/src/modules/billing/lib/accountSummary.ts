import type { EntityManager } from '@mikro-orm/postgresql'
import type { BillingAccount } from '../data/entities'
import { isoDay, overdueSql } from './overdue'
import { getAccountCredit } from './allocation'
import { computeBalanceStatus, resolveLowBalanceThreshold } from './balanceStatus'
import { getLowBalanceThresholdDefault } from './prepaidConfig'
import { toIsoDate } from './dateOnly'

/**
 * Accounts-receivable summary of one billing account (Spec B; the endpoint
 * is Spec E's `GET /api/billing/accounts/{id}/summary`, which later adds the
 * prepaid balance and next bill date to the same response).
 *
 * One aggregate query over `billing_invoices` (indexed on
 * `bill_account_id, status, due_date`), no ORM hydration:
 *   - open_amount    Σ outstanding of posted / partially paid receivables
 *   - overdue_amount Σ outstanding of the overdue subset (B-D6)
 *   - overdue_count  number of overdue documents
 *   - credit_amount  unapplied credit (Spec C): unallocated payments + open
 *                    credit memos of the account
 * Test-run documents never count.
 */

export type AccountArSummary = {
  bill_account_id: string
  currency_code: string
  open_amount: string
  overdue_amount: string
  overdue_count: number
  credit_amount: string
}

type SummaryRow = { open_amount: string | null; overdue_amount: string | null; overdue_count: number | string | null }

export const ACCOUNT_SUMMARY_SQL = `SELECT
    COALESCE(SUM(i.outstanding), 0) AS open_amount,
    COALESCE(SUM(i.outstanding) FILTER (WHERE ${overdueSql('i')}), 0) AS overdue_amount,
    COUNT(*) FILTER (WHERE ${overdueSql('i')})::int AS overdue_count
  FROM billing_invoices i
  WHERE i.tenant_id = ? AND i.organization_id = ? AND i.bill_account_id = ?
    AND i.deleted_at IS NULL AND i.test_run = false
    AND i.status IN ('posted', 'partially_paid')
    AND i.document_type IN ('invoice', 'debit_memo')`

function money(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value ?? '0')
  return (Number.isFinite(n) ? n : 0).toFixed(4)
}

export async function getAccountArSummary(
  em: EntityManager,
  account: Pick<BillingAccount, 'id' | 'tenantId' | 'organizationId' | 'currencyCode'>,
  today: Date = new Date(),
): Promise<AccountArSummary> {
  const day = isoDay(today)
  const rows = (await em.execute(ACCOUNT_SUMMARY_SQL, [
    day,
    day,
    account.tenantId,
    account.organizationId,
    account.id,
  ])) as unknown as SummaryRow[]
  const row = rows?.[0]
  return {
    bill_account_id: account.id,
    currency_code: account.currencyCode,
    open_amount: money(row?.open_amount),
    overdue_amount: money(row?.overdue_amount),
    overdue_count: Number(row?.overdue_count ?? 0) || 0,
    credit_amount: await getAccountCredit(
      em,
      { tenantId: account.tenantId, organizationId: account.organizationId },
      { id: account.id, currencyCode: account.currencyCode },
    ),
  }
}

// ─── Spec E / Spec F (F8): the account workspace header ──────────

export type AccountWorkspaceSummary = AccountArSummary & {
  billing_mode: 'postpaid' | 'prepaid'
  bill_cycle: string
  next_bill_date: string | null
  last_invoice: { id: string; number: string; issue_date: string | null; total_gross: string } | null
  prepaid: {
    balance: string
    balance_status: 'ok' | 'low' | 'exhausted'
    credit_limit: string
    last_statement: { id: string; period_start: string; period_end: string; closing_balance: string } | null
  } | null
}

type LastInvoiceRow = { id: string; number: string; issue_date: string | Date | null; total_gross: string }
type BalanceRow = { balance: string | null; low_balance_threshold: string | null }
type StatementRow = { id: string; period_start: string | Date; period_end: string | Date; closing_balance: string }

export const LAST_INVOICE_SQL = `SELECT id, number, issue_date, total_gross
  FROM billing_invoices
  WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ?
    AND deleted_at IS NULL AND test_run = false
    AND document_type IN ('invoice', 'debit_memo')
    AND status NOT IN ('draft')
  ORDER BY issue_date DESC NULLS LAST, created_at DESC
  LIMIT 1`

export const BALANCE_SQL = `SELECT balance, low_balance_threshold
  FROM billing_account_balances
  WHERE tenant_id = ? AND bill_account_id = ?
  LIMIT 1`

export const LAST_STATEMENT_SQL = `SELECT id, period_start, period_end, closing_balance
  FROM billing_statements
  WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ?
  ORDER BY period_end DESC
  LIMIT 1`

/**
 * Everything the account header shows, in a fixed number of small indexed
 * queries (no ORM hydration, no per-document fetch): the AR summary, cycle
 * state, the last posted invoice and — for prepaid accounts — the balance
 * with its status, the credit limit and the last statement.
 */
export async function getAccountWorkspaceSummary(
  em: EntityManager,
  account: Pick<
    BillingAccount,
    'id' | 'tenantId' | 'organizationId' | 'currencyCode' | 'billingMode' | 'billCycle' | 'nextBillDate' | 'creditLimit'
  >,
  today: Date = new Date(),
): Promise<AccountWorkspaceSummary> {
  const ar = await getAccountArSummary(em, account, today)
  const scopeParams = [account.tenantId, account.organizationId, account.id]
  const lastInvoice = ((await em.execute(LAST_INVOICE_SQL, scopeParams)) as unknown as LastInvoiceRow[])?.[0]
  let prepaid: AccountWorkspaceSummary['prepaid'] = null
  if (account.billingMode === 'prepaid') {
    const balanceRow = ((await em.execute(BALANCE_SQL, [account.tenantId, account.id])) as unknown as BalanceRow[])?.[0]
    const statement = ((await em.execute(LAST_STATEMENT_SQL, scopeParams)) as unknown as StatementRow[])?.[0]
    const balance = money(balanceRow?.balance)
    const threshold = resolveLowBalanceThreshold(
      balanceRow?.low_balance_threshold ?? null,
      await getLowBalanceThresholdDefault(em, { tenantId: account.tenantId, organizationId: account.organizationId }),
    )
    prepaid = {
      balance,
      balance_status: computeBalanceStatus(balance, threshold),
      credit_limit: money(account.creditLimit),
      last_statement: statement
        ? {
            id: statement.id,
            period_start: toIsoDate(statement.period_start),
            period_end: toIsoDate(statement.period_end),
            closing_balance: money(statement.closing_balance),
          }
        : null,
    }
  }
  return {
    ...ar,
    billing_mode: account.billingMode === 'prepaid' ? 'prepaid' : 'postpaid',
    bill_cycle: account.billCycle,
    next_bill_date: account.nextBillDate ? toIsoDate(account.nextBillDate) : null,
    last_invoice: lastInvoice
      ? {
          id: lastInvoice.id,
          number: lastInvoice.number,
          issue_date: lastInvoice.issue_date ? toIsoDate(lastInvoice.issue_date) : null,
          total_gross: money(lastInvoice.total_gross),
        }
      : null,
    prepaid,
  }
}
