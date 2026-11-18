import { addDays, cloneAtMidnight, nextCycleDay } from './billPeriod'
import {
  defaultCycleDay,
  validateCycleSpec,
  type BillCycle,
  type CycleSpec,
  type CycleSpecIssue,
} from './billCycle'

/**
 * How an account's bill cycle day drives its `next_bill_date` (create + edit).
 * Pure — the account commands call it and own persistence.
 *
 *   create   next bill date omitted → the first cycle day on or after today
 *            (daily: today). An explicit date is kept; when it is off the
 *            cycle day the first Bill Run bills a short alignment period.
 *   update   changing the unit, N or the day without an explicit
 *            `nextBillDate` moves the next bill date to the next occurrence
 *            of the new day — at least one day after the start of the
 *            current (unbilled) period, and never in the past. The run on
 *            that date bills the short alignment period; in-advance items
 *            are prorated by the existing service-period path.
 */

/** Spec of a persisted account row. */
export function accountCycleSpec(account: {
  billCycle: string
  billCycleInterval?: number | null
  billCycleDay?: string | null
}): CycleSpec {
  return {
    cycle: account.billCycle as BillCycle,
    interval: account.billCycleInterval && account.billCycleInterval > 0 ? account.billCycleInterval : 1,
    day: account.billCycleDay ?? null,
  }
}

/** Snake-case API row (`bill_cycle`, …) → the shape `accountCycleSpec` reads. */
export function rowCycle(row: { bill_cycle: string; bill_cycle_interval?: number | null; bill_cycle_day?: string | null }) {
  return { billCycle: row.bill_cycle, billCycleInterval: row.bill_cycle_interval, billCycleDay: row.bill_cycle_day }
}

export function resolveCreateCycle(
  input: { cycle: BillCycle; interval: number; day?: string | null; nextBillDate?: Date | null },
  today: Date,
): { spec: CycleSpec; nextBillDate: Date } {
  const explicit = input.nextBillDate ? cloneAtMidnight(input.nextBillDate) : null
  const day = input.day === undefined ? defaultCycleDay(input.cycle, explicit) : input.day
  const spec: CycleSpec = { cycle: input.cycle, interval: input.interval, day }
  return { spec, nextBillDate: explicit ?? nextCycleDay(today, spec) }
}

export type CyclePatch = { cycle?: BillCycle; interval?: number; day?: string | null; nextBillDate?: Date | null }

export type CycleUpdateResult =
  | { ok: true; spec: CycleSpec; changed: boolean; nextBillDate: Date | null }
  | { ok: false; issue: CycleSpecIssue }

/**
 * Merges a patch into the stored cycle and decides the next bill date.
 * `nextBillDate` in the result is null when it should stay as stored.
 */
export function resolveCycleUpdate(
  current: CycleSpec & { lastBillDate: Date | string | null },
  patch: CyclePatch,
  today: Date,
): CycleUpdateResult {
  const cycle = patch.cycle ?? current.cycle
  const unitChanged = cycle !== current.cycle
  // Switching unit invalidates the old day shape — fall back to the unit default.
  const day =
    patch.day !== undefined ? patch.day : unitChanged ? defaultCycleDay(cycle, null) : current.day
  const spec: CycleSpec = { cycle, interval: patch.interval ?? current.interval, day }
  const issue = validateCycleSpec(spec)
  if (issue) return { ok: false, issue }

  const changed = spec.cycle !== current.cycle || spec.interval !== current.interval || spec.day !== current.day
  if (patch.nextBillDate) return { ok: true, spec, changed, nextBillDate: cloneAtMidnight(patch.nextBillDate) }
  if (!changed) return { ok: true, spec, changed, nextBillDate: null }

  const todayMidnight = cloneAtMidnight(today)
  const periodStart = current.lastBillDate ? addDays(current.lastBillDate, 1) : null
  if (spec.cycle === 'daily') {
    const fromStart = addDays(periodStart ?? todayMidnight, spec.interval)
    return { ok: true, spec, changed, nextBillDate: maxDate(fromStart, todayMidnight) }
  }
  // At least one day after the current period's start so the alignment
  // period is never empty, and never in the past.
  const earliest = periodStart ? maxDate(addDays(periodStart, 1), todayMidnight) : todayMidnight
  return { ok: true, spec, changed, nextBillDate: nextCycleDay(earliest, spec) }
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}
