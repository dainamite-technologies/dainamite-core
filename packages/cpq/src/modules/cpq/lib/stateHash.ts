import { createHash } from 'node:crypto'

/**
 * Stable state hashing (ARC costs spec Q1). One generic primitive with no ORM dependency: every caller builds its
 * own projection (which fields count) and hashes that.
 *
 *  - `canonicalJson` is the sorted-key canonical JSON that `arcPriceFreeze` has always compared pricing inputs with
 *    (extracted unchanged for every JSON-representable value, so `arcPricingInputsChanged` behaves exactly as
 *    before): object keys sorted at every depth, array order kept, `undefined` and `null` the same (`null`), a
 *    MISSING key different from a `null` one. The one addition is a `Date`, which is its ISO string (it used to
 *    collapse to `{}`; a Date never occurred in the jsonb / JSON inputs this was written for).
 *  - Numeric strings are NOT normalised here: `"1"` and `1` stay different values (a configuration value `"007"`
 *    must not equal `7`). Projections of DECIMAL columns call `normalizeDecimal` / `normalizeDay` on those fields.
 *  - `canonicalStateHash` is the sha256 hex digest of `canonicalJson`. A one-way digest: never return it to a
 *    caller without `cpq.costs.view` when it hashes costs.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString())
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function canonicalStateHash(projection: unknown): string {
  return createHash('sha256').update(canonicalJson(projection)).digest('hex')
}

/**
 * A DECIMAL as one canonical string, so `"270"`, `"270.0000"`, `270` and `"0270.00"` are the same value.
 * `null`, `undefined`, `''` and a non-finite number give `null`; a string that is not a plain decimal is returned
 * trimmed, so it is never silently equal to a number.
 */
export function normalizeDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = (typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value).trim()
  if (text === '') return null
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && !match[3])) return text
  const [, sign, intPart, fraction = ''] = match
  const integer = intPart.replace(/^0+(?=\d)/, '') || '0'
  const decimals = fraction.replace(/0+$/, '')
  const body = decimals ? `${integer}.${decimals}` : integer
  return body === '0' ? '0' : `${sign === '-' ? '-' : ''}${body}`
}

/** A calendar date as `YYYY-MM-DD` (a `Date` or any string starting with it); `null` for an empty value. */
export function normalizeDay(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}
