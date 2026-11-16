import { toIsoDate } from './orderSetupResolution'

/**
 * Earliest activation date of an ARC order — spec
 * `2026-11-16-billing-operator-polish-and-bill-cycle-day` Part 2, 6c / D11.
 * Pure.
 *
 * CPQ has no operator-chosen amendment date: an `amend` / `cancel` order takes
 * effect the moment it is activated. Activating it before billing of the
 * target subscription has started would end items that have not billed yet,
 * so the earliest activation date is the LATEST `billStartDate` among the
 * target subscriptions' billing items that are:
 *   - active (`isActive`), and
 *   - not already ended before they start (`billEndDate < billStartDate`:
 *     "cancelled before start" — they never bill).
 *
 * Renewals and new-business orders have no constraint (`null`).
 */

/** Quote types whose activation ends existing billing items. */
const CONSTRAINED_QUOTE_TYPES = new Set(['amend', 'cancel'])

export function isActivationConstrained(quoteType: string): boolean {
  return CONSTRAINED_QUOTE_TYPES.has(quoteType)
}

export type ActivationBillingItem = {
  subscriptionId?: string | null
  description: string
  billStartDate: Date | string
  billEndDate?: Date | string | null
  isActive: boolean
}

export type EarliestActivation = {
  /** YYYY-MM-DD */
  date: string
  subscriptionId: string
  itemDescription: string
}

export function computeEarliestActivation(
  quoteType: string,
  items: ActivationBillingItem[],
): EarliestActivation | null {
  if (!isActivationConstrained(quoteType)) return null
  let latest: EarliestActivation | null = null
  for (const item of items) {
    if (!item.isActive || !item.subscriptionId) continue
    const start = toIsoDate(item.billStartDate)
    if (!start) continue
    const end = toIsoDate(item.billEndDate)
    if (end && end < start) continue
    if (!latest || start > latest.date) {
      latest = { date: start, subscriptionId: item.subscriptionId, itemDescription: item.description }
    }
  }
  return latest
}

/** Activation on `today` (YYYY-MM-DD) is blocked when it is before the earliest date. */
export function isActivationBlocked(earliest: EarliestActivation | null, today: string): boolean {
  return earliest !== null && today < earliest.date
}

/** Order statuses that can still be activated. */
const ACTIVATABLE_ORDER_STATUSES = new Set(['draft', 'pending_activation'])

/**
 * The date the Billing tab warns about: the earliest activation date while
 * it is still in the future and the order can still be activated; `null`
 * (no callout) otherwise.
 */
export function activationHintDate(
  view: { orderStatus: string; earliestActivationDate: string | null },
  today: string,
): string | null {
  if (!ACTIVATABLE_ORDER_STATUSES.has(view.orderStatus)) return null
  const date = view.earliestActivationDate
  return date && date > today ? date : null
}
