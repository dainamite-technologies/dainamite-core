/**
 * Exact decimal arithmetic of index costs (scaled integers, never floating point). Client-safe and free of ORM imports:
 * shared by `services/costs/indexCostResolution.ts` (the engine) and `lib/indexView.ts` (the dialog's "today" help), so
 * the help always shows what the engine will compute.
 */

const SCALE = 6
const ONE = 10n ** BigInt(SCALE)

/** `"82.4"` -> 82400000n (scale 6). Returns null for anything that is not a plain non-negative decimal. */
export function toScaled(text: string | number | null | undefined): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(String(text ?? '').trim())
  if (!match) return null
  const fraction = (match[2] ?? '').padEnd(SCALE, '0').slice(0, SCALE)
  return BigInt(match[1]) * ONE + BigInt(fraction)
}

/** Trimmed decimal string of a bigint scaled by 10^scale (`"43.2"`, `"7"`). */
export function fromScaled(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(scale, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/** Stable decimal text for snapshots (`"82.400000"` -> `"82.4"`); unparseable input is returned as given. */
export function normalizeDecimal(text: string | number | null | undefined, fallback: string): string {
  if (text === null || text === undefined || text === '') return fallback
  const scaled = toScaled(text)
  return scaled === null ? String(text) : fromScaled(scaled, SCALE)
}

/**
 * `factor x value + offset`, half-up to 4 decimals, as a trimmed decimal string; null when an input is not a valid
 * non-negative decimal (a defensive guard: the DB CHECKs make that unreachable).
 */
export function computeIndexUnitAmount(value: string, factor: string | null | undefined, offset: string | null | undefined): string | null {
  const v = toScaled(value)
  const f = toScaled(factor ?? '1')
  const o = toScaled(offset ?? '0')
  if (v === null || f === null || o === null) return null
  // scale 12 = (f x v) at scale 12 + offset lifted from scale 6; 4 decimals = divide by 10^8 with half-up.
  const exact = f * v + o * ONE
  const step = 10n ** 8n
  return fromScaled((exact + step / 2n) / step, 4)
}

