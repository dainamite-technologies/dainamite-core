import type { ChargeTiming } from '../data/validators'
import type { CycleInput } from './billCycle'
import { addDays, advanceNextBillDate, approxCycleDays, cloneAtMidnight, gridAnchorFor, shiftCycles } from './billPeriod'

/**
 * Recurring-charge computation for one bill date (Spec A).
 *
 * Pure and storage-agnostic: given an item's state and the account's bill
 * date, decide which service periods to charge (or credit) and where the
 * item's `billed_to_date` watermark moves. The engine calls it once per item
 * per simulated bill date and owns persistence.
 *
 * Model:
 *   - The account's cycle grid is anchored at the bill date `D` (or, when `D`
 *     is off the bill cycle day, at the cycle day before it):
 *     …, D − cycle, D, D + cycle, …  (each period `[g_k, g_{k+1} − 1]`).
 *   - Horizon — how far the item is billed on `D`:
 *       in_advance → next bill date − 1     in_arrears → D − 1
 *     (next bill date = D + cycle on the cycle day; the next cycle day when
 *     aligning, so the short alignment period is prorated).
 *   - Cursor — first unbilled day: `billed_to_date + 1`, else `bill_start_date`.
 *   - The unbilled window `[cursor, min(horizon, bill_end_date)]` is cut along
 *     the grid; each grid period becomes one line (full → unit price,
 *     partial → prorated by calendar days, or skipped when `prorate=false`).
 *   - Credit (A-D2): an item ended (`bill_end_date`) before what was already
 *     billed (`billed_to_date`) gets negative lines for the unused days when
 *     `prorate=true`, and the watermark is pulled back to `bill_end_date`.
 *
 * The watermark is the single source of truth against double billing: every
 * computation starts at `billed_to_date + 1`, so switching timing, re-running
 * a bill date, or catching up can never charge a day twice.
 */

export type RecurringItemState = {
  id: string
  chargeTiming: ChargeTiming
  prorate: boolean
  billStartDate: Date | string
  billEndDate?: Date | string | null
  billedToDate?: Date | string | null
  unitPrice: number
  isActive: boolean
  deletedAt?: Date | string | null
}

export type ProrationInfo = { activeDays: number; periodDays: number }

export type RecurringLine = {
  billingItemId: string
  kind: 'charge' | 'credit'
  /** Inclusive service period the line covers. */
  servicePeriodStart: Date
  servicePeriodEnd: Date
  /** 2dp half-up; negative for credits. */
  amount: number
  /** Null when the line covers a full grid period. */
  proration: ProrationInfo | null
}

export type RecurringSkipReason =
  | 'item-inactive'
  | 'item-soft-deleted'
  | 'partial-period-not-prorated'
  | 'ended-after-billing-no-credit'
  | 'period-cap-reached'

export type RecurringSkip = {
  billingItemId: string
  reason: RecurringSkipReason
  servicePeriodStart: Date | null
  servicePeriodEnd: Date | null
}

export type RecurringComputation = {
  lines: RecurringLine[]
  /** Watermark after these lines; unchanged when nothing was billed. */
  newBilledToDate: Date | null
  skipped: RecurringSkip[]
}

/** Upper bound of grid periods processed per item per call (runaway guard). */
export const MAX_PERIODS_PER_ITEM = 120

const DAY_MS = 86_400_000

function toDate(value: Date | string | number): Date {
  return cloneAtMidnight(value)
}

function optDate(value: Date | string | null | undefined): Date | null {
  return value === null || value === undefined || value === '' ? null : toDate(value)
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

/** Inclusive day count of `[from, to]`. */
export function inclusiveDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1
}

/** Half-up 2dp rounding that survives binary floating point (1.005 → 1.01). */
export function roundHalfUp2dp(value: number): number {
  const sign = value < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
}

type GridPeriod = { index: number; start: Date; end: Date }

function gridPeriod(anchor: Date, cycle: CycleInput, index: number): GridPeriod {
  const start = shiftCycles(anchor, cycle, index)
  const end = addDays(shiftCycles(anchor, cycle, index + 1), -1)
  return { index, start, end }
}

/** Grid period (anchored at `anchor`) containing `date`. */
export function gridPeriodContaining(anchor: Date, cycle: CycleInput, date: Date): GridPeriod {
  const target = date.getTime()
  // Coarse estimate first so long gaps don't walk one cycle at a time.
  let index = Math.floor((target - anchor.getTime()) / DAY_MS / approxCycleDays(cycle))
  let period = gridPeriod(anchor, cycle, index)
  let guard = 0
  while (period.start.getTime() > target && guard++ < 1000) period = gridPeriod(anchor, cycle, --index)
  while (period.end.getTime() < target && guard++ < 2000) period = gridPeriod(anchor, cycle, ++index)
  return period
}

/**
 * Slices `[from, to]` along the grid and prices each slice. Shared by the
 * charge and credit paths so both prorate identically.
 */
function slice(
  item: RecurringItemState,
  anchor: Date,
  cycle: CycleInput,
  from: Date,
  to: Date,
  kind: RecurringLine['kind'],
): { lines: RecurringLine[]; skipped: RecurringSkip[]; lastCovered: Date | null } {
  const lines: RecurringLine[] = []
  const skipped: RecurringSkip[] = []
  let lastCovered: Date | null = null
  let period = gridPeriodContaining(anchor, cycle, from)
  let count = 0
  while (period.start.getTime() <= to.getTime()) {
    if (count++ >= MAX_PERIODS_PER_ITEM) {
      skipped.push({ billingItemId: item.id, reason: 'period-cap-reached', servicePeriodStart: period.start, servicePeriodEnd: null })
      break
    }
    const activeStart = maxDate(period.start, from)
    const activeEnd = minDate(period.end, to)
    const periodDays = inclusiveDays(period.start, period.end)
    const activeDays = inclusiveDays(activeStart, activeEnd)
    const partial = activeDays < periodDays
    if (partial && !item.prorate) {
      skipped.push({
        billingItemId: item.id,
        reason: 'partial-period-not-prorated',
        servicePeriodStart: activeStart,
        servicePeriodEnd: activeEnd,
      })
    } else {
      const gross = partial ? (item.unitPrice * activeDays) / periodDays : item.unitPrice
      const amount = roundHalfUp2dp(gross)
      lines.push({
        billingItemId: item.id,
        kind,
        servicePeriodStart: activeStart,
        servicePeriodEnd: activeEnd,
        amount: kind === 'credit' ? -amount : amount,
        proration: partial ? { activeDays, periodDays } : null,
      })
    }
    lastCovered = activeEnd
    period = gridPeriod(anchor, cycle, period.index + 1)
  }
  return { lines, skipped, lastCovered }
}

export function computeRecurringLines(
  item: RecurringItemState,
  params: { billDate: Date | string; cycle: CycleInput },
): RecurringComputation {
  const billedTo = optDate(item.billedToDate)
  if (item.deletedAt) {
    return { lines: [], newBilledToDate: billedTo, skipped: [{ billingItemId: item.id, reason: 'item-soft-deleted', servicePeriodStart: null, servicePeriodEnd: null }] }
  }
  if (!item.isActive) {
    return { lines: [], newBilledToDate: billedTo, skipped: [{ billingItemId: item.id, reason: 'item-inactive', servicePeriodStart: null, servicePeriodEnd: null }] }
  }

  const billDate = toDate(params.billDate)
  const { cycle } = params
  // Grid = the cycle-day boundaries. Equal to the bill date in steady state;
  // the cycle day before it when the bill date is off-day (alignment).
  const anchor = gridAnchorFor(billDate, cycle)
  const start = toDate(item.billStartDate)
  const end = optDate(item.billEndDate)

  // ── Credit: the item ended inside what was already billed (A-D2). ──
  if (end && billedTo && end.getTime() < billedTo.getTime()) {
    if (!item.prorate) {
      return {
        lines: [],
        newBilledToDate: billedTo,
        skipped: [{ billingItemId: item.id, reason: 'ended-after-billing-no-credit', servicePeriodStart: addDays(end, 1), servicePeriodEnd: billedTo }],
      }
    }
    const credit = slice(item, anchor, cycle, maxDate(addDays(end, 1), start), billedTo, 'credit')
    return { lines: credit.lines, newBilledToDate: end, skipped: credit.skipped }
  }

  // ── Charge: bill the unbilled window up to the horizon. ──
  const horizon =
    item.chargeTiming === 'in_arrears' ? addDays(billDate, -1) : addDays(advanceNextBillDate(billDate, cycle), -1)
  const cursor = billedTo ? maxDate(addDays(billedTo, 1), start) : start
  const windowEnd = end ? minDate(horizon, end) : horizon
  if (cursor.getTime() > windowEnd.getTime()) {
    return { lines: [], newBilledToDate: billedTo, skipped: [] }
  }
  const charge = slice(item, anchor, cycle, cursor, windowEnd, 'charge')
  return {
    lines: charge.lines,
    newBilledToDate: charge.lastCovered ?? billedTo,
    skipped: charge.skipped,
  }
}
