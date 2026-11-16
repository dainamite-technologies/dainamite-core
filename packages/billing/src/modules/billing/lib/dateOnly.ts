/**
 * Date-only helpers (Spec F, P-D5).
 *
 * MikroORM v7 hydrates `date` columns as `YYYY-MM-DD` strings while the
 * engine computes with `Date`s; and `pg` serialises a `Date` query
 * parameter in the server's time zone, which can shift a `date` comparison
 * by a day. Every date-only value the billing engine compares or sends to a
 * `date` column goes through these helpers: compare as UTC midnight, query
 * with the ISO day string.
 */

/** UTC-midnight `Date` for a `Date`, ISO string or timestamp. */
export function toUtcMidnight(value: Date | string | number): Date {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

/** `YYYY-MM-DD` (UTC) for a `Date`, ISO string or timestamp. */
export function toIsoDate(value: Date | string | number): string {
  return toUtcMidnight(value).toISOString().slice(0, 10)
}

/**
 * Locale-formatted date-only value for display. Formats in UTC so a
 * `YYYY-MM-DD` day never shifts by one in time zones west of UTC.
 */
export function formatDateOnly(value: Date | string | null | undefined, locale?: string): string {
  if (!value) return '—'
  const date = toUtcMidnight(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(locale, { timeZone: 'UTC' })
}

/** The viewer's local calendar day as `YYYY-MM-DD` (client "today"). */
export function localTodayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}
