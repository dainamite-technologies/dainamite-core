import type { EntityManager } from '@mikro-orm/postgresql'
import { isoDay, overdueSql } from './overdue'

/**
 * Account-list financials (Spec E §4 / Spec F, F8, P-D15).
 *
 * One aggregate over `billing_invoices` per list page — `GROUP BY
 * bill_account_id` for the page's account ids, never a per-row fetch:
 *   - balance_due     Σ outstanding of posted / partially paid receivables
 *   - overdue_amount  Σ outstanding of the overdue subset
 * Test-run documents never count. Same overdue rule as the invoice list and
 * the account summary (`overdueSql`).
 */

export type AccountFinancials = { balance_due: string; overdue_amount: string }

export type FinancialsScope = { tenantId: string; organizationId: string }

export const ACCOUNT_FINANCIALS_SQL = `SELECT
    i.bill_account_id,
    COALESCE(SUM(i.outstanding), 0) AS balance_due,
    COALESCE(SUM(i.outstanding) FILTER (WHERE ${overdueSql('i')}), 0) AS overdue_amount
  FROM billing_invoices i
  WHERE i.tenant_id = ? AND i.organization_id = ? AND i.bill_account_id = ANY(?::uuid[])
    AND i.deleted_at IS NULL AND i.test_run = false
    AND i.status IN ('posted', 'partially_paid')
    AND i.document_type IN ('invoice', 'debit_memo')
  GROUP BY i.bill_account_id`

export const OVERDUE_ACCOUNT_IDS_SQL = `SELECT DISTINCT i.bill_account_id
  FROM billing_invoices i
  WHERE i.tenant_id = ? AND i.organization_id = ANY(?::uuid[])
    AND i.deleted_at IS NULL AND i.test_run = false
    AND ${overdueSql('i')}`

const ZERO = '0.0000'

function money(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value ?? '0')
  return (Number.isFinite(n) ? n : 0).toFixed(4)
}

function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`
}

export async function fetchAccountFinancials(
  em: EntityManager,
  scope: FinancialsScope,
  accountIds: readonly string[],
  today: Date = new Date(),
): Promise<Map<string, AccountFinancials>> {
  const out = new Map<string, AccountFinancials>()
  if (accountIds.length === 0) return out
  const rows = (await em.execute(ACCOUNT_FINANCIALS_SQL, [
    isoDay(today),
    scope.tenantId,
    scope.organizationId,
    uuidArray(accountIds),
  ])) as unknown as Array<{ bill_account_id: string; balance_due: string; overdue_amount: string }>
  for (const row of rows ?? []) {
    out.set(String(row.bill_account_id), { balance_due: money(row.balance_due), overdue_amount: money(row.overdue_amount) })
  }
  return out
}

/** Ids of accounts with at least one overdue receivable (the `hasOverdue` filter). */
export async function fetchOverdueAccountIds(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: readonly string[] },
  today: Date = new Date(),
): Promise<string[]> {
  if (scope.organizationIds.length === 0) return []
  const rows = (await em.execute(OVERDUE_ACCOUNT_IDS_SQL, [
    scope.tenantId,
    uuidArray(scope.organizationIds),
    isoDay(today),
  ])) as unknown as Array<{ bill_account_id: string }>
  return (rows ?? []).map((row) => String(row.bill_account_id))
}

export function financialsOrZero(map: Map<string, AccountFinancials>, accountId: string): AccountFinancials {
  return map.get(accountId) ?? { balance_due: ZERO, overdue_amount: ZERO }
}
