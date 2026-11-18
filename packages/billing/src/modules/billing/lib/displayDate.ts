/**
 * Date display for billing screens (issue #129).
 *
 * Billing pages share a screen with `DataTable`, which renders every `*_at`
 * column through `formatDisplayDate` / `formatDisplayDateTime` in the app UI
 * locale (`useLocale()`), honouring `NEXT_PUBLIC_OM_DATE_FORMAT` /
 * `NEXT_PUBLIC_OM_DATE_TIME_FORMAT`. Every billing date goes through the same
 * two formatters so one screen never mixes formats. Callers pass the app
 * locale from `useLocale()`.
 *
 * - `formatBillingDay` — a calendar day (`date` columns: bill dates, due
 *   dates, service periods). Read in UTC so the stored day never shifts.
 * - `formatBillingDateTime` — a real instant (`created_at`, `started_at`, …).
 */
import { formatDisplayDate, formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { toIsoDate } from './dateOnly'

export const EMPTY_DATE_LABEL = '—'

type DateInput = Date | string | null | undefined

function isBlank(value: DateInput): value is null | undefined | '' {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

/** A calendar day for display, or `—` when empty; unparseable input is shown as-is. */
export function formatBillingDay(value: DateInput, locale?: string | null): string {
  if (isBlank(value)) return EMPTY_DATE_LABEL
  const raw = typeof value === 'string' ? value.trim() : value
  const time = typeof raw === 'string' ? Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw) : raw.getTime()
  if (Number.isNaN(time)) return String(value)
  // A bare `yyyy-MM-dd` is parsed by `formatDisplayDate` as local midnight of
  // that day, so the UTC day of a `date` column survives in every time zone.
  return formatDisplayDate(toIsoDate(raw), locale ?? undefined) ?? String(value)
}

/** A timestamp for display, or `—` when empty; unparseable input is shown as-is. */
export function formatBillingDateTime(value: DateInput, locale?: string | null): string {
  if (isBlank(value)) return EMPTY_DATE_LABEL
  return formatDisplayDateTime(typeof value === 'string' ? value.trim() : value, locale ?? undefined) ?? String(value)
}
