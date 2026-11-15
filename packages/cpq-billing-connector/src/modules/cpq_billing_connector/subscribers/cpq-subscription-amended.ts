import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type ItemCreatePayload, type Scope } from '../lib/billingApiClient'
import {
  mapSubscriptionItemsToBillingItems,
  type CpqSubscriptionItem,
} from '../lib/chargeMapper'

/**
 * Subscriber: `cpq.subscription.amended` → mid-cycle add / remove.
 *
 * CPQ's amended event carries `addedItems`, `removedSubscriptionItemIds`
 * and the `effectiveDate` of the amendment. The connector:
 *   1. Creates a Billing Item for every added charge, starting on
 *      `effectiveDate`.
 *   2. End-dates every Billing Item of each removed subscription item at
 *      `effectiveDate - 1 day`.
 *
 * Proration is billing's job (billing Spec A): the Bill Run engine prorates
 * the partial period of an item that starts mid-cycle, and credits the
 * unused days of an item billed in advance that ends mid-cycle. The
 * connector therefore no longer posts its own `one_time` proration lines —
 * doing both would double-charge the customer. A "no refund, end at period
 * end" policy is expressed by CPQ choosing an `effectiveDate` on the period
 * boundary.
 */

export const metadata = {
  event: 'cpq.subscription.amended',
  persistent: true,
  id: 'cpq-billing-connector:subscription-amended',
}

export type AmendedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  /** YYYY-MM-DD; the date the amend takes effect mid-cycle. */
  effectiveDate: string
  addedItems?: CpqSubscriptionItem[]
  removedSubscriptionItemIds?: string[]
}

function isoDateMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Billing Item payloads for the added charges — pure, no proration lines. */
export function buildAddedItemPayloads(billAccountId: string, payload: AmendedPayload): ItemCreatePayload[] {
  return mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.addedItems ?? [],
    billStartDate: payload.effectiveDate,
  }).map((item) => ({
    billAccountId,
    type: item.type,
    billStartDate: item.billStartDate,
    description: item.description,
    rateJson: item.rateJson,
    subscriptionId: item.subscriptionId,
    subscriptionItemId: item.subscriptionItemId,
    sourceRef: item.sourceRef,
  }))
}

/** `bill_end_date` for the items of removed subscription items. */
export function removedItemEndDate(effectiveDate: string): string {
  return isoDateMinusOneDay(effectiveDate)
}

export default async function handle(payload: AmendedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.effectiveDate) return

  const added = payload.addedItems ?? []
  const removed = payload.removedSubscriptionItemIds ?? []
  if (added.length === 0 && removed.length === 0) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  // Activation runs first and creates the account. If it's missing,
  // there is nothing to amend — the queue will have retried activation.
  const account = await billingApi.findAccountByCustomer(scope, payload.customerId)
  if (!account) return

  // 1. New Billing Items for every added charge (the engine prorates the stub).
  const itemsToCreate = buildAddedItemPayloads(account.id, payload)
  if (itemsToCreate.length > 0) {
    await billingApi.bulkCreateItems(scope, itemsToCreate)
  }

  // 2. End-date every Billing Item of each removed subscription item.
  const endDate = removedItemEndDate(payload.effectiveDate)
  for (const removedSubItemId of removed) {
    const items = await billingApi.findItemsBySubscriptionItem(scope, removedSubItemId)
    for (const item of items) {
      await billingApi.updateItem(scope, {
        id: item.id,
        billEndDate: endDate,
      })
    }
  }
}
