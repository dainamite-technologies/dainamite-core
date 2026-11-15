import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'

/**
 * Subscriber: `cpq.subscription.cancelled` → set bill_end_date on
 * every billing item attached to the subscription.
 *
 * The connector uses the spec's `effectiveDate` (cancellation date)
 * minus one day as `bill_end_date`. From there the billing engine
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

type CancelledPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  /** YYYY-MM-DD; the date the cancellation takes effect. */
  effectiveDate: string
}

function isoDateMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
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

  const endDate = isoDateMinusOneDay(payload.effectiveDate)
  for (const item of items) {
    // Idempotency: skip if already end-dated to this exact date.
    if (item.billEndDate && item.billEndDate.toISOString().slice(0, 10) === endDate) {
      continue
    }
    await billingApi.updateItem(scope, {
      id: item.id,
      billEndDate: endDate,
    })
  }
}
