import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import {
  mapSubscriptionItemsToBillingItems,
  type CpqSubscriptionItem,
} from '../lib/chargeMapper'
import {
  computeProration,
  formatProrationDescription,
} from '../lib/prorationHelper'

/**
 * Subscriber: `cpq.subscription.amended` → mid-cycle add / remove.
 *
 * Per the spec's CPQ-side payload contract, the amended event carries:
 *   - `addedItems` — same shape as activation items (charges arrays).
 *   - `removedSubscriptionItemIds` — items being cancelled mid-cycle.
 *   - `proration` — `{ daysInPeriod, daysRemaining, cycleStart, cycleEnd }`
 *     covering the cycle the amend lands in.
 *
 * Connector behaviour:
 *   1. For each added item: create the matching recurring + one-time
 *      Billing Items. The recurring items start on `effectiveDate`
 *      (mid-cycle — the engine's recurring selector will skip the
 *      current cycle and bill from the next full cycle onward).
 *   2. For each added RECURRING charge: post a separate `one_time`
 *      Billing Item carrying the prorated value for the partial
 *      current cycle, so the customer pays for the mid-cycle slice.
 *      Description matches spec example: "Proration: <product> from
 *      <effectiveDate> to <cycleEnd>".
 *   3. For each removed subscription_item_id: find every existing
 *      Billing Item for that subscription item and set
 *      `bill_end_date = effectiveDate - 1 day` so the engine stops
 *      including it next cycle.
 *
 * Mid-cycle credit on removal (per spec) is the integrator's
 * responsibility — the connector posts the bill_end_date so future
 * cycles drop, but the customer-credit one_time line lives in the
 * CPQ amend math, not here.
 */

export const metadata = {
  event: 'cpq.subscription.amended',
  persistent: true,
  id: 'cpq-billing-connector:subscription-amended',
}

type ProrationInfo = {
  daysInPeriod: number
  daysRemaining: number
  cycleStart: string
  cycleEnd: string
}

type AmendedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  /** YYYY-MM-DD; the date the amend takes effect mid-cycle. */
  effectiveDate: string
  addedItems: CpqSubscriptionItem[]
  removedSubscriptionItemIds: string[]
  proration: ProrationInfo
}

function isoDateMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default async function handle(payload: AmendedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.effectiveDate) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  // The connector trusts the subscription already has an account
  // (activation ran first). If it doesn't, finding 0 items below
  // surfaces the problem indirectly; addedItems will still attempt
  // to create which will 404 on billAccountId — the queue retries
  // until the account exists.
  const existingItems = await billingApi.findItemsBySubscription(scope, payload.subscriptionId)
  if (existingItems.length === 0 && Array.isArray(payload.addedItems) && payload.addedItems.length === 0) {
    // No state to amend.
    return
  }
  const accountId =
    existingItems[0]?.billAccountId ??
    (await billingApi.findAccountByCustomer(scope, payload.customerId))?.id ??
    null
  if (!accountId) return

  // 1. Create new items.
  const newItemPayloads = mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.addedItems ?? [],
    billStartDate: payload.effectiveDate,
  })
  for (const item of newItemPayloads) {
    await billingApi.createItem(scope, {
      billAccountId: accountId,
      type: item.type,
      billStartDate: item.billStartDate,
      description: item.description,
      rateJson: item.rateJson,
      subscriptionId: item.subscriptionId,
      subscriptionItemId: item.subscriptionItemId,
      sourceRef: item.sourceRef,
    })
  }

  // 2. Proration one_time line per added recurring charge.
  for (const addedItem of payload.addedItems ?? []) {
    for (const charge of addedItem.charges) {
      if (charge.type !== 'recurring' || typeof charge.unitPrice !== 'number') continue
      const { amount } = computeProration({
        unitPrice: charge.unitPrice,
        quantity: addedItem.quantity,
        daysInPeriod: payload.proration.daysInPeriod,
        daysRemaining: payload.proration.daysRemaining,
      })
      if (amount === 0) continue
      const description = formatProrationDescription({
        productName: addedItem.productName,
        effectiveDate: payload.effectiveDate,
        cycleEnd: payload.proration.cycleEnd,
      })
      await billingApi.createItem(scope, {
        billAccountId: accountId,
        type: 'one_time',
        billStartDate: payload.effectiveDate,
        description,
        rateJson: { amount },
        subscriptionId: payload.subscriptionId,
        subscriptionItemId: addedItem.subscriptionItemId,
        sourceRef: `cpq-${payload.subscriptionId}-${addedItem.subscriptionItemId}-proration-${payload.effectiveDate}`,
      })
    }
  }

  // 3. End-date removed items.
  const endDate = isoDateMinusOneDay(payload.effectiveDate)
  for (const removedSubItemId of payload.removedSubscriptionItemIds ?? []) {
    const items = await billingApi.findItemsBySubscriptionItem(scope, removedSubItemId)
    for (const item of items) {
      await billingApi.updateItem(scope, {
        id: item.id,
        billEndDate: endDate,
      })
    }
  }
}
