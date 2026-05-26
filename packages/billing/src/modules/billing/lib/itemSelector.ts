import type { BillingItem } from '../data/entities'
import type { BillPeriod } from './billPeriod'

/**
 * Decide whether a Billing Item contributes to a given bill period.
 *
 * Two anti-duplicate guards working together (spec "Why two anti-duplicate
 * guards"):
 *
 *   1. `billed_to_date` — per-item watermark. Set after a successful
 *      real-mode run that emitted this item; prevents re-billing the
 *      same item even if the period boundaries shift.
 *   2. Open-draft check — per-account, handled by the engine before it
 *      even invokes this selector (see `billRunEngine`). Not this
 *      module's concern.
 *
 * Per-type semantics from the spec:
 *
 *   `one_time` — one shot per item, ever. Eligible only if
 *      `billed_to_date IS NULL` AND the item's `[bill_start_date,
 *      bill_end_date]` window overlaps the bill period.
 *
 *   `recurring` — one line per full cycle. Eligible only when:
 *      - `bill_start_date <= bill_period_start`
 *      - AND (`bill_end_date IS NULL` OR `bill_end_date >= bill_period_end`)
 *      - AND (`billed_to_date IS NULL` OR `billed_to_date < bill_period_end`)
 *
 *      Mid-cycle starts / cancels are SKIPPED — the integrator is
 *      responsible for posting a `one_time` proration line if the
 *      partial period should be charged (spec "Mid-cycle recurring
 *      items").
 *
 *   `usage` — not handled here. Phase 3 owns usage rating end-to-end.
 *
 * All comparisons treat dates as midnight (consistent with `billPeriod`).
 */

export type SelectableItem = Pick<
  BillingItem,
  | 'id'
  | 'type'
  | 'billStartDate'
  | 'billEndDate'
  | 'billedToDate'
  | 'description'
  | 'rateJson'
  | 'isActive'
  | 'deletedAt'
>

export type SelectionDecision =
  | { include: true }
  | { include: false; reason: string }

function asTime(date: Date | null | undefined): number | null {
  if (!date) return null
  return new Date(date).getTime()
}

function isWithin(
  windowStart: Date,
  windowEnd: Date | null | undefined,
  point: Date,
): boolean {
  const pointTime = asTime(point)!
  const startTime = asTime(windowStart)!
  if (pointTime < startTime) return false
  const endTime = asTime(windowEnd)
  if (endTime === null) return true
  return pointTime <= endTime
}

function overlapsPeriod(
  itemStart: Date,
  itemEnd: Date | null | undefined,
  period: BillPeriod,
): boolean {
  const itemStartTime = asTime(itemStart)!
  const itemEndTime = asTime(itemEnd)
  const periodStartTime = asTime(period.periodStart)!
  const periodEndTime = asTime(period.periodEnd)!
  if (itemStartTime > periodEndTime) return false
  if (itemEndTime !== null && itemEndTime < periodStartTime) return false
  return true
}

export function shouldIncludeItem(
  item: SelectableItem,
  period: BillPeriod,
): SelectionDecision {
  if (!item.isActive) return { include: false, reason: 'item-inactive' }
  if (item.deletedAt) return { include: false, reason: 'item-soft-deleted' }

  switch (item.type) {
    case 'one_time': {
      if (item.billedToDate) {
        return { include: false, reason: 'one_time-already-billed' }
      }
      if (!overlapsPeriod(item.billStartDate, item.billEndDate, period)) {
        return { include: false, reason: 'one_time-window-outside-period' }
      }
      return { include: true }
    }
    case 'recurring': {
      const billedToTime = asTime(item.billedToDate)
      const periodEndTime = asTime(period.periodEnd)!
      if (billedToTime !== null && billedToTime >= periodEndTime) {
        return { include: false, reason: 'recurring-already-billed-through-period' }
      }
      const periodStartTime = asTime(period.periodStart)!
      const itemStartTime = asTime(item.billStartDate)!
      if (itemStartTime > periodStartTime) {
        return { include: false, reason: 'recurring-starts-mid-cycle' }
      }
      const itemEndTime = asTime(item.billEndDate)
      if (itemEndTime !== null && itemEndTime < periodEndTime) {
        return { include: false, reason: 'recurring-ends-mid-cycle' }
      }
      return { include: true }
    }
    case 'usage':
      // Phase 3 routes usage items through the dedicated usage rater.
      // The selector returns "skip" so the engine's recurring/one_time
      // path is unaffected.
      return { include: false, reason: 'usage-handled-by-rater' }
    default:
      return { include: false, reason: `unknown-type:${item.type}` }
  }
}

/**
 * Pure filter — given the items already loaded for an account, returns
 * those eligible for the bill period together with the decision reason
 * for diagnostics (the engine logs skipped items in the run outcome's
 * warnings on demand).
 */
export function selectItemsForPeriod<T extends SelectableItem>(
  items: readonly T[],
  period: BillPeriod,
): { included: T[]; skipped: Array<{ item: T; reason: string }> } {
  const included: T[] = []
  const skipped: Array<{ item: T; reason: string }> = []
  for (const item of items) {
    const decision = shouldIncludeItem(item, period)
    if (decision.include) {
      included.push(item)
    } else {
      skipped.push({ item, reason: decision.reason })
    }
  }
  return { included, skipped }
}

export { isWithin, overlapsPeriod }
