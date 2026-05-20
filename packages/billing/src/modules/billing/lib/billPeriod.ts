import type { BillCycle } from '../data/validators'

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

function subtractDays(date: Date, days: number): Date {
  const result = cloneAtMidnight(date)
  result.setUTCDate(result.getUTCDate() - days)
  return result
}

function addDays(date: Date, days: number): Date {
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

function subtractCycle(date: Date, cycle: BillCycle): Date {
  switch (cycle) {
    case 'weekly': {
      const result = cloneAtMidnight(date)
      result.setUTCDate(result.getUTCDate() - 7)
      return result
    }
    case 'monthly':
      return shiftMonths(date, -1)
    case 'quarterly':
      return shiftMonths(date, -3)
    case 'annually':
      return shiftYears(date, -1)
  }
}

function addCycle(date: Date, cycle: BillCycle): Date {
  switch (cycle) {
    case 'weekly': {
      const result = cloneAtMidnight(date)
      result.setUTCDate(result.getUTCDate() + 7)
      return result
    }
    case 'monthly':
      return shiftMonths(date, 1)
    case 'quarterly':
      return shiftMonths(date, 3)
    case 'annually':
      return shiftYears(date, 1)
  }
}

/**
 * Compute the bill period for the cycle that `nextBillDate` marks the
 * START of the *next* one. So `periodEnd = nextBillDate - 1 day` and
 * `periodStart = nextBillDate - cycle`.
 */
export function deriveBillPeriod(nextBillDate: Date, cycle: BillCycle): BillPeriod {
  const periodEnd = subtractDays(nextBillDate, 1)
  const periodStart = subtractCycle(nextBillDate, cycle)
  return { periodStart, periodEnd }
}

/**
 * Advance `nextBillDate` by one cycle. Used by the engine after a
 * successful real-mode account run.
 */
export function advanceNextBillDate(currentNextBillDate: Date, cycle: BillCycle): Date {
  return addCycle(currentNextBillDate, cycle)
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
