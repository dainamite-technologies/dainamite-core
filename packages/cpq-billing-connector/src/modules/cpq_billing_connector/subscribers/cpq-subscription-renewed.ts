import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import {
  mapSubscriptionItemsToBillingItems,
  type CpqSubscriptionItem,
} from '../lib/chargeMapper'

/**
 * Subscriber: `cpq.subscription.renewed` → extend term + add items.
 *
 * On renewal the existing items either:
 *   - Stay active (no `bill_end_date` set, so the engine keeps
 *     billing them as recurring) — connector touches nothing.
 *   - Had a previously-set `bill_end_date` (e.g. fixed-term
 *     subscription) — connector clears or extends it to the new
 *     term's end (`newTermEnd` from the payload).
 *
 * New items added at renewal (e.g. upsell at renewal time) are
 * created with `bill_start_date = newTermStart`, same shape as
 * activation.
 *
 * The connector does NOT post a proration line for renewals — by
 * definition renewal happens at the cycle boundary (or it's an early
 * renewal, which the integrator should issue as `amend` + `renew`
 * via the spec's ARC flow rather than this single event).
 */

export const metadata = {
  event: 'cpq.subscription.renewed',
  persistent: true,
  id: 'cpq-billing-connector:subscription-renewed',
}

type RenewedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  newTermStart: string
  newTermEnd?: string | null
  addedItems?: CpqSubscriptionItem[]
}

export default async function handle(payload: RenewedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.newTermStart) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  const existingItems = await billingApi.findItemsBySubscription(scope, payload.subscriptionId)

  // Extend the bill_end_date on items that had one. Items without
  // an end date are open-ended; nothing to do.
  for (const item of existingItems) {
    if (!item.billEndDate) continue
    await billingApi.updateItem(scope, {
      id: item.id,
      billEndDate: payload.newTermEnd ?? null,
    })
  }

  // Add new items at the renewal boundary.
  const accountId =
    existingItems[0]?.billAccountId ??
    (await billingApi.findAccountByCustomer(scope, payload.customerId))?.id ??
    null
  if (!accountId) return

  const newPayloads = mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.addedItems ?? [],
    billStartDate: payload.newTermStart,
  })
  for (const item of newPayloads) {
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
}
