import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import { buildArcEndDateUpdates, type ArcEndDateItem } from '../lib/arcEndDate'
import { resolveOrderReference } from '../lib/orderReference'

/**
 * Subscriber: `cpq.subscription.cancelled` → set bill_end_date on
 * every billing item attached to the subscription.
 *
 * The connector uses the spec's `effectiveDate` (cancellation date)
 * minus one day as `bill_end_date` — or the item's own `billStartDate`
 * minus one day when it has not started yet, so it never bills
 * (`lib/arcEndDate.ts`). Each write carries the generated credit reason
 * `subscription_cancelled`, which billing prints under the credit line. From there the billing engine
 * (billing Spec A) handles the money:
 *   - an item billed in arrears is charged pro rata up to the end date;
 *   - an item already billed in advance past the end date gets an
 *     automatic credit line for the unused days (when `prorate` is on).
 *
 * The cancellation POLICY belongs to CPQ: "cancel at the end of the
 * current period, no refund" means CPQ sends an `effectiveDate` on the
 * period boundary — then no credit arises. The connector never invents
 * credits itself (billing does), so CPQ must NOT also post a negative
 * `one_time` item for the same days.
 */

export const metadata = {
  event: 'cpq.subscription.cancelled',
  persistent: true,
  id: 'cpq-billing-connector:subscription-cancelled',
}

export type CancelledPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  /** YYYY-MM-DD; the date the cancellation takes effect. */
  effectiveDate: string
  /** CPQ order id — resolves the order number shown in the credit reason. */
  sourceOrderId?: string
}

/**
 * End-date updates for the subscription's items: `effectiveDate − 1`, or
 * `billStartDate − 1` for an item that has not started yet, with the
 * generated credit reason `subscription_cancelled`. Items already
 * ending on or before that date are left alone (idempotent on re-delivery). Pure.
 */
export function buildCancelledItemUpdates(
  items: ArcEndDateItem[],
  payload: Pick<CancelledPayload, 'effectiveDate'>,
  reference?: string,
) {
  return buildArcEndDateUpdates(items, {
    effectiveDate: payload.effectiveDate,
    code: 'subscription_cancelled',
    reference,
  })
}

export default async function handle(payload: CancelledPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.effectiveDate) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  const items = await billingApi.findItemsBySubscription(scope, payload.subscriptionId)
  if (items.length === 0) return

  // Skip the order lookup when every item already ends early enough.
  if (buildCancelledItemUpdates(items, payload).length === 0) return
  const reference = await resolveOrderReference(container, scope, payload.sourceOrderId)
  for (const update of buildCancelledItemUpdates(items, payload, reference)) {
    await billingApi.updateItem(scope, update)
  }
}
