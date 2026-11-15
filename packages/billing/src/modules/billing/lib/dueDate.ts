/**
 * Due-date math for posted invoices (Spec B). Pure, date-only, UTC.
 *
 * `due_date = issue_date + payment terms (days)`, where the terms come from
 * the account (`payment_terms_days`) and fall back to the organization
 * default (`billing_settings.default_payment_terms_days`).
 */

export function resolvePaymentTermsDays(
  accountTermsDays: number | null | undefined,
  defaultTermsDays: number | null | undefined,
): number {
  if (typeof accountTermsDays === 'number' && Number.isInteger(accountTermsDays) && accountTermsDays >= 0) {
    return accountTermsDays
  }
  if (typeof defaultTermsDays === 'number' && Number.isInteger(defaultTermsDays) && defaultTermsDays >= 0) {
    return defaultTermsDays
  }
  return 14
}

/** Issue date (any time of day) + N calendar days, at UTC midnight. */
export function computeDueDate(issueDate: Date, termsDays: number): Date {
  const base = new Date(issueDate)
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + termsDays))
}
