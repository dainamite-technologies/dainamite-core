import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'

/**
 * Subscriber: `cpq.subscription.merged` → re-link items to the
 * merged subscription.
 *
 * Per the spec: "Move Billing Items from source subscriptions to
 * the merged subscription (update `subscription_id`)." This keeps
 * the audit trail continuous — same Billing Items, just pointing
 * at the new subscription so any future lookup by subscription_id
 * lands at the merged target.
 *
 * The source subscriptions transition to the terminal `superseded`
 * status in CPQ; the `superseded` subscriber separately end-dates
 * any items still pointing at the source ids (defense in depth — if
 * a race left an item un-relinked, superseded catches it).
 */

export const metadata = {
  event: 'cpq.subscription.merged',
  persistent: true,
  id: 'cpq-billing-connector:subscription-merged',
}

type MergedPayload = {
  tenantId: string
  organizationId: string
  /** The new merged subscription's id (the survivor). */
  mergedSubscriptionId: string
  /** The source subscriptions absorbed into the merge. */
  sourceSubscriptionIds: string[]
}

export default async function handle(payload: MergedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.mergedSubscriptionId || !Array.isArray(payload.sourceSubscriptionIds)) return
  if (payload.sourceSubscriptionIds.length === 0) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  for (const sourceId of payload.sourceSubscriptionIds) {
    const items = await billingApi.findItemsBySubscription(scope, sourceId)
    for (const item of items) {
      await billingApi.updateItem(scope, {
        id: item.id,
        subscriptionId: payload.mergedSubscriptionId,
      })
    }
  }
}
