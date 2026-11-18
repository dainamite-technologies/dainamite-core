/**
 * Service period of an invoice line, for display (admin invoice page + PDF).
 *
 * Every recurring line and every postpaid usage line stores
 * `service_period_start/end`. Prorated and credit lines additionally carry the
 * dates inside their description (`Fee · 2026-12-01 – 2026-12-14`, written at
 * post time and immutable). Surfaces render the period from the columns only
 * when the description does not already show it, so it never appears twice.
 */

export type LinePeriodInput = {
  description: string | null | undefined
  servicePeriodStart: Date | string | null | undefined
  servicePeriodEnd: Date | string | null | undefined
}

/** The separator `buildRecurringLineDescriptors` puts between the two dates. */
export const PERIOD_DATE_SEPARATOR = ' – '

export type LineServicePeriod = { start: Date | string; end: Date | string }

/** The period to display next to the description, or null when there is none to add. */
export function lineServicePeriod(line: LinePeriodInput): LineServicePeriod | null {
  const start = line.servicePeriodStart
  const end = line.servicePeriodEnd
  if (!start || !end) return null
  if ((line.description ?? '').includes(PERIOD_DATE_SEPARATOR)) return null
  return { start, end }
}

/**
 * Service period of a balance transaction, for display (prepaid ledger lists).
 *
 * Recurring charges posted by the period close store the period in
 * `metadata.service_period_start/end` (ISO days). Same dedupe rule as
 * `lineServicePeriod`: nothing is added when the description already shows it.
 */
export function transactionServicePeriod(txn: {
  description: string | null | undefined
  metadata: Record<string, unknown> | null | undefined
}): LineServicePeriod | null {
  const start = txn.metadata?.service_period_start
  const end = txn.metadata?.service_period_end
  return lineServicePeriod({
    description: txn.description,
    servicePeriodStart: typeof start === 'string' ? start : null,
    servicePeriodEnd: typeof end === 'string' ? end : null,
  })
}

/**
 * The dated suffix `buildRecurringLineDescriptors` appends to prorated and
 * credit lines (`Fee · 2026-12-01 – 2026-12-14`), anchored at the end of the
 * description. That text is stored (frozen at bill time and copied into
 * balance transactions), so surfaces localize it when they show it (#129).
 */
const PERIOD_SUFFIX = / · (\d{4}-\d{2}-\d{2}) – (\d{4}-\d{2}-\d{2})$/

/**
 * The description with its stored ISO service period re-rendered by
 * `formatDay`. Any other text, including dates typed into an item
 * description, is left untouched.
 */
export function localizeDescriptionPeriod(
  description: string | null | undefined,
  formatDay: (isoDay: string) => string,
): string {
  if (!description) return description ?? ''
  return description.replace(PERIOD_SUFFIX, (_match, start: string, end: string) => ` · ${formatDay(start)}${PERIOD_DATE_SEPARATOR}${formatDay(end)}`)
}
