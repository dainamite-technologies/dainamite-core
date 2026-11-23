import { mapChargeToBillingItem, type CpqSubscriptionItem } from './chargeMapper'
import type { BillingApiClient, CreditReasonCode, ItemCreatePayload, ItemUpdatePayload, Scope } from './billingApiClient'
import { buildArcEndDateUpdate } from './arcEndDate'

/**
 * Re-rating of a subscription item whose recurring price changed on an ARC
 * quote (`changedItems` of `cpq.subscription.amended` / `renewed`, #126).
 * Pure.
 *
 * The item's current recurring Billing Items end the day before the change
 * takes effect, and one new recurring Billing Item at the new price starts on
 * that day. One-time charges are never re-billed. The new item's source ref
 * carries the order id (or the effective date), so a re-delivered event is
 * deduplicated by billing and never ends the item it created itself.
 */

export type RerateExistingItem = {
  id: string
  type: string
  sourceRef?: string | null
  billStartDate: Date | string
  billEndDate?: Date | string | null
}

export type RerateChange = {
  subscriptionId: string
  /** YYYY-MM-DD the new price applies from. */
  effectiveDate: string
  /** CPQ order id; falls back to the effective date in the source ref. */
  sourceOrderId?: string | null
  code: CreditReasonCode
  reference?: string | null
}

export function reratedSourceRef(
  subscriptionId: string,
  subscriptionItemId: string,
  key: string,
): string {
  return `cpq-${subscriptionId}-${subscriptionItemId}-recurring-rerate-${key}`
}

/** End-date updates for the item's current recurring Billing Items. */
export function buildRerateEndUpdates(
  existing: RerateExistingItem[],
  item: CpqSubscriptionItem,
  change: RerateChange,
): ItemUpdatePayload[] {
  const ownRef = reratedSourceRef(change.subscriptionId, item.subscriptionItemId, change.sourceOrderId || change.effectiveDate)
  return existing
    .filter((candidate) => candidate.type === 'recurring' && candidate.sourceRef !== ownRef)
    .map((candidate) =>
      buildArcEndDateUpdate(candidate, { effectiveDate: change.effectiveDate, code: change.code, reference: change.reference }),
    )
    .filter((update): update is ItemUpdatePayload => update !== null)
}

/** The new recurring Billing Item at the changed price, or null when the price is now zero. */
export function buildReratedItemPayload(
  billAccountId: string,
  item: CpqSubscriptionItem,
  change: RerateChange,
): ItemCreatePayload | null {
  const charge = item.charges.find((candidate) => candidate.type === 'recurring')
  if (!charge || typeof charge.unitPrice !== 'number' || charge.unitPrice <= 0) return null
  const mapped = mapChargeToBillingItem({
    subscriptionId: change.subscriptionId,
    subscriptionItem: item,
    charge,
    billStartDate: change.effectiveDate,
  })
  if (!mapped) return null
  return {
    billAccountId,
    type: mapped.type,
    billStartDate: mapped.billStartDate,
    description: mapped.description,
    rateJson: mapped.rateJson,
    subscriptionId: mapped.subscriptionId,
    subscriptionItemId: mapped.subscriptionItemId,
    sourceRef: reratedSourceRef(change.subscriptionId, item.subscriptionItemId, change.sourceOrderId || change.effectiveDate),
  }
}

/**
 * Applies the re-rating of every changed item: the new recurring Billing Item
 * first (deduplicated on re-delivery), then the end dates of the old ones.
 */
export async function applyRerates(
  billingApi: Pick<BillingApiClient, 'findItemsBySubscriptionItem' | 'bulkCreateItems' | 'updateItem'>,
  scope: Scope,
  billAccountId: string,
  changedItems: CpqSubscriptionItem[],
  change: RerateChange,
): Promise<void> {
  for (const item of changedItems) {
    const existing = (await billingApi.findItemsBySubscriptionItem(scope, item.subscriptionItemId)) as RerateExistingItem[]
    const created = buildReratedItemPayload(billAccountId, item, change)
    if (created) await billingApi.bulkCreateItems(scope, [created])
    for (const update of buildRerateEndUpdates(existing, item, change)) {
      await billingApi.updateItem(scope, update)
    }
  }
}
