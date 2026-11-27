import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import { buildArcEndDateUpdates, type ArcEndDateItem } from '../lib/arcEndDate'
import { isSubscriptionTerminated, resolveBillingItemKeys } from '../lib/subscriptionItemTargets'

/**
 * Subscriber: `cpq.subscription.terminated` → end the Billing Items, exactly
 * like `cpq.subscription.cancelled` (contract C3; closes the gap where a
 * terminate from the CPQ inventory left billing running).
 *
 * Same end-date rule and credit reason as cancel (`lib/arcEndDate.ts`):
 * `bill_end_date = effectiveDate − 1` — or `billStartDate − 1` for an item
 * that has not started yet — with the generated reason
 * `subscription_cancelled`; items already ending on or before that date are
 * left alone (idempotent on re-delivery; never pushes an end later). The
 * Bill Run prorates / credits as for a cancel.
 *
 * Scope: when the whole CPQ subscription is terminated (subscription-wide, or
 * the last live item), every Billing Item of the subscription ends — as for
 * cancel. An item-level terminate ends only the Billing Items of the listed
 * items and of their devices. If CPQ cannot be read, the listed items are
 * ended (a subscription-wide terminate lists every live item).
 */

export const metadata = {
  event: 'cpq.subscription.terminated',
  persistent: true,
  id: 'cpq-billing-connector:subscription-terminated',
}

export type TerminatedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  subscriptionItemIds: string[]
  /** YYYY-MM-DD; the first day no longer billed. */
  effectiveDate: string
  reason?: string | null
}

/** End-date updates, the cancel rule with the `subscription_cancelled` reason. Pure. */
export function buildTerminatedItemUpdates(items: ArcEndDateItem[], payload: Pick<TerminatedPayload, 'effectiveDate'>) {
  return buildArcEndDateUpdates(items, { effectiveDate: payload.effectiveDate, code: 'subscription_cancelled' })
}

export type TerminateBillingPort = Pick<BillingApiClient, 'findItemsBySubscription' | 'findItemsBySubscriptionItem' | 'updateItem'>

/** The Billing Items a terminate ends. Exported for tests. */
export async function terminatedItems(
  billing: TerminateBillingPort,
  scope: Scope,
  payload: TerminatedPayload,
  target: { wholeSubscription: boolean; keys: string[] },
): Promise<ArcEndDateItem[]> {
  if (target.wholeSubscription) return (await billing.findItemsBySubscription(scope, payload.subscriptionId)) as ArcEndDateItem[]
  const byId = new Map<string, ArcEndDateItem>()
  for (const key of target.keys) {
    for (const item of (await billing.findItemsBySubscriptionItem(scope, key)) as ArcEndDateItem[]) byId.set(item.id, item)
  }
  return [...byId.values()]
}

export async function applyTermination(
  billing: TerminateBillingPort,
  scope: Scope,
  payload: TerminatedPayload,
  target: { wholeSubscription: boolean; keys: string[] },
): Promise<void> {
  const items = await terminatedItems(billing, scope, payload, target)
  for (const update of buildTerminatedItemUpdates(items, payload)) {
    await billing.updateItem(scope, update)
  }
}

export default async function handle(payload: TerminatedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.effectiveDate) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const itemIds = Array.isArray(payload.subscriptionItemIds) ? payload.subscriptionItemIds.filter(Boolean) : []

  const whole = await isSubscriptionTerminated(container, scope, payload.subscriptionId)
  if (whole !== true && itemIds.length === 0) return
  const keys = whole === true ? [] : await resolveBillingItemKeys(container, scope, payload.subscriptionId, itemIds)
  await applyTermination(billingApi, scope, payload, { wholeSubscription: whole === true, keys })
}
