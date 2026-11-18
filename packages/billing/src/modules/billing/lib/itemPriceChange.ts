import { toIsoDate, toUtcMidnight } from './dateOnly'

/**
 * Change the price of a recurring item from a date on (Spec F follow-up):
 * the current item ends the day before `effectiveDate`, and a copy with the
 * new price starts on `effectiveDate` and keeps the original end date.
 *
 * Nothing is billed twice: if the old item was already billed past the
 * change (in advance), the engine credits the unused days (prorate on) and
 * the new item charges them at the new price; with prorate off the old item
 * keeps them and the new item starts charging at its next full period.
 *
 * Pure — validates and computes the dates; the command does the writes.
 */

export type PriceChangeItem = {
  type: string
  isActive: boolean
  deletedAt?: Date | string | null
  billStartDate: Date | string
  billEndDate?: Date | string | null
}

export type PriceChangePlan = {
  /** New end date of the current item: the day before the change. */
  oldItemEndDate: Date
  /** Start of the new item: the effective date. */
  newItemStartDate: Date
  /** The new item keeps the original end date (null = open-ended). */
  newItemEndDate: Date | null
}

export type PriceChangeError =
  | 'billing.item.price_change_recurring_only'
  | 'billing.item.price_change_inactive'
  | 'billing.item.price_change_before_start'
  | 'billing.item.price_change_after_end'

export function planPriceChange(
  item: PriceChangeItem,
  effectiveDate: Date | string,
): { ok: true; plan: PriceChangePlan } | { ok: false; error: PriceChangeError } {
  if (item.type !== 'recurring') return { ok: false, error: 'billing.item.price_change_recurring_only' }
  if (!item.isActive || item.deletedAt) return { ok: false, error: 'billing.item.price_change_inactive' }
  const effective = toUtcMidnight(effectiveDate)
  const start = toUtcMidnight(item.billStartDate)
  // The current item must keep at least one day.
  if (effective.getTime() <= start.getTime()) return { ok: false, error: 'billing.item.price_change_before_start' }
  const end = item.billEndDate ? toUtcMidnight(item.billEndDate) : null
  if (end && effective.getTime() > end.getTime()) return { ok: false, error: 'billing.item.price_change_after_end' }
  const oldItemEndDate = new Date(effective)
  oldItemEndDate.setUTCDate(oldItemEndDate.getUTCDate() - 1)
  return { ok: true, plan: { oldItemEndDate, newItemStartDate: effective, newItemEndDate: end } }
}

export { toIsoDate }
