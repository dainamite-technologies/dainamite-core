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
