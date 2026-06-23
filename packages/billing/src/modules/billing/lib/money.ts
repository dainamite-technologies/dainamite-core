/**
 * Exact decimal arithmetic for the prepaid balance ledger (SPEC-002).
 *
 * All billing money columns are `numeric(18,4)` — four decimal places. Doing
 * the running-balance / reconciliation math in JS `number` would accumulate
 * binary floating-point error (`0.1 + 0.2 !== 0.3`), and the reconciliation
 * invariant `balance == SUM(amount) == latest.balance_after` would drift.
 *
 * So we work in **integer ten-thousandths** ("units"): the smallest
 * representable step of a `numeric(18,4)` column. `12.3400` ⇄ `123400` units.
 * Addition/subtraction of integers is exact; we only ever format back to a
 * 4dp string at the persistence boundary.
 *
 * `numeric(18,4)` holds values up to ~10^14, i.e. ~10^18 units — well within
 * JS `Number.MAX_SAFE_INTEGER` (~9.007×10^15) for any realistic balance
 * (max safe ~±900,000,000,000 currency units). Magnitudes beyond that would
 * already overflow the column itself; we guard the parse defensively.
 */

const SCALE = 10_000

/** Parse a numeric(18,4) string (or number) into integer ten-thousandths. */
export function toUnits(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return 0
  // Round to the nearest ten-thousandth — half-up, EPSILON-nudged to survive
  // representations like 12.33999999998.
  return Math.round((n + Number.EPSILON * Math.sign(n)) * SCALE)
}

/** Format integer ten-thousandths back to a numeric(18,4) string. */
export function fromUnits(units: number): string {
  const sign = units < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(units))
  const whole = Math.trunc(abs / SCALE)
  const frac = abs % SCALE
  return `${sign}${whole}.${frac.toString().padStart(4, '0')}`
}

/** Add two numeric(18,4) values exactly, returning a 4dp string. */
export function addMoney(a: string | number, b: string | number): string {
  return fromUnits(toUnits(a) + toUnits(b))
}

/** Subtract `b` from `a` exactly, returning a 4dp string. */
export function subMoney(a: string | number, b: string | number): string {
  return fromUnits(toUnits(a) - toUnits(b))
}

/** Negate a numeric(18,4) value, returning a 4dp string. */
export function negateMoney(a: string | number): string {
  return fromUnits(-toUnits(a))
}

/** Absolute value of a numeric(18,4), returning a 4dp string. */
export function absMoney(a: string | number): string {
  return fromUnits(Math.abs(toUnits(a)))
}

/** Compare two numeric(18,4) values. Returns -1 / 0 / 1. */
export function compareMoney(a: string | number, b: string | number): -1 | 0 | 1 {
  const ua = toUnits(a)
  const ub = toUnits(b)
  if (ua < ub) return -1
  if (ua > ub) return 1
  return 0
}

/** Normalize any numeric(18,4) input to a canonical 4dp string. */
export function formatMoney(value: string | number): string {
  return fromUnits(toUnits(value))
}
