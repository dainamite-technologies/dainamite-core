/**
 * MikroORM 7 hydrates `type: 'date'` columns as `YYYY-MM-DD` strings, while
 * entities created in the same unit of work still hold the `Date` the code
 * assigned. Calling `.toISOString()` on a hydrated value throws, so every
 * read of a date column goes through this helper. The output keeps the
 * historical ISO timestamp format (`2026-12-01T00:00:00.000Z`).
 */
export function dateColumnToIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Value to store in a `type: 'date'` column: `YYYY-MM-DD`, or null. */
export function toDateColumn(value: Date | string | null | undefined): string | null {
  const iso = dateColumnToIso(value)
  return iso ? iso.slice(0, 10) : null
}
