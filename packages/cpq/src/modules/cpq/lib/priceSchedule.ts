/**
 * Price phases on CPQ recurring charges — spec
 * `.ai/specs/2026-11-26-billing-price-phases-ramp-deals.md` (Phase 2).
 *
 * A month range (`fromMonth` / `toMonth`, 1-based, inclusive, `toMonth` null =
 * to the end) says which months of the subscription a price rule (D9) or a
 * manual adjustment applies to. `[1, null]` is permanent: today's behaviour.
 *
 * A charge priced with at least one month range gets a `schedule`: contiguous
 * segments from month 1, the last one open (`toMonth: null`). The charge's own
 * `unitPrice` / `totalPrice` (and standard prices) are the **regular price**,
 * i.e. the last segment. Charges without phases carry no `schedule`, so stored
 * snapshots from before this change read unchanged.
 *
 * Pure helpers (no ORM, no DI): shared by services, routes and client pages.
 */

export interface MonthRange {
  fromMonth?: number | null
  toMonth?: number | null
}

export type ScheduleSource = 'list' | 'rule' | 'manual'

export interface ChargeScheduleSegment {
  fromMonth: number
  /** Inclusive last month; null = to the end (the regular price). */
  toMonth: number | null
  /** Offer price of the segment (per unit / charge total, per billing period). */
  unitPrice: number
  totalPrice: number | null
  /** Standard price of the segment (list + the rules in force in those months). */
  standardUnitPrice: number
  standardTotalPrice: number | null
  /** What priced the segment: a manual adjustment wins over a rule, a rule over the list price. */
  source: ScheduleSource
  /** Phase name (manual adjustment `phaseName`, or the phased rules' names). */
  name: string | null
  /** Rules applied in the segment (D10: a priced quote keeps them after their campaign ends). */
  ruleCodes?: string[]
  /** Manual adjustment that priced the segment. */
  adjustmentId?: string
}

/** Upper bound for a month (50 years): keeps segment loops bounded. */
export const MAX_PHASE_MONTH = 600

export function normalizeRange(range: MonthRange): { fromMonth: number; toMonth: number | null } {
  const from = Number(range.fromMonth ?? 1)
  const to = range.toMonth == null ? null : Number(range.toMonth)
  return { fromMonth: Number.isInteger(from) && from >= 1 ? from : 1, toMonth: to !== null && Number.isInteger(to) ? to : null }
}

/** A range other than the permanent `[1, null]`. */
export function isPhasedRange(range: MonthRange): boolean {
  const { fromMonth, toMonth } = normalizeRange(range)
  return fromMonth > 1 || toMonth !== null
}

export function isActiveInMonth(range: MonthRange, month: number): boolean {
  const { fromMonth, toMonth } = normalizeRange(range)
  return month >= fromMonth && (toMonth === null || month <= toMonth)
}

export function rangesOverlap(a: MonthRange, b: MonthRange): boolean {
  const left = normalizeRange(a), right = normalizeRange(b)
  const leftEnd = left.toMonth ?? Number.POSITIVE_INFINITY
  const rightEnd = right.toMonth ?? Number.POSITIVE_INFINITY
  return left.fromMonth <= rightEnd && right.fromMonth <= leftEnd
}

/**
 * Segments cut at every range boundary: `[1..a-1], [a..b], [b+1..]`. Always
 * at least one segment; the last is open. Ranges that are permanent add no cut.
 */
export function segmentsFor(ranges: ReadonlyArray<MonthRange>): Array<{ fromMonth: number; toMonth: number | null }> {
  const starts = new Set<number>([1])
  for (const range of ranges) {
    const { fromMonth, toMonth } = normalizeRange(range)
    if (fromMonth <= MAX_PHASE_MONTH) starts.add(fromMonth)
    if (toMonth !== null && toMonth + 1 <= MAX_PHASE_MONTH + 1) starts.add(toMonth + 1)
  }
  const sorted = [...starts].sort((a, b) => a - b)
  return sorted.map((fromMonth, index) => ({ fromMonth, toMonth: index + 1 < sorted.length ? sorted[index + 1] - 1 : null }))
}

/** Segment boundaries of an existing schedule (as ranges, for `segmentsFor`). */
export function scheduleRanges(schedule: ReadonlyArray<ChargeScheduleSegment> | null | undefined): MonthRange[] {
  return (schedule ?? []).map((segment) => ({ fromMonth: segment.fromMonth, toMonth: segment.toMonth }))
}

/** The schedule segment in force in `month` (falls back to the last, open one). */
export function segmentAt<T extends { fromMonth: number; toMonth: number | null }>(schedule: ReadonlyArray<T>, month: number): T | undefined {
  return schedule.find((segment) => month >= segment.fromMonth && (segment.toMonth === null || month <= segment.toMonth)) ?? schedule.at(-1)
}

function sameSegmentPrice(a: ChargeScheduleSegment, b: ChargeScheduleSegment): boolean {
  return a.unitPrice === b.unitPrice && a.totalPrice === b.totalPrice && a.standardUnitPrice === b.standardUnitPrice &&
    a.standardTotalPrice === b.standardTotalPrice && a.source === b.source && a.name === b.name &&
    (a.adjustmentId ?? null) === (b.adjustmentId ?? null) && (a.ruleCodes ?? []).join('|') === (b.ruleCodes ?? []).join('|')
}

/**
 * Joins neighbouring segments that price the same way. Returns `undefined`
 * when one segment is left: a constant price needs no schedule.
 */
export function compactSchedule(schedule: ChargeScheduleSegment[]): ChargeScheduleSegment[] | undefined {
  const out: ChargeScheduleSegment[] = []
  for (const segment of schedule) {
    const previous = out.at(-1)
    if (previous && sameSegmentPrice(previous, segment)) previous.toMonth = segment.toMonth
    else out.push({ ...segment, ...(segment.ruleCodes ? { ruleCodes: [...segment.ruleCodes] } : {}) })
  }
  return out.length > 1 ? out : undefined
}

/** Months of `[fromMonth, toMonth]` inside the term `[1, termMonths]`. */
export function monthsInTerm(segment: { fromMonth: number; toMonth: number | null }, termMonths: number): number {
  const end = Math.min(segment.toMonth ?? termMonths, termMonths)
  return Math.max(0, end - segment.fromMonth + 1)
}

/** Rule codes a stored charge was priced with (regular price and every phase). */
export function storedRuleCodes(charges: ReadonlyArray<Record<string, unknown>> | null | undefined): Set<string> {
  const codes = new Set<string>()
  for (const charge of charges ?? []) {
    for (const entry of (charge.adjustments as Array<Record<string, unknown>> | null | undefined) ?? []) {
      if (entry.origin !== 'manual' && typeof entry.ruleCode === 'string') codes.add(entry.ruleCode)
    }
    for (const segment of (charge.schedule as ChargeScheduleSegment[] | null | undefined) ?? []) {
      for (const code of segment.ruleCodes ?? []) codes.add(code)
    }
  }
  return codes
}

/** Today's date as `YYYY-MM-DD` (UTC), the default pricing date for campaign checks. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** D10: a rule's campaign dates (inclusive; null = open) contain the pricing date. */
export function isInsideCampaign(rule: { validFrom?: string | null; validUntil?: string | null }, pricingDate: string): boolean {
  const from = rule.validFrom ? String(rule.validFrom).slice(0, 10) : null
  const until = rule.validUntil ? String(rule.validUntil).slice(0, 10) : null
  return (!from || pricingDate >= from) && (!until || pricingDate <= until)
}

/** A charge priced at its regular price for every month (D8: existing ARC lines). */
export function withoutSchedule<T extends { schedule?: unknown }>(charge: T): T {
  if (!charge.schedule) return charge
  const { schedule: _schedule, ...rest } = charge
  return rest as T
}
