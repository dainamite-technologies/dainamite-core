import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import { buildArcEndDateUpdates, type ArcEndDateItem } from '../lib/arcEndDate'
import { resolveOrderReference } from '../lib/orderReference'

/**
 * Subscriber: `cpq.subscription.superseded` → end-date items still
 * pointing at a superseded source.
 *
 * Per the spec's XD-250 ARC notes, merge-renewal produces a brand
 * new subscription (the "merge target") and transitions the source
 * subscriptions to `superseded`. The `merged` subscriber already
 * re-links Billing Items to the target — this subscriber is the
 * defense-in-depth net: if any items remain attached to the
 * superseded source (re-link missed them, race, manual fix-up),
 * end-date them the day before the supersession effective date
 * (clamped to `billStartDate − 1` for items that have not started,
 * `lib/arcEndDate.ts`) with the credit reason `subscription_superseded`,
 * so the engine stops billing them.
 *
 * In the steady-state "no race" path, this subscriber finds zero
 * items and is a no-op — which is fine.
 */

export const metadata = {
  event: 'cpq.subscription.superseded',
  persistent: true,
  id: 'cpq-billing-connector:subscription-superseded',
}

export type SupersededPayload = {
  tenantId: string
  organizationId: string
  /** The id that is being superseded (the OLD subscription). */
  subscriptionId: string
  /** YYYY-MM-DD; when the supersession took effect. */
  effectiveDate: string
  /** CPQ order id — resolves the order number shown in the credit reason. */
  sourceOrderId?: string
}

/**
 * End-date updates for the subscription's items: `effectiveDate − 1`, or
 * `billStartDate − 1` for an item that has not started yet, with the
 * generated credit reason `subscription_superseded`. Items already
 * ending on or before that date are left alone (idempotent on re-delivery). Pure.
 */
export function buildSupersededItemUpdates(
  items: ArcEndDateItem[],
  payload: Pick<SupersededPayload, 'effectiveDate'>,
  reference?: string,
) {
  return buildArcEndDateUpdates(items, {
    effectiveDate: payload.effectiveDate,
    code: 'subscription_superseded',
    reference,
  })
}

export default async function handle(payload: SupersededPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.effectiveDate) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  const stragglers = await billingApi.findItemsBySubscription(scope, payload.subscriptionId)
  if (stragglers.length === 0) return

  // Skip the order lookup when every item already ends early enough.
  if (buildSupersededItemUpdates(stragglers, payload).length === 0) return
  const reference = await resolveOrderReference(container, scope, payload.sourceOrderId)
  for (const update of buildSupersededItemUpdates(stragglers, payload, reference)) {
    await billingApi.updateItem(scope, update)
  }
}
