import { pinnedDayOfMonth, pinnedWeekday, toCycleSpec, type CycleInput, type CycleSpec } from './billCycle'

/**
 * Calendar-aware bill-period arithmetic.
 *
 * The spec mandates calendar units (Postgres `interval`-equivalent),
 * NOT raw day counts — months and quarters have variable length, so a
 * 30-day subtraction would skew the period boundary every February.
 *
 * All helpers here treat input dates as midnight in the host timezone
 * (the way MikroORM's `date`-column round-trip lands them). Date math
 * via `Date.setMonth` / `setDate` is the right primitive: Postgres'
 * `+ interval '1 month'` and JS's `setMonth(+1)` agree on the
 * "clamp to month end" behaviour (e.g. Jan 31 + 1 month → Feb 28/29).
 *
 * Examples (all from the spec's reference table):
 *
 *   monthly  next=2026-06-01 → period=2026-05-01..2026-05-31
 *   monthly  next=2026-03-01 → period=2026-02-01..2026-02-28
 *   monthly  next=2024-03-01 → period=2024-02-01..2024-02-29 (leap)
 *   quarterly next=2026-07-01 → period=2026-04-01..2026-06-30
 *   weekly   next=2026-05-04 (Mon) → period=2026-04-27..2026-05-03
 *
 * Cycles are "every N units on the bill cycle day" (`lib/billCycle.ts`).
 * Every helper takes a `CycleInput` — a full `CycleSpec`, or a bare unit as
 * shorthand for "every 1, not pinned" (the pre-cycle-day behaviour).
 *
 * Pinning: a monthly / annually spec with a day re-pins every shifted date to
 * that day (clamped to short months), so a 31st bills 31 Jan → 28 Feb → 31 Mar
 * instead of drifting to the 28th. A bill date that is OFF the cycle day (an
 * explicit first bill date, or a day change) advances to the next occurrence
 * of the day — one short alignment period — and stays pinned from then on.
 */

export type BillPeriod = {
  /** Inclusive — first day of the cycle being billed. */
  periodStart: Date
  /** Inclusive — last day of the cycle (`nextBillDate - 1 day`). */
  periodEnd: Date
}

function cloneAtMidnight(date: Date | string | number): Date {
  // MikroORM hands `date`-typed columns back as 'YYYY-MM-DD' strings,
  // not Date objects — coerce so every helper here is input-tolerant
  // whether called from the engine (DB rows) or unit tests (plain
  // `new Date('2026-06-01')` values).
  const result = new Date(date instanceof Date ? date.getTime() : date)
  result.setUTCHours(0, 0, 0, 0)
  return result
}

function subtractDays(date: Date | string | number, days: number): Date {
  const result = cloneAtMidnight(date)
  result.setUTCDate(result.getUTCDate() - days)
  return result
}

function addDays(date: Date | string | number, days: number): Date {
  const result = cloneAtMidnight(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function lastDayOfMonthUTC(year: number, monthZeroIndexed: number): number {
  // Date(Date.UTC(y, m+1, 0)) returns the last day of month m. The
  // zero-day-of-next-month trick is the canonical JS idiom.
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate()
}

function shiftMonths(date: Date, deltaMonths: number): Date {
  // JS `setUTCMonth` does NOT clamp when the target month is shorter
  // than the source day — it overflows (Jan 31 + 1 month → Mar 3
  // because Feb 31 spills over). Postgres `+ interval '1 month'` and
  // the spec both clamp, so we replicate that: shift the month while
  // pinned to day 1, then restore the original day clamped to the new
  // month's last day.
  const result = cloneAtMidnight(date)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + deltaMonths)
  const lastDay = lastDayOfMonthUTC(result.getUTCFullYear(), result.getUTCMonth())
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function shiftYears(date: Date, deltaYears: number): Date {
  // Same clamp story for Feb 29 in non-leap years.
  const result = cloneAtMidnight(date)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCFullYear(result.getUTCFullYear() + deltaYears)
  const lastDay = lastDayOfMonthUTC(result.getUTCFullYear(), result.getUTCMonth())
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function pinDay(date: Date, spec: CycleSpec): Date {
  const day = pinnedDayOfMonth(spec)
  if (day === null) return date
  const result = cloneAtMidnight(date)
  const lastDay = lastDayOfMonthUTC(result.getUTCFullYear(), result.getUTCMonth())
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/** Rough cycle length in days — only used to seed index searches. */
export function approxCycleDays(input: CycleInput): number {
  const spec = toCycleSpec(input)
  const unitDays = { daily: 1, weekly: 7, monthly: 30.44, annually: 365.25 }[spec.cycle]
  return unitDays * spec.interval
}

/**
 * True when `date` falls on the spec's bill cycle day. Unpinned specs (and
 * daily cycles) accept every date.
 */
export function onCycleDay(date: Date | string | number, input: CycleInput): boolean {
  const spec = toCycleSpec(input)
  const d = cloneAtMidnight(date)
  const weekday = pinnedWeekday(spec)
  if (weekday !== null) return d.getUTCDay() === weekday
  const day = pinnedDayOfMonth(spec)
  if (day === null) return true
  return d.getUTCDate() === Math.min(day, lastDayOfMonthUTC(d.getUTCFullYear(), d.getUTCMonth()))
}

/** First date on the cycle day that is on or after `date` (`date` itself when unpinned). */
export function nextCycleDay(date: Date | string | number, input: CycleInput): Date {
  const spec = toCycleSpec(input)
  const d = cloneAtMidnight(date)
  const weekday = pinnedWeekday(spec)
  if (weekday !== null) return addDays(d, (weekday - d.getUTCDay() + 7) % 7)
  if (pinnedDayOfMonth(spec) === null) return d
  const candidate = pinDay(d, spec)
  if (candidate.getTime() >= d.getTime()) return candidate
  const nextMonth = cloneAtMidnight(d)
  nextMonth.setUTCDate(1)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  return pinDay(nextMonth, spec)
}

/** Last date on the cycle day that is on or before `date` (`date` itself when unpinned). */
export function previousCycleDay(date: Date | string | number, input: CycleInput): Date {
  const spec = toCycleSpec(input)
  const d = cloneAtMidnight(date)
  const weekday = pinnedWeekday(spec)
  if (weekday !== null) return addDays(d, -((d.getUTCDay() - weekday + 7) % 7))
  if (pinnedDayOfMonth(spec) === null) return d
  const candidate = pinDay(d, spec)
  if (candidate.getTime() <= d.getTime()) return candidate
  const prevMonth = cloneAtMidnight(d)
  prevMonth.setUTCDate(1)
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1)
  return pinDay(prevMonth, spec)
}

/**
 * The cycle boundary `k` cycles away from `anchor` (k may be negative),
 * computed directly from the anchor — never by chaining single steps — so
 * month-end clamping does not drift. Pinned monthly / annually specs re-pin
 * the result to the cycle day.
 */
export function shiftCycles(anchor: Date | string | number, input: CycleInput, k: number): Date {
  const spec = toCycleSpec(input)
  const base = cloneAtMidnight(anchor)
  const n = k * spec.interval
  switch (spec.cycle) {
    case 'daily':
      return addDays(base, n)
    case 'weekly':
      return addDays(base, 7 * n)
    case 'monthly':
      return pinDay(shiftMonths(base, n), spec)
    case 'annually':
      return pinDay(shiftYears(base, n), spec)
  }
}

/**
 * The cycle-grid anchor for a bill date: the bill date itself when it is on
 * the cycle day, otherwise the cycle day before it (the grid the account is
 * aligning to). Recurring proration slices along this grid.
 */
export function gridAnchorFor(billDate: Date | string | number, input: CycleInput): Date {
  return onCycleDay(billDate, input) ? cloneAtMidnight(billDate) : previousCycleDay(billDate, input)
}

/**
 * Compute the bill period that `nextBillDate` closes:
 * `periodEnd = nextBillDate - 1 day`. `periodStart` is the day after the
 * previously billed period when known (`lastBillDate + 1` — what makes a short
 * alignment period bill exactly its days), else one cycle back.
 */
export function deriveBillPeriod(
  nextBillDate: Date | string | number,
  input: CycleInput,
  lastBillDate?: Date | string | null,
): BillPeriod {
  const periodEnd = subtractDays(cloneAtMidnight(nextBillDate), 1)
  if (lastBillDate) {
    const start = addDays(lastBillDate, 1)
    if (start.getTime() <= periodEnd.getTime()) return { periodStart: start, periodEnd }
  }
  const periodStart = onCycleDay(nextBillDate, input)
    ? shiftCycles(nextBillDate, input, -1)
    : previousCycleDay(periodEnd, input)
  return { periodStart, periodEnd }
}

/**
 * Advance `nextBillDate` by one cycle. Used by the engines after a
 * successful real-mode account run. On the cycle day: one full cycle,
 * re-pinned. Off the cycle day: the next occurrence of the day (alignment).
 */
export function advanceNextBillDate(currentNextBillDate: Date | string | number, input: CycleInput): Date {
  if (onCycleDay(currentNextBillDate, input)) return shiftCycles(currentNextBillDate, input, 1)
  return nextCycleDay(addDays(currentNextBillDate, 1), input)
}

/**
 * The bill cycle that `target` falls into, given any known cycle
 * boundary `anchor` (e.g. an account's `nextBillDate`). Returned
 * `periodStart` is inclusive, `periodEnd` is the last day of the cycle.
 *
 * Used by the cpq-billing-connector to prorate a mid-cycle amendment —
 * the connector owns the billing-cycle knowledge, CPQ does not.
 */
export function cycleContaining(
  anchor: Date | string | number,
  input: CycleInput,
  target: Date | string | number,
): BillPeriod {
  const grid = gridAnchorFor(anchor, input)
  const targetMs = cloneAtMidnight(target).getTime()
  let index = Math.floor((targetMs - grid.getTime()) / 86_400_000 / approxCycleDays(input))
  let guard = 0
  while (shiftCycles(grid, input, index).getTime() > targetMs && guard++ < 1000) index--
  while (shiftCycles(grid, input, index + 1).getTime() <= targetMs && guard++ < 2000) index++
  return {
    periodStart: shiftCycles(grid, input, index),
    periodEnd: subtractDays(shiftCycles(grid, input, index + 1), 1),
  }
}

/**
 * True when the account still has cycles to bill on or before
 * `asOfDate`. The engine uses this to drive the catch-up loop.
 */
export function isCycleDue(nextBillDate: Date, asOfDate: Date): boolean {
  const a = cloneAtMidnight(nextBillDate).getTime()
  const b = cloneAtMidnight(asOfDate).getTime()
  return a <= b
}

/**
 * Test seam: re-export the day-add helper so the engine can compute
 * `bill_period_end + 1 day` consistently with this module's calendar
 * semantics (avoids drift between engine code and period-math tests).
 */
export { addDays, cloneAtMidnight }
