/**
 * Contract C2 (run plan 2026-11-26 billing/CPQ flex): the price phases of one
 * recurring payload charge.
 *
 * A subscription item's MRC charges of **one billing period** are merged into
 * one item schedule (spec P §4.3): the union of their phase boundaries, with
 * the prices summed. Each merged phase goes out as a *Fixed price* phase with
 * its name; the regular price after the last phase is the charge's
 * `unitPrice`, so it is not a phase.
 *
 * Pure (no ORM, no DI). Callers pass the MRC charges of one period only
 * (`buildRecurringPayloadCharges` groups them per period).
 */
import { segmentAt, segmentsFor, scheduleRanges, type ChargeScheduleSegment } from './priceSchedule'

export interface PayloadPhase {
  name: string | null
  months: number
  priceType: 'fixed'
  /** Price per the charge's billing period for the whole line (quantity applied). */
  value: number
}

type StoredCharge = Record<string, unknown>

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function scheduleOf(charge: StoredCharge): ChargeScheduleSegment[] {
  return Array.isArray(charge.schedule) ? (charge.schedule as ChargeScheduleSegment[]) : []
}

function amount(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

/**
 * Merged phases of a line's recurring charges of one billing period.
 * Empty when no charge has a schedule (today's payload).
 */
export function mergeRecurringPhases(charges: ReadonlyArray<StoredCharge>, quantity: number): PayloadPhase[] {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  const recurring = charges.filter((charge) => charge.chargeType === 'mrc' && charge.totalPrice != null)
  if (!recurring.some((charge) => scheduleOf(charge).length > 0)) return []
  const segments = segmentsFor(recurring.flatMap((charge) => scheduleRanges(scheduleOf(charge))))
  const regular = round4(recurring.reduce((sum, charge) => sum + amount(charge.totalPrice), 0) * qty)
  const phases: PayloadPhase[] = []
  for (const segment of segments) {
    if (segment.toMonth === null) break // the open segment is the regular price
    let value = 0
    const names: string[] = []
    for (const charge of recurring) {
      const schedule = scheduleOf(charge)
      const priced = schedule.length ? segmentAt(schedule, segment.fromMonth) : undefined
      value += amount(priced ? priced.totalPrice : charge.totalPrice)
      if (priced?.name && !names.includes(priced.name)) names.push(priced.name)
    }
    const phase: PayloadPhase = {
      name: names.length ? names.join(' + ') : null,
      months: segment.toMonth - segment.fromMonth + 1,
      priceType: 'fixed',
      value: round4(value * qty),
    }
    const previous = phases.at(-1)
    if (previous && previous.value === phase.value && previous.name === phase.name) previous.months += phase.months
    else phases.push(phase)
  }
  // Trailing phases at the regular price, without a name, add nothing.
  while (phases.length && phases.at(-1)!.value === regular && phases.at(-1)!.name === null) phases.pop()
  return phases
}
