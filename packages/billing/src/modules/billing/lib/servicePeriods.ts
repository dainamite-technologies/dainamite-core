import type { ChargeTiming } from '../data/validators'
import type { BillCycle, CycleInput } from './billCycle'
import { addDays, advanceNextBillDate, approxCycleDays, cloneAtMidnight, gridAnchorFor, shiftCycles } from './billPeriod'
import { phaseAt, phasePeriodPrice, type PhasePriceType, type ResolvedPhase } from './pricePhases'
import { isNoCharge, type ItemStatus, type StatusChargeBehavior } from './itemStatusPeriods'

/**
 * Recurring-charge computation for one bill date (Spec A, extended by the
 * line-period-and-status and price-phases specs).
 *
 * Pure and storage-agnostic: given an item's state and the account's bill
 * date, decide which service periods to charge (or credit) and where the
 * item's `billed_to_date` watermark moves. The engine calls it once per item
 * per simulated bill date and owns persistence. Used by the postpaid Bill Run
 * AND the prepaid period close.
 *
 * ONE model, three inputs:
 *
 *   1. The GRID — where one billing period of the item starts and ends.
 *      - Item follows the account (`billingPeriod` null, today's behaviour):
 *        the account's cycle grid anchored at the bill date `D` (or the cycle
 *        day before it while aligning): …, D − cycle, D, D + cycle, …
 *      - Item with its own period (L-D3): the item's grid counted from its
 *        `bill_start_date` — start, start + P, start + 2P, … — no stub.
 *      The item's price (and a phase's fixed price) is per grid period.
 *
 *   2. The HORIZON — how far the item is billed on `D`:
 *      - account grid: in_advance → next bill date − 1; in_arrears → D − 1.
 *      - own grid, in_advance: through the end of the item period that
 *        contains next bill date − 1, i.e. every period that STARTS before
 *        the next bill date (the bill date on or before the period start).
 *      - own grid, in_arrears: through the last item period that ENDED
 *        before `D` (the first bill date after the period end). A period cut
 *        short by `bill_end_date` ends there.
 *
 *   3. The PRICE of a day range inside one grid period:
 *      - split at phase boundaries on the exact date (P-D3), each part
 *        prorated by days against the full grid period; `prorate=false` →
 *        no split, the phase in force on the period's first day prices it;
 *      - days in a no-charge status period (paused, or suspended with
 *        `no_charge`) are not charged — always prorated by days.
 *
 * Unbilled window = `[cursor, min(horizon, bill_end_date)]` with cursor =
 * `billed_to_date + 1` (else `bill_start_date`), cut along the grid. A
 * partial grid period (start / end inside it) is prorated, or skipped when
 * `prorate=false` (as before).
 *
 * Billed window corrections (`[bill_start_date, billed_to_date]`):
 *   - End credit (A-D2): an item ended before `billed_to_date` gets negative
 *     lines for the unused days when `prorate=true`; the watermark is pulled
 *     back to `bill_end_date`.
 *   - Status credit (L §4.3): no-charge status days that were already billed
 *     (the pause was recorded late) are credited, with the status as reason.
 *   - Status re-charge: days that were left uncharged for a status that was
 *     later shortened or removed are charged.
 *   Each status period remembers which of its days the engine already left
 *   uncharged (`appliedFrom` / `appliedTo`); the computation returns the new
 *   values in `statusApplied`, persisted with the watermark.
 *
 * Grouping: consecutive lines of the same phase (or, on an item with its own
 * period, consecutive full periods at the same price) become ONE line —
 * `quantity` periods × `unitAmount` ("Mobile weekly pack × 4"), or a merged
 * phase span ("Free trial · 14 Nov – 13 Dec").
 *
 * The watermark stays the single source of truth against double billing:
 * every charge starts at `billed_to_date + 1`, so switching timing or period,
 * re-running a bill date, or catching up can never charge a day twice.
 */

export type ItemBillingPeriod = { unit: BillCycle; interval: number }

export type ItemStatusPeriodState = {
  id: string
  status: ItemStatus
  fromDate: Date | string
  toDate?: Date | string | null
  chargeBehavior?: StatusChargeBehavior | null
  reason?: string | null
  /** Days of this period the engine already left uncharged (inclusive). */
  appliedFrom?: Date | string | null
  appliedTo?: Date | string | null
  /** Soft-deleted rows still count for `applied*` (their days get re-charged). */
  deletedAt?: Date | string | null
}

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
  /** Own billing period (L §4.2). Null / omitted = follow the account cycle. */
  billingPeriod?: ItemBillingPeriod | null
  /** Resolved phases (`resolvePhases`); empty / omitted = regular price only. */
  phases?: readonly ResolvedPhase[]
  statusPeriods?: readonly ItemStatusPeriodState[]
}

export type ProrationInfo = { activeDays: number; periodDays: number }

export type RecurringLinePhase = {
  index: number
  name: string | null
  priceType: PhasePriceType
  value: number | null
}

export type RecurringLineReason =
  | { kind: 'status'; statusPeriodId: string; status: ItemStatus; fromDate: Date; toDate: Date | null; text: string | null }
  | { kind: 'status_reversal'; statusPeriodId: string; status: ItemStatus; fromDate: Date; toDate: Date | null; text: string | null }

export type RecurringLine = {
  billingItemId: string
  kind: 'charge' | 'credit'
  /** Inclusive service period the line covers. */
  servicePeriodStart: Date
  servicePeriodEnd: Date
  /** 2dp half-up; negative for credits. Always `quantity × unitAmount` for grouped lines. */
  amount: number
  /** Null when the line covers full grid periods (or merges several pieces). */
  proration: ProrationInfo | null
  /** Billing periods grouped on this line (1 unless grouped). */
  quantity: number
  /** Amount per grouped period (= `amount` when `quantity` is 1). */
  unitAmount: number
  /** The phase that priced the line; null = regular price. */
  phase: RecurringLinePhase | null
  /** Status credit / re-charge: why the line exists. */
  reason: RecurringLineReason | null
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

export type StatusAppliedUpdate = { id: string; appliedFrom: Date | null; appliedTo: Date | null }

export type RecurringComputation = {
  lines: RecurringLine[]
  /** Watermark after these lines; unchanged when nothing was billed. */
  newBilledToDate: Date | null
  skipped: RecurringSkip[]
  /** Status periods whose `applied*` range changed (persist with the watermark). */
  statusApplied: StatusAppliedUpdate[]
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

// ─── Day ranges (day numbers since epoch, inclusive) ──────────────

type Range = [number, number]

const dayNum = (date: Date): number => Math.round(date.getTime() / DAY_MS)
const fromDayNum = (n: number): Date => new Date(n * DAY_MS)
const OPEN_END = Number.MAX_SAFE_INTEGER

function normalize(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0])
  const out: Range[] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

function intersect(a: readonly Range[], b: readonly Range[]): Range[] {
  const out: Range[] = []
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0)
      const hi = Math.min(a1, b1)
      if (lo <= hi) out.push([lo, hi])
    }
  }
  return normalize(out)
}

function subtract(a: readonly Range[], b: readonly Range[]): Range[] {
  let current = normalize(a)
  for (const [b0, b1] of normalize(b)) {
    const next: Range[] = []
    for (const [a0, a1] of current) {
      if (b1 < a0 || b0 > a1) {
        next.push([a0, a1])
        continue
      }
      if (a0 < b0) next.push([a0, b0 - 1])
      if (a1 > b1) next.push([b1 + 1, a1])
    }
    current = next
  }
  return current
}

// ─── Grid ──────────────────────────────────────────────────────────

type GridPeriod = { index: number; start: Date; end: Date }
type Grid = { anchor: Date; cycle: CycleInput }

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

/** The item's own grid: periods counted from its start, never pinned. */
export function itemGridCycle(period: ItemBillingPeriod): CycleInput {
  return { cycle: period.unit, interval: Math.max(1, Math.floor(period.interval)), day: null }
}

// ─── Pricing ───────────────────────────────────────────────────────

type SliceOptions = {
  kind: RecurringLine['kind']
  /** Days not to price (no-charge status days). */
  exclude: readonly Range[]
  /** Skip a partial grid period when `prorate=false` (the charge path). */
  skipPartialUnprorated: boolean
  reason: RecurringLineReason | null
}

function toLinePhase(phase: ResolvedPhase | null): RecurringLinePhase | null {
  return phase ? { index: phase.index, name: phase.name, priceType: phase.priceType, value: phase.value } : null
}

/** Pieces of `[from, to]` (day numbers) with the phase in force on each. */
function splitByPhase(phases: readonly ResolvedPhase[], from: number, to: number): Array<{ from: number; to: number; phase: ResolvedPhase | null }> {
  const cuts = new Set<number>([from])
  for (const p of phases) {
    const s = dayNum(p.start)
    const e = dayNum(p.end) + 1
    if (s > from && s <= to) cuts.add(s)
    if (e > from && e <= to) cuts.add(e)
  }
  const starts = Array.from(cuts).sort((a, b) => a - b)
  return starts.map((s, i) => ({
    from: s,
    to: i + 1 < starts.length ? starts[i + 1] - 1 : to,
    phase: phaseAt(phases, fromDayNum(s)),
  }))
}

/**
 * Slices `[from, to]` along the grid and prices each slice (phases, status
 * exclusions). Shared by the charge and credit paths so both prorate identically.
 */
function slice(
  item: RecurringItemState,
  grid: Grid,
  from: Date,
  to: Date,
  options: SliceOptions,
): { lines: RecurringLine[]; skipped: RecurringSkip[]; lastCovered: Date | null } {
  const lines: RecurringLine[] = []
  const skipped: RecurringSkip[] = []
  const phases = item.phases ?? []
  let lastCovered: Date | null = null
  let period = gridPeriodContaining(grid.anchor, grid.cycle, from)
  let count = 0
  while (period.start.getTime() <= to.getTime()) {
    if (count++ >= MAX_PERIODS_PER_ITEM) {
      skipped.push({ billingItemId: item.id, reason: 'period-cap-reached', servicePeriodStart: period.start, servicePeriodEnd: null })
      break
    }
    const activeStart = maxDate(period.start, from)
    const activeEnd = minDate(period.end, to)
    const periodDays = inclusiveDays(period.start, period.end)
    const partial = inclusiveDays(activeStart, activeEnd) < periodDays
    if (partial && !item.prorate && options.skipPartialUnprorated) {
      skipped.push({
        billingItemId: item.id,
        reason: 'partial-period-not-prorated',
        servicePeriodStart: activeStart,
        servicePeriodEnd: activeEnd,
      })
    } else {
      const pieces = subtract([[dayNum(activeStart), dayNum(activeEnd)]], options.exclude)
      // prorate=false: the phase in force on the period's first day prices it.
      const fixedPhase = item.prorate ? null : phaseAt(phases, period.start)
      for (const [p0, p1] of pieces) {
        const segments = item.prorate ? splitByPhase(phases, p0, p1) : [{ from: p0, to: p1, phase: fixedPhase }]
        for (const segment of segments) {
          const days = segment.to - segment.from + 1
          const full = days === periodDays
          const price = phasePeriodPrice(item.unitPrice, segment.phase)
          const amount = roundHalfUp2dp(full ? price : (price * days) / periodDays)
          const signed = options.kind === 'credit' ? -amount : amount
          lines.push({
            billingItemId: item.id,
            kind: options.kind,
            servicePeriodStart: fromDayNum(segment.from),
            servicePeriodEnd: fromDayNum(segment.to),
            amount: signed,
            proration: full ? null : { activeDays: days, periodDays },
            quantity: 1,
            unitAmount: signed,
            phase: toLinePhase(segment.phase),
            reason: options.reason,
          })
        }
      }
    }
    lastCovered = activeEnd
    period = gridPeriod(grid.anchor, grid.cycle, period.index + 1)
  }
  return { lines, skipped, lastCovered }
}

function samePhase(a: RecurringLinePhase | null, b: RecurringLinePhase | null): boolean {
  return (a?.index ?? null) === (b?.index ?? null)
}

/**
 * Grouping (L §4.2, P §4.2 B): adjacent lines of the same kind, phase and
 * reason become one. Full periods at the same price stack as `quantity`;
 * other same-phase pieces merge into one dated span.
 */
function groupLines(lines: readonly RecurringLine[], ownPeriod: boolean): RecurringLine[] {
  const out: RecurringLine[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    const adjacent =
      prev &&
      prev.kind === line.kind &&
      prev.reason === line.reason &&
      samePhase(prev.phase, line.phase) &&
      dayNum(prev.servicePeriodEnd) + 1 === dayNum(line.servicePeriodStart)
    if (prev && adjacent && (ownPeriod || line.phase !== null)) {
      const stack = prev.proration === null && line.proration === null && prev.unitAmount === line.unitAmount
      if (stack) {
        prev.quantity += 1
        prev.amount = roundHalfUp2dp(prev.unitAmount * prev.quantity)
      } else if (line.phase !== null) {
        prev.amount = roundHalfUp2dp(prev.amount + line.amount)
        prev.quantity = 1
        prev.unitAmount = prev.amount
        prev.proration = null
      } else {
        out.push({ ...line })
        continue
      }
      prev.servicePeriodEnd = line.servicePeriodEnd
      continue
    }
    out.push({ ...line })
  }
  return out
}

// ─── Status periods ────────────────────────────────────────────────

type StatusRow = {
  state: ItemStatusPeriodState
  range: Range
  noCharge: boolean
  applied: Range | null
}

function statusRows(item: RecurringItemState): StatusRow[] {
  return (item.statusPeriods ?? []).map((state) => {
    const from = dayNum(toDate(state.fromDate))
    const to = state.toDate ? dayNum(toDate(state.toDate)) : OPEN_END
    const aFrom = optDate(state.appliedFrom)
    const aTo = optDate(state.appliedTo)
    return {
      state,
      range: [from, to] as Range,
      noCharge: !state.deletedAt && isNoCharge(state),
      applied: aFrom && aTo ? ([dayNum(aFrom), dayNum(aTo)] as Range) : null,
    }
  })
}

function statusReason(row: StatusRow, kind: 'status' | 'status_reversal'): RecurringLineReason {
  return {
    kind,
    statusPeriodId: row.state.id,
    status: row.state.status,
    fromDate: toDate(row.state.fromDate),
    toDate: optDate(row.state.toDate),
    text: row.state.reason?.trim() ? row.state.reason.trim() : null,
  }
}

function appliedUpdates(rows: readonly StatusRow[], billed: Range | null): StatusAppliedUpdate[] {
  const updates: StatusAppliedUpdate[] = []
  for (const row of rows) {
    const target = row.noCharge && billed ? intersect([row.range], [billed])[0] ?? null : null
    const same =
      (target === null && row.applied === null) ||
      (target !== null && row.applied !== null && target[0] === row.applied[0] && target[1] === row.applied[1])
    if (same) continue
    updates.push({
      id: row.state.id,
      appliedFrom: target ? fromDayNum(target[0]) : null,
      appliedTo: target ? fromDayNum(target[1]) : null,
    })
  }
  return updates
}

// ─── Entry point ───────────────────────────────────────────────────

/** Last day billed on `billDate` (before the end date), per the grid rules above. */
function horizonFor(
  item: RecurringItemState,
  grid: Grid,
  billDate: Date,
  cycle: CycleInput,
  start: Date,
  end: Date | null,
): Date {
  if (!item.billingPeriod) {
    return item.chargeTiming === 'in_arrears' ? addDays(billDate, -1) : addDays(advanceNextBillDate(billDate, cycle), -1)
  }
  if (item.chargeTiming === 'in_arrears') {
    const lastDay = addDays(billDate, -1)
    if (lastDay.getTime() < start.getTime()) return addDays(start, -1)
    const period = gridPeriodContaining(grid.anchor, grid.cycle, lastDay)
    const periodEnd = end ? minDate(period.end, end) : period.end
    return periodEnd.getTime() <= lastDay.getTime() ? periodEnd : addDays(period.start, -1)
  }
  const beforeNext = addDays(advanceNextBillDate(billDate, cycle), -1)
  if (beforeNext.getTime() < start.getTime()) return addDays(start, -1)
  return gridPeriodContaining(grid.anchor, grid.cycle, beforeNext).end
}

export function computeRecurringLines(
  item: RecurringItemState,
  params: { billDate: Date | string; cycle: CycleInput },
): RecurringComputation {
  const billedTo = optDate(item.billedToDate)
  if (item.deletedAt) {
    return { lines: [], newBilledToDate: billedTo, skipped: [{ billingItemId: item.id, reason: 'item-soft-deleted', servicePeriodStart: null, servicePeriodEnd: null }], statusApplied: [] }
  }
  if (!item.isActive) {
    return { lines: [], newBilledToDate: billedTo, skipped: [{ billingItemId: item.id, reason: 'item-inactive', servicePeriodStart: null, servicePeriodEnd: null }], statusApplied: [] }
  }

  const billDate = toDate(params.billDate)
  const { cycle } = params
  const start = toDate(item.billStartDate)
  const end = optDate(item.billEndDate)
  const ownPeriod = Boolean(item.billingPeriod)
  // Account grid = the cycle-day boundaries (the bill date in steady state;
  // the cycle day before it when off-day). Own grid = from the item start.
  const grid: Grid = item.billingPeriod
    ? { anchor: start, cycle: itemGridCycle(item.billingPeriod) }
    : { anchor: gridAnchorFor(billDate, cycle), cycle }

  const rows = statusRows(item)
  const noCharge = normalize(rows.filter((r) => r.noCharge).map((r) => r.range))
  const applied = normalize(rows.flatMap((r) => (r.applied ? [r.applied] : [])))

  const lines: RecurringLine[] = []
  const skipped: RecurringSkip[] = []

  // ── Billed window: status credits and re-charges (L §4.3). ──
  const billedEnd = billedTo ? (end ? minDate(end, billedTo) : billedTo) : null
  if (billedEnd && billedEnd.getTime() >= start.getTime()) {
    const past: Range = [dayNum(start), dayNum(billedEnd)]
    for (const row of rows) {
      // Charged, but now a no-charge status day → credit.
      if (row.noCharge) {
        for (const [a, b] of subtract(intersect([row.range], [past]), applied)) {
          const credit = slice(item, grid, fromDayNum(a), fromDayNum(b), {
            kind: 'credit',
            exclude: [],
            skipPartialUnprorated: false,
            reason: statusReason(row, 'status'),
          })
          lines.push(...credit.lines)
        }
      }
      // Left uncharged, but no longer a no-charge day → charge.
      if (row.applied) {
        for (const [a, b] of subtract(intersect([row.applied], [past]), noCharge)) {
          const charge = slice(item, grid, fromDayNum(a), fromDayNum(b), {
            kind: 'charge',
            exclude: [],
            skipPartialUnprorated: false,
            reason: statusReason(row, 'status_reversal'),
          })
          lines.push(...charge.lines)
        }
      }
    }
  }

  // ── End credit: the item ended inside what was already billed (A-D2). ──
  if (end && billedTo && end.getTime() < billedTo.getTime()) {
    if (!item.prorate) {
      skipped.push({ billingItemId: item.id, reason: 'ended-after-billing-no-credit', servicePeriodStart: addDays(end, 1), servicePeriodEnd: billedTo })
      return {
        lines: groupLines(lines, ownPeriod),
        newBilledToDate: billedTo,
        skipped,
        statusApplied: appliedUpdates(rows, [dayNum(start), dayNum(billedTo)]),
      }
    }
    const creditFrom = maxDate(addDays(end, 1), start)
    if (creditFrom.getTime() <= billedTo.getTime()) {
      // Days left uncharged for a status were never billed — nothing to credit.
      const credit = slice(item, grid, creditFrom, billedTo, {
        kind: 'credit',
        exclude: applied,
        skipPartialUnprorated: false,
        reason: null,
      })
      lines.push(...credit.lines)
      skipped.push(...credit.skipped)
    }
    return {
      lines: groupLines(lines, ownPeriod),
      newBilledToDate: end,
      skipped,
      statusApplied: appliedUpdates(rows, end.getTime() >= start.getTime() ? [dayNum(start), dayNum(end)] : null),
    }
  }

  // ── Charge: bill the unbilled window up to the horizon. ──
  const horizon = horizonFor(item, grid, billDate, cycle, start, end)
  const cursor = billedTo ? maxDate(addDays(billedTo, 1), start) : start
  const windowEnd = end ? minDate(horizon, end) : horizon
  let newBilledToDate = billedTo
  if (cursor.getTime() <= windowEnd.getTime()) {
    const charge = slice(item, grid, cursor, windowEnd, {
      kind: 'charge',
      exclude: noCharge,
      skipPartialUnprorated: true,
      reason: null,
    })
    lines.push(...charge.lines)
    skipped.push(...charge.skipped)
    newBilledToDate = charge.lastCovered ?? billedTo
  }
  return {
    lines: groupLines(lines, ownPeriod),
    newBilledToDate,
    skipped,
    statusApplied: appliedUpdates(rows, newBilledToDate && newBilledToDate.getTime() >= start.getTime() ? [dayNum(start), dayNum(newBilledToDate)] : null),
  }
}
