import { addDays, cloneAtMidnight, shiftCycles } from './billPeriod'
import type { BillCycle } from './billCycle'

/**
 * Price phases on a recurring billing item (price-phases spec, Phase 1).
 *
 * A phase overrides the item's regular price for a duration. Phases run back
 * to back from the item's bill start date; after the last one the regular
 * price (`rate_json.unit_price`) applies. Pure: resolution to dates, the price
 * a phase charges per billing period, and the "only unbilled periods are
 * editable" guard. The engine (`servicePeriods.ts`) splits lines on the dates.
 *
 * Durations are calendar units counted from the phase's own start (Postgres
 * `interval` semantics, month ends clamp): "1 month" from 14 Nov ends 13 Dec,
 * "1 month" from 31 Jan ends 27 Feb (the next phase starts 28 Feb).
 */

export const PHASE_PRICE_TYPES = ['free', 'fixed', 'percent_off', 'amount_off'] as const
export type PhasePriceType = (typeof PHASE_PRICE_TYPES)[number]

export const PHASE_DURATION_UNITS = ['day', 'week', 'month', 'year'] as const
export type PhaseDurationUnit = (typeof PHASE_DURATION_UNITS)[number]

/** Spec P §4.1: at most 12 phases per item. */
export const MAX_PHASES_PER_ITEM = 12

export const PHASE_EDIT_BILLED = 'billing.item.phase_edit_billed'
export const PHASES_RECURRING_ONLY = 'billing.item.phases_recurring_only'

export type PhaseDefinition = {
  id?: string | null
  name?: string | null
  durationUnit?: PhaseDurationUnit | null
  durationCount?: number | null
  /** Inclusive last day ('YYYY-MM-DD' or Date) — alternative to a duration. */
  endDate?: Date | string | null
  priceType: PhasePriceType
  value?: number | string | null
}

export type ResolvedPhase = {
  /** 0-based position in the schedule (= `sequence`). */
  index: number
  id: string | null
  name: string | null
  priceType: PhasePriceType
  value: number | null
  start: Date
  end: Date
}

const UNIT_TO_CYCLE: Record<PhaseDurationUnit, BillCycle> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'annually',
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Last day of a phase that starts on `start`, or null when the definition is unusable. */
export function phaseEnd(start: Date, phase: PhaseDefinition): Date | null {
  if (phase.endDate) {
    const end = cloneAtMidnight(phase.endDate)
    return Number.isNaN(end.getTime()) ? null : end
  }
  const count = phase.durationCount ?? 0
  if (!phase.durationUnit || !Number.isInteger(count) || count < 1) return null
  const next = shiftCycles(start, { cycle: UNIT_TO_CYCLE[phase.durationUnit], interval: count, day: null }, 1)
  return addDays(next, -1)
}

/**
 * Dates of every phase, back to back from `billStartDate`. A phase whose end
 * is before its start (an "until" date already passed by the previous phase)
 * is dropped — the validators reject such schedules on write.
 */
export function resolvePhases(billStartDate: Date | string, phases: readonly PhaseDefinition[]): ResolvedPhase[] {
  const resolved: ResolvedPhase[] = []
  let start = cloneAtMidnight(billStartDate)
  phases.slice(0, MAX_PHASES_PER_ITEM).forEach((phase, index) => {
    const end = phaseEnd(start, phase)
    if (!end || end.getTime() < start.getTime()) return
    resolved.push({
      index,
      id: phase.id ?? null,
      name: phase.name?.trim() ? phase.name.trim() : null,
      priceType: phase.priceType,
      value: phase.priceType === 'free' ? null : numberOrNull(phase.value),
      start,
      end,
    })
    start = addDays(end, 1)
  })
  return resolved
}

/** The phase in force on `date`, or null (regular price). */
export function phaseAt(phases: readonly ResolvedPhase[], date: Date): ResolvedPhase | null {
  const t = date.getTime()
  return phases.find((p) => p.start.getTime() <= t && p.end.getTime() >= t) ?? null
}

/** Price per billing period under `phase` (null = the regular price). */
export function phasePeriodPrice(regular: number, phase: Pick<ResolvedPhase, 'priceType' | 'value'> | null): number {
  if (!phase) return regular
  const value = phase.value ?? 0
  switch (phase.priceType) {
    case 'free':
      return 0
    case 'fixed':
      return value
    case 'percent_off':
      return regular * (1 - value / 100)
    case 'amount_off':
      return Math.max(0, regular - value)
  }
}

export type PhaseScheduleIssue = { index: number; path: string; message: string }

/**
 * Structural checks shared by the validators and commands: cap, exactly one
 * of duration / end date, value ranges, and "until" dates that move forward.
 */
export function validatePhaseSchedule(
  billStartDate: Date | string | null,
  phases: readonly PhaseDefinition[],
): PhaseScheduleIssue | null {
  if (phases.length > MAX_PHASES_PER_ITEM) {
    return { index: MAX_PHASES_PER_ITEM, path: 'phases', message: `At most ${MAX_PHASES_PER_ITEM} phases per item` }
  }
  let start = billStartDate ? cloneAtMidnight(billStartDate) : null
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index]
    const hasDuration = phase.durationUnit !== undefined && phase.durationUnit !== null
    const hasEnd = phase.endDate !== undefined && phase.endDate !== null && phase.endDate !== ''
    if (hasDuration === hasEnd) {
      return { index, path: 'durationUnit', message: 'Give either a duration (unit + count) or an end date' }
    }
    if (hasDuration && (!Number.isInteger(phase.durationCount ?? NaN) || (phase.durationCount ?? 0) < 1)) {
      return { index, path: 'durationCount', message: 'durationCount must be a whole number ≥ 1' }
    }
    const value = numberOrNull(phase.value)
    if (phase.priceType !== 'free') {
      if (value === null || value < 0) return { index, path: 'value', message: 'value must be a number ≥ 0' }
      if (phase.priceType === 'percent_off' && value > 100) {
        return { index, path: 'value', message: 'percent_off must be 0–100' }
      }
    }
    if (start) {
      const end = phaseEnd(start, phase)
      if (!end || end.getTime() < start.getTime()) {
        return { index, path: 'endDate', message: 'The phase ends before it starts (phases run back to back)' }
      }
      start = addDays(end, 1)
    }
  }
  return null
}

/**
 * Spec P §4.1: edits change only periods not yet invoiced. True when the
 * price of any day on or before `billedTo` differs between the two schedules
 * (names are cosmetic and ignored). `null` schedules mean "phases off".
 */
export function phaseEditTouchesBilled(
  before: readonly ResolvedPhase[],
  after: readonly ResolvedPhase[],
  billedTo: Date | string | null | undefined,
  regularBefore: number,
  regularAfter: number,
  firstDay: Date | string,
): boolean {
  if (!billedTo) return false
  const last = cloneAtMidnight(billedTo).getTime()
  const from = cloneAtMidnight(firstDay).getTime()
  if (last < from) return false
  const cuts = new Set<number>([from])
  for (const p of [...before, ...after]) {
    cuts.add(p.start.getTime())
    cuts.add(addDays(p.end, 1).getTime())
  }
  const sorted = Array.from(cuts).filter((t) => t >= from && t <= last).sort((a, b) => a - b)
  for (const t of sorted) {
    const day = new Date(t)
    const a = phaseAt(before, day)
    const b = phaseAt(after, day)
    if (phasePeriodPrice(regularBefore, a) !== phasePeriodPrice(regularAfter, b)) return true
  }
  return false
}

/**
 * "Change price" on a phased item (spec P §4.1): the copy starting on
 * `effectiveDate` keeps the remaining phases on their ORIGINAL dates, so the
 * promotion does not restart. Durations become "until" dates; the phase in
 * force on the effective date keeps its end.
 */
export function remainingPhasesFrom(
  phases: readonly ResolvedPhase[],
  effectiveDate: Date | string,
): PhaseDefinition[] {
  const t = cloneAtMidnight(effectiveDate).getTime()
  return phases
    .filter((p) => p.end.getTime() >= t)
    .map((p) => ({
      name: p.name,
      endDate: p.end.toISOString().slice(0, 10),
      priceType: p.priceType,
      value: p.value,
    }))
}
