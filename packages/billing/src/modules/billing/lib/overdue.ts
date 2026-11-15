/**
 * Overdue is computed, never stored (Spec B, B-D6):
 *
 *   status ∈ {posted, partially_paid} AND due_date < today AND outstanding > 0
 *
 * Receivable documents only (invoices and debit memos). One definition shared
 * by the in-memory predicate (UI / tests) and the SQL fragment (invoice list,
 * account summary), so the two can never disagree. No worker until dunning.
 */

export const OPEN_STATUSES = ['posted', 'partially_paid'] as const
export const RECEIVABLE_DOCUMENT_TYPES = ['invoice', 'debit_memo'] as const

export type OverdueCandidate = {
  status: string
  documentType?: string | null
  dueDate: Date | string | null | undefined
  outstanding: string | number | null | undefined
}

function dayNumber(value: Date | string): number {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000)
}

export function isOverdue(doc: OverdueCandidate, today: Date): boolean {
  return daysOverdue(doc, today) > 0
}

/** Whole days past the due date; 0 when not overdue. */
export function daysOverdue(doc: OverdueCandidate, today: Date): number {
  if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) return 0
  if (doc.documentType && !(RECEIVABLE_DOCUMENT_TYPES as readonly string[]).includes(doc.documentType)) return 0
  if (!doc.dueDate) return 0
  const outstanding = typeof doc.outstanding === 'number' ? doc.outstanding : Number.parseFloat(doc.outstanding ?? '0')
  if (!(outstanding > 0)) return 0
  return Math.max(0, dayNumber(today) - dayNumber(doc.dueDate))
}

/** `YYYY-MM-DD` of a date in UTC — the `today` parameter for SQL. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * SQL predicate for overdue documents on alias `alias`. Bind one parameter:
 * today as `YYYY-MM-DD`.
 */
export function overdueSql(alias: string): string {
  return (
    `(${alias}.status IN ('posted', 'partially_paid')` +
    ` AND ${alias}.document_type IN ('invoice', 'debit_memo')` +
    ` AND ${alias}.due_date < ?::date AND ${alias}.outstanding > 0)`
  )
}

/** SQL expression for days overdue (0 when not overdue). Bind today twice. */
export function daysOverdueSql(alias: string): string {
  return `(CASE WHEN ${overdueSql(alias)} THEN (?::date - ${alias}.due_date) ELSE 0 END)`
}
