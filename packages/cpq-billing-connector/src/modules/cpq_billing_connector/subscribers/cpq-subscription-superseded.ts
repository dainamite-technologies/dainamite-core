import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'

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
 * end-date them at the supersession effective date so the engine
 * stops billing them.
 *
 * In the steady-state "no race" path, this subscriber finds zero
 * items and is a no-op — which is fine.
 */

export const metadata = {
  event: 'cpq.subscription.superseded',
  persistent: true,
  id: 'cpq-billing-connector:subscription-superseded',
}

type SupersededPayload = {
  tenantId: string
  organizationId: string
  /** The id that is being superseded (the OLD subscription). */
  subscriptionId: string
  /** YYYY-MM-DD; when the supersession took effect. */
  effectiveDate: string
}

function isoDateMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
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

  const endDate = isoDateMinusOneDay(payload.effectiveDate)
  for (const item of stragglers) {
    if (item.billEndDate && item.billEndDate.toISOString().slice(0, 10) === endDate) {
      continue
    }
    await billingApi.updateItem(scope, {
      id: item.id,
      billEndDate: endDate,
    })
  }
}
