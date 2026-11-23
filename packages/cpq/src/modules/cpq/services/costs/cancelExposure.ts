import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqInventoryAsset,
  CpqInventoryCost,
  CpqOrderConfiguration,
  CpqQuoteLineConfiguration,
  CpqSubscriptionChangeLog,
  type CpqQuoteConfiguration,
} from '../../data/entities'
import { ASSET_NOT_LIVE_STATUSES } from '../../data/costs'
import { isArcTerminationLine } from '../arcLineRemoval'
import type { TenantScope } from '../types'
import { computeCancelExposure, type CancelExposureItem, type ExposureCostRow } from './arcCostCarry'

/**
 * Cancel exposure read (ARC costs spec step 17). Which inventory costs a Cancel quote, or the `cancel` lines of an Amend / Renew
 * quote, would leave outliving the cancellation, and as of which date:
 *  - while no order of the quote is active: today, over the OPEN item / asset costs of the cancelled items;
 *  - once the quote's order is active (or fulfilled): the change-log `effective_at` of that order's change, over the costs that
 *    order ended (`last_change_id` of its change-log rows, status `ended`).
 * Cancelled items = the `cancel` lines' source subscription items; their assets (the assets attached to those items) are cancelled
 * with them. A Cancel quote also covers every other open cost of its target subscriptions (subscription-level assets), because a
 * Cancel order ends every open cost of the subscription. Only `cpq.costs.view` holders get this projection (the callers gate it).
 */

export type CancelExposure = { referenceDate: string; items: CancelExposureItem[] }
export type LineCancelExposure = CancelExposure & { quoteLineId: string }
export type CancelExposureRead = { exposure: CancelExposure | null; lines: LineCancelExposure[] }

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const today = () => new Date().toISOString().slice(0, 10)
const dayOf = (value: Date | string): string => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10))
const ACTIVATED_ORDER_STATUSES = ['active', 'fulfilled']

type ExposureLine = Pick<CpqQuoteLineConfiguration, 'quoteLineId' | 'action' | 'configuration' | 'sourceSubscriptionItemId' | 'targetSubscriptionId'>

const itemIdOf = (line: ExposureLine): string | null =>
  line.sourceSubscriptionItemId ?? ((line.configuration as Record<string, unknown> | null)?._arcMirroredFromItemId as string | undefined) ?? null

/** Whole read for one quote (`quote` + its lines). `null` exposure and no lines when the quote cancels nothing. */
export async function loadCancelExposure(
  em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'id' | 'quoteType'>, lines: readonly ExposureLine[], scope: TenantScope,
): Promise<CancelExposureRead> {
  const empty: CancelExposureRead = { exposure: null, lines: [] }
  const cancelLines = lines.filter((line) => isArcTerminationLine(line, quote.quoteType) && itemIdOf(line))
  if (cancelLines.length === 0) return empty
  const itemIds = [...new Set(cancelLines.map((line) => itemIdOf(line) as string))]
  const wholeSubscriptions = quote.quoteType === 'cancel'
    ? [...new Set(cancelLines.map((line) => line.targetSubscriptionId).filter((id): id is string => !!id))]
    : []

  // Activated order: the reference date and the costs come from its change log (the order ended them).
  const order = await em.findOne(CpqOrderConfiguration, { sourceQuoteId: quote.id, cpqStatus: { $in: ACTIVATED_ORDER_STATUSES }, ...scoped(scope) })
  const logs = order
    ? await em.find(CpqSubscriptionChangeLog, { sourceOrderId: order.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
    : []
  const activated = !!order && logs.length > 0
  const effectiveByLog = new Map(logs.map((log) => [log.id, dayOf(log.effectiveAt)]))

  const assets = await em.find(CpqInventoryAsset, { subscriptionItemId: { $in: itemIds }, ...scoped(scope) })
  const cancelledAssets = assets.filter((asset) => activated || !(ASSET_NOT_LIVE_STATUSES as readonly string[]).includes(asset.status))
  const assetIds = cancelledAssets.map((asset) => asset.id)
  const owners: Array<Record<string, unknown>> = [{ subscriptionItemId: { $in: itemIds } }]
  if (assetIds.length > 0) owners.push({ assetId: { $in: assetIds } })
  if (wholeSubscriptions.length > 0) owners.push({ subscriptionId: { $in: wholeSubscriptions } })
  const costs = await em.find(CpqInventoryCost, {
    ...scoped(scope),
    $or: owners,
    ...(activated ? { status: 'ended', lastChangeId: { $in: [...effectiveByLog.keys()] } } : { status: 'active' }),
  })

  const referenceOf = (cost: CpqInventoryCost): string => (activated && cost.lastChangeId ? effectiveByLog.get(cost.lastChangeId) : undefined) ?? today()
  const itemsOf = (rows: readonly CpqInventoryCost[]): CancelExposureItem[] => {
    const byReference = new Map<string, CpqInventoryCost[]>()
    for (const row of rows) byReference.set(referenceOf(row), [...(byReference.get(referenceOf(row)) ?? []), row])
    return [...byReference].flatMap(([reference, group]) => computeCancelExposure(group as ExposureCostRow[], reference))
  }
  const referenceDate = activated ? [...effectiveByLog.values()].sort()[0] : today()
  const assetItem = new Map(cancelledAssets.map((asset) => [asset.id, asset.subscriptionItemId ?? null]))
  const ownedBy = (itemId: string) => costs.filter((cost) => (cost.assetId ? assetItem.get(cost.assetId) : cost.subscriptionItemId) === itemId)

  return {
    exposure: { referenceDate, items: itemsOf(costs) },
    lines: cancelLines.map((line) => ({ quoteLineId: line.quoteLineId, referenceDate, items: itemsOf(ownedBy(itemIdOf(line) as string)) })),
  }
}
