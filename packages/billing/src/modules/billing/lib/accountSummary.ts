import type { EntityManager } from '@mikro-orm/postgresql'
import type { BillingAccount } from '../data/entities'
import { isoDay, overdueSql } from './overdue'
import { getAccountCredit } from './allocation'

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
