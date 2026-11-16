/**
 * Bill cycle definition: "every N <unit> on <day>".
 *
 *   unit      daily | weekly | monthly | annually
 *   interval  N — how many units one cycle spans (1 = every month, 3 = quarterly)
 *   day       the bill cycle day the cycle is pinned to:
 *               monthly / annually → day of month '1'…'31' (a day past the end
 *                                   of a short month means its last day)
 *               weekly             → weekday 'mon'…'sun'
 *               daily              → null (the cycle counts from the account's
 *                                   next bill date)
 *
 * Pure and shared by validators, the cycle math (`billPeriod.ts`), the account
 * commands and the UI — the single source of truth for what a valid cycle is.
 */

export const BILL_CYCLES = ['daily', 'weekly', 'monthly', 'annually'] as const
export type BillCycle = (typeof BILL_CYCLES)[number]

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** Inclusive upper bound of `interval` per unit (lower bound is always 1). */
export const BILL_CYCLE_INTERVAL_MAX: Record<BillCycle, number> = {
  daily: 366,
  weekly: 52,
  monthly: 24,
  annually: 5,
}

export const DEFAULT_BILL_CYCLE: BillCycle = 'monthly'
export const DEFAULT_BILL_CYCLE_INTERVAL = 1
export const DEFAULT_BILL_CYCLE_DAY = '1'

export type CycleSpec = {
  cycle: BillCycle
  interval: number
  /**
   * Normalized bill cycle day ('1'…'31' | 'mon'…'sun') or null. Null on a
   * monthly / weekly / annually spec means "not pinned": the cycle follows
   * whatever day the anchor date falls on (used by callers that only know
   * the unit, e.g. legacy tests and the connector's proration helper).
   */
  day: string | null
}

/** A bare unit is shorthand for `{ cycle, interval: 1, day: null }`. */
export type CycleInput = BillCycle | CycleSpec

export function toCycleSpec(input: CycleInput): CycleSpec {
  if (typeof input === 'string') return { cycle: input, interval: 1, day: null }
  return { cycle: input.cycle, interval: input.interval > 0 ? Math.floor(input.interval) : 1, day: input.day }
}

/** Normalizes user input ('05', ' Mon ', 15) to the stored form, or null when it is not a day value. */
export function normalizeCycleDay(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim().toLowerCase()
  if (raw === '') return null
  if ((WEEKDAYS as readonly string[]).includes(raw)) return raw
  if (!/^\d{1,2}$/.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  return n >= 1 && n <= 31 ? String(n) : null
}

/** Day of month (1–31) of a pinned monthly / annually spec, else null. */
export function pinnedDayOfMonth(spec: CycleSpec): number | null {
  if (spec.cycle !== 'monthly' && spec.cycle !== 'annually') return null
  if (!spec.day || !/^\d+$/.test(spec.day)) return null
  return Number.parseInt(spec.day, 10)
}

/** Weekday index (0 = Sunday, JS `getUTCDay`) of a pinned weekly spec, else null. */
export function pinnedWeekday(spec: CycleSpec): number | null {
  if (spec.cycle !== 'weekly' || !spec.day) return null
  const index = (WEEKDAYS as readonly string[]).indexOf(spec.day)
  return index >= 0 ? index : null
}

/** The day a date falls on, in the shape `bill_cycle_day` stores for `cycle`. */
export function cycleDayOf(date: Date, cycle: BillCycle): string | null {
  if (cycle === 'daily') return null
  if (cycle === 'weekly') return WEEKDAYS[date.getUTCDay()]
  return String(date.getUTCDate())
}

export type CycleSpecIssue = { path: 'billCycleInterval' | 'billCycleDay'; message: string }

/**
 * Cross-field validation of a complete spec. Returns the first issue, or null
 * when the spec is valid. Shared by the create validator and the update
 * command (which validates the record merged with the patch).
 */
export function validateCycleSpec(spec: { cycle: BillCycle; interval: number; day: string | null }): CycleSpecIssue | null {
  const max = BILL_CYCLE_INTERVAL_MAX[spec.cycle]
  if (!Number.isInteger(spec.interval) || spec.interval < 1 || spec.interval > max) {
    return { path: 'billCycleInterval', message: `bill_cycle_interval must be 1–${max} for a ${spec.cycle} cycle` }
  }
  if (spec.cycle === 'daily') {
    return spec.day === null ? null : { path: 'billCycleDay', message: 'bill_cycle_day must be empty for a daily cycle' }
  }
  if (spec.cycle === 'weekly') {
    return spec.day && (WEEKDAYS as readonly string[]).includes(spec.day)
      ? null
      : { path: 'billCycleDay', message: 'bill_cycle_day must be mon–sun for a weekly cycle' }
  }
  return spec.day && /^\d+$/.test(spec.day)
    ? null
    : { path: 'billCycleDay', message: `bill_cycle_day must be 1–31 for a ${spec.cycle} cycle` }
}

/** Default bill cycle day for a unit (used when a create request omits it). */
export function defaultCycleDay(cycle: BillCycle, firstBillDate: Date | null): string | null {
  if (cycle === 'daily') return null
  if (firstBillDate) return cycleDayOf(firstBillDate, cycle)
  return cycle === 'weekly' ? 'mon' : DEFAULT_BILL_CYCLE_DAY
}
