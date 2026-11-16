import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type ItemCreatePayload, type Scope } from '../lib/billingApiClient'
import {
  mapSubscriptionItemsToBillingItems,
  type CpqSubscriptionItem,
} from '../lib/chargeMapper'
import { arcItemBillStart, loadArcBillStartSetup, markArcSetupApplied } from '../lib/arcBillStart'
import type { BillStartSetup } from '../lib/orderSetupResolution'
import { arcItemEndDate, buildArcEndDateUpdates, type ArcEndDateItem } from '../lib/arcEndDate'
import { resolveOrderReference } from '../lib/orderReference'

/**
 * Subscriber: `cpq.subscription.amended` → mid-cycle add / remove.
 *
 * CPQ's amended event carries `addedItems`, `removedSubscriptionItemIds`
 * and the `effectiveDate` of the amendment. The connector:
 *   1. Creates a Billing Item for every added charge on the subscription's
 *      own account. Bill start per added line (order billing setup, D7):
 *      line override → CPQ service start → the order's default bill start
 *      → `effectiveDate`.
 *   2. End-dates every Billing Item of each removed subscription item at
 *      `effectiveDate - 1 day`, clamped to `billStartDate - 1 day` for an
 *      item that has not started yet (`lib/arcEndDate.ts`), with the
 *      generated credit reason `subscription_amended`.
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
  /** CPQ order id — the key of the order billing setup. */
  sourceOrderId?: string
}

/** Billing Item payloads for the added charges — pure, no proration lines. */
export function buildAddedItemPayloads(
  billAccountId: string,
  payload: AmendedPayload,
  setup: BillStartSetup | null = null,
): ItemCreatePayload[] {
  return mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.addedItems ?? [],
    billStartDate: payload.effectiveDate,
    billStartDateFor: (item) => arcItemBillStart(item, setup, payload.effectiveDate),
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

/**
 * `bill_end_date` for an item of a removed subscription item: the day before
 * the effective date, or the day before the item's own start when it has not
 * started yet.
 */
export function removedItemEndDate(effectiveDate: string, billStartDate?: Date | string | null): string {
  return arcItemEndDate(effectiveDate, billStartDate)
}

/** End-date updates (with the `subscription_amended` reason) for removed items. */
export function buildRemovedItemUpdates(
  items: ArcEndDateItem[],
  payload: Pick<AmendedPayload, 'effectiveDate'>,
  reference?: string,
) {
  return buildArcEndDateUpdates(items, {
    effectiveDate: payload.effectiveDate,
    code: 'subscription_amended',
    reference,
  })
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

  // The subscription's account is the one its existing items bill to (the
  // customer may have several accounts — order billing setup spec, D7).
  // Activation runs first and creates the account; if nothing is found,
  // there is nothing to amend — the queue will have retried activation.
  const existingItems = await billingApi.findItemsBySubscription(scope, payload.subscriptionId)
  const accountId =
    existingItems[0]?.billAccountId ??
    (await billingApi.findAccountByCustomer(scope, payload.customerId))?.id ??
    null
  if (!accountId) return

  // 1. New Billing Items for every added charge (the engine prorates the stub).
  const setup = added.length > 0 ? await loadArcBillStartSetup(container, scope, payload.sourceOrderId) : null
  const itemsToCreate = buildAddedItemPayloads(accountId, payload, setup)
  if (itemsToCreate.length > 0) {
    await billingApi.bulkCreateItems(scope, itemsToCreate)
    const account = await billingApi.findAccountById(scope, accountId)
    await markArcSetupApplied(container, scope, {
      sourceOrderId: payload.sourceOrderId,
      customerId: payload.customerId,
      currencyCode: account?.currencyCode ?? '',
      billingAccountId: accountId,
    })
  }

  // 2. End-date every Billing Item of each removed subscription item.
  if (removed.length === 0) return
  const reference = await resolveOrderReference(container, scope, payload.sourceOrderId)
  for (const removedSubItemId of removed) {
    const items = await billingApi.findItemsBySubscriptionItem(scope, removedSubItemId)
    for (const update of buildRemovedItemUpdates(items, payload, reference)) {
      await billingApi.updateItem(scope, update)
    }
  }
}
