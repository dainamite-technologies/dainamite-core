import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import {
  mapSubscriptionItemsToBillingItems,
  type CpqSubscriptionItem,
} from '../lib/chargeMapper'
import { arcItemBillStart, loadArcBillStartSetup, markArcSetupApplied } from '../lib/arcBillStart'
import type { BillStartSetup } from '../lib/orderSetupResolution'
import { applyRerates } from '../lib/arcRerate'
import { resolveOrderReference } from '../lib/orderReference'

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
 * New items added at renewal (e.g. upsell at renewal time) are created
 * on the subscription's own account, same shape as activation. Bill start
 * per added line (order billing setup, D7): line override → CPQ service
 * start → the order's default bill start → `newTermStart`.
 *
 * Items whose recurring price changed at renewal (`changedItems`, #126) are
 * re-rated from `newTermStart`: the old recurring Billing Items end the day
 * before and a new one starts at the new price (`lib/arcRerate.ts`).
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

export type RenewedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  newTermStart: string
  newTermEnd?: string | null
  addedItems?: CpqSubscriptionItem[]
  /** #126: items whose recurring price changed (new price in `charges`). */
  changedItems?: CpqSubscriptionItem[]
  /** CPQ order id — the key of the order billing setup. */
  sourceOrderId?: string
}

/** Billing Item payloads for the items added at renewal. */
export function buildRenewedItemPayloads(
  billAccountId: string,
  payload: RenewedPayload,
  setup: BillStartSetup | null = null,
) {
  return mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.addedItems ?? [],
    billStartDate: payload.newTermStart,
    billStartDateFor: (item) => arcItemBillStart(item, setup, payload.newTermStart),
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

  // Re-rate the items whose recurring price changed. Runs after the end-date
  // extension above, so a re-delivered event still ends the old price.
  const changed = payload.changedItems ?? []
  if (changed.length > 0) {
    const reference = await resolveOrderReference(container, scope, payload.sourceOrderId)
    await applyRerates(billingApi, scope, accountId, changed, {
      subscriptionId: payload.subscriptionId,
      effectiveDate: payload.newTermStart,
      sourceOrderId: payload.sourceOrderId,
      code: 'subscription_amended',
      reference,
    })
  }

  const added = payload.addedItems ?? []
  if (added.length === 0) return
  const setup = await loadArcBillStartSetup(container, scope, payload.sourceOrderId)
  const newPayloads = buildRenewedItemPayloads(accountId, payload, setup)
  if (newPayloads.length === 0) return
  await billingApi.bulkCreateItems(scope, newPayloads)
  const account = await billingApi.findAccountById(scope, accountId)
  await markArcSetupApplied(container, scope, {
    sourceOrderId: payload.sourceOrderId,
    customerId: payload.customerId,
    currencyCode: account?.currencyCode ?? '',
    billingAccountId: accountId,
  })
}
