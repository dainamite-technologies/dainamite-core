import type { AwilixContainer } from 'awilix'
import type { Scope } from './billingApiClient'

/**
 * Which Billing Items a CPQ status / terminate event applies to.
 *
 * Billing Items carry the CPQ `subscriptionItemId` — or, for a device's own
 * charges, the CPQ **asset id** in that column (#126: billing has no asset
 * concept). A device follows its subscription item, so the keys of an
 * affected item are its id plus the ids of the assets attached to it.
 *
 * Best-effort CPQ read through the `cpqInventoryService` port (CPQ is a peer
 * of the connector): when it is unavailable the event's own item ids are
 * used and the gap is logged — the subscription items still bill correctly,
 * only attached device charges are missed.
 */

export type CpqInventoryReader = {
  getSubscription(subscriptionId: string, scope: Scope): Promise<{ status?: string | null } | null>
  listAssets(
    filters: { subscriptionId?: string; subscriptionItemId?: string; page?: number; pageSize?: number },
    scope: Scope,
  ): Promise<{ items: Array<{ id: string }>; totalPages?: number }>
}

function reader(container: AwilixContainer): CpqInventoryReader | null {
  try {
    return container.resolve('cpqInventoryService') as CpqInventoryReader
  } catch {
    return null
  }
}

async function assetIdsOf(cpq: CpqInventoryReader, scope: Scope, subscriptionId: string, subscriptionItemId: string): Promise<string[]> {
  const ids: string[] = []
  for (let page = 1; page <= 20; page += 1) {
    const result = await cpq.listAssets({ subscriptionId, subscriptionItemId, page, pageSize: 100 }, scope)
    ids.push(...(result.items ?? []).map((asset) => asset.id))
    if (!result.totalPages || page >= result.totalPages) break
  }
  return ids
}

/** The `subscriptionItemId` keys of the affected items' Billing Items (items + their assets). */
export async function resolveBillingItemKeys(
  container: AwilixContainer,
  scope: Scope,
  subscriptionId: string,
  subscriptionItemIds: string[],
): Promise<string[]> {
  const keys = new Set(subscriptionItemIds)
  const cpq = reader(container)
  if (!cpq) return [...keys]
  try {
    for (const itemId of subscriptionItemIds) {
      for (const assetId of await assetIdsOf(cpq, scope, subscriptionId, itemId)) keys.add(assetId)
    }
  } catch (err) {
    console.warn('[cpq-billing-connector] assets of the affected items unavailable; device charges not covered', {
      subscriptionId,
      err,
    })
  }
  return [...keys]
}

/**
 * Whether the whole CPQ subscription is terminated (a subscription-wide
 * terminate, or the last live item ending). `null` when CPQ cannot be read.
 */
export async function isSubscriptionTerminated(
  container: AwilixContainer,
  scope: Scope,
  subscriptionId: string,
): Promise<boolean | null> {
  const cpq = reader(container)
  if (!cpq) return null
  try {
    const sub = await cpq.getSubscription(subscriptionId, scope)
    return sub ? sub.status === 'terminated' : null
  } catch (err) {
    console.warn('[cpq-billing-connector] CPQ subscription unavailable for terminate', { subscriptionId, err })
    return null
  }
}
