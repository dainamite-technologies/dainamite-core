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
