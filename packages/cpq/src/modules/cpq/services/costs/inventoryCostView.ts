import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscription, CpqInventorySubscriptionItem } from '../../data/entities'
import { isAssetLive, isItemLive } from '../../data/costs'
import { QuotingError } from '../cpqQuotingService'
import type { TenantScope } from '../types'
import {
  computeAssetMargin, computeItemMargin, computeSubscriptionMargin,
  type AssetMargin, type AssetMarginInput, type ItemMargin, type ItemMarginInput, type MarginInventoryCost,
} from './itemMargin'

/**
 * Read model of inventory costs (feature spec §API Contracts): subscription costs (items and cost-owning assets)
 * and one asset's costs. Two projections per route: status-only without `cpq.costs.view`, full with it. Margins are
 * computed on read from the OPEN costs (status active, live owner: Q6), never stored. Every query is tenant scoped
 * and excludes soft-deleted rows; a subscription read is four queries whatever the number of items and assets.
 */

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })

/** Identity, status and type only: no amount, currency, supplier, validity, date or margin. */
export function redactedInventoryCostView(row: CpqInventoryCost) {
  return { id: row.id, costKey: row.costKey, name: row.name, role: row.role, costType: row.costType, valueStatus: row.valueStatus, status: row.status }
}

export function fullInventoryCostView(row: CpqInventoryCost) {
  return {
    ...redactedInventoryCostView(row),
    chargeCode: row.chargeCode ?? null,
    source: row.source,
    costModel: row.costModel,
    origin: row.origin,
    valueOrigin: row.valueOrigin ?? null,
    unitAmount: row.unitAmount ?? null,
    instanceAmount: row.instanceAmount ?? null,
    totalAmount: row.totalAmount ?? null,
    currencyCode: row.currencyCode ?? null,
    fxRate: row.fxRate ?? null,
    fxRateDate: row.fxRateDate ?? null,
    supplierId: row.supplierId ?? null,
    supplierName: row.supplierName ?? null,
    supplierQuoteRef: row.supplierQuoteRef ?? null,
    validUntil: row.validUntil ?? null,
    supplierTermEnd: row.supplierTermEnd ?? null,
    supplierMinTermMonths: row.supplierMinTermMonths ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    lastChangeId: row.lastChangeId ?? null,
  }
}

type CostView = ReturnType<typeof redactedInventoryCostView> | ReturnType<typeof fullInventoryCostView>

const byKey = (a: CpqInventoryCost, b: CpqInventoryCost) => a.costKey.localeCompare(b.costKey)
const marginCost = (row: CpqInventoryCost): MarginInventoryCost => ({ chargeCode: row.chargeCode ?? null, costType: row.costType, valueStatus: row.valueStatus, totalAmount: row.totalAmount })
const isOpenStatus = (row: CpqInventoryCost) => row.status === 'active'

export type SubscriptionCostsRead = {
  subscriptionId: string
  currencyCode?: string
  items: Array<{ subscriptionItemId: string; itemStatus: string; costs: CostView[]; margin?: ItemMargin | null }>
  assets: Array<{ assetId: string; assetStatus: string; costs: CostView[]; margin?: AssetMargin | null }>
  margin?: ItemMargin
}

export async function readSubscriptionCosts(
  em: EntityManager, subscriptionId: string, scope: TenantScope, options: { canViewCosts: boolean; includeEnded: boolean },
): Promise<SubscriptionCostsRead> {
  const subscription = await em.findOne(CpqInventorySubscription, { id: subscriptionId, ...scoped(scope) })
  if (!subscription) throw new QuotingError(404, 'Subscription not found')
  const [items, assets, costRows] = await Promise.all([
    em.find(CpqInventorySubscriptionItem, { subscriptionId, ...scoped(scope) }),
    em.find(CpqInventoryAsset, { subscriptionId, ...scoped(scope) }),
    em.find(CpqInventoryCost, { subscriptionId, ...scoped(scope) }),
  ])
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const itemCosts = new Map<string, CpqInventoryCost[]>()
  const assetCosts = new Map<string, CpqInventoryCost[]>()
  for (const row of [...costRows].sort(byKey)) {
    const target = row.subscriptionItemId ? itemCosts : row.assetId ? assetCosts : null
    const ownerId = row.subscriptionItemId ?? row.assetId
    if (!target || !ownerId) continue
    target.set(ownerId, [...(target.get(ownerId) ?? []), row])
  }
  const project = options.canViewCosts ? fullInventoryCostView : redactedInventoryCostView
  // Listed costs: open ones by default; `includeEnded` adds ended rows and the owners that are no longer live.
  const listed = (rows: CpqInventoryCost[], live: boolean) => (options.includeEnded ? rows : live ? rows.filter(isOpenStatus) : [])
  const openOf = (rows: CpqInventoryCost[], live: boolean) => (live ? rows.filter(isOpenStatus) : [])

  const result: SubscriptionCostsRead = { subscriptionId: subscription.id, items: [], assets: [] }
  const itemInputs: ItemMarginInput[] = []
  const assetInputs: AssetMarginInput[] = []
  for (const item of items) {
    const live = isItemLive(item)
    const own = itemCosts.get(item.id) ?? []
    const open = openOf(own, live)
    const input: ItemMarginInput = { mrcAmount: item.mrcAmount, nrcAmount: item.nrcAmount, quantity: item.quantity, charges: item.charges as ItemMarginInput['charges'], costs: open.map(marginCost) }
    if (live) itemInputs.push(input)
    const shown = listed(own, live)
    if (shown.length === 0) continue
    result.items.push({
      subscriptionItemId: item.id, itemStatus: item.status, costs: shown.map(project),
      ...(options.canViewCosts ? { margin: live ? computeItemMargin(input) : null } : {}),
    })
  }
  for (const [assetId, rows] of assetCosts) {
    const asset = assetById.get(assetId)
    if (!asset) continue
    const live = isAssetLive(asset)
    const open = openOf(rows, live)
    const input: AssetMarginInput = { purchasePrice: asset.purchasePrice, costs: open.map(marginCost) }
    if (live) assetInputs.push(input)
    const shown = listed(rows, live)
    if (shown.length === 0) continue
    result.assets.push({
      assetId: asset.id, assetStatus: asset.status, costs: shown.map(project),
      ...(options.canViewCosts ? { margin: live ? computeAssetMargin(input) : null } : {}),
    })
  }
  if (!options.canViewCosts) return result
  return { ...result, currencyCode: subscription.currencyCode, margin: computeSubscriptionMargin(itemInputs, assetInputs) }
}

export type AssetCostsRead = {
  assetId: string
  assetStatus: string
  /** Set when the asset was created with its own item (ARC `add`, same `source_quote_line_id`) and that item owns the costs. */
  ownerItemId: string | null
  costs: CostView[]
  currencyCode?: string
  margin?: AssetMargin | null
}

export async function readAssetCosts(
  em: EntityManager, assetId: string, scope: TenantScope, options: { canViewCosts: boolean; includeEnded: boolean },
): Promise<AssetCostsRead> {
  const asset = await em.findOne(CpqInventoryAsset, { id: assetId, ...scoped(scope) })
  if (!asset) throw new QuotingError(404, 'Asset not found')
  const rows = [...(await em.find(CpqInventoryCost, { assetId, ...scoped(scope) }))].sort(byKey)
  const live = isAssetLive(asset)
  const shown = options.includeEnded ? rows : live ? rows.filter(isOpenStatus) : []
  let ownerItemId: string | null = null
  if (rows.length === 0 && asset.subscriptionId && asset.sourceQuoteLineId) {
    const siblings = await em.find(CpqInventorySubscriptionItem, { subscriptionId: asset.subscriptionId, sourceQuoteLineId: asset.sourceQuoteLineId, ...scoped(scope) })
    if (siblings.length > 0) {
      const owning = await em.find(CpqInventoryCost, { subscriptionItemId: { $in: siblings.map((item) => item.id) }, ...scoped(scope) })
      const ownerIds = new Set(owning.map((row) => row.subscriptionItemId))
      ownerItemId = siblings.find((item) => ownerIds.has(item.id))?.id ?? null
    }
  }
  const project = options.canViewCosts ? fullInventoryCostView : redactedInventoryCostView
  const base: AssetCostsRead = { assetId: asset.id, assetStatus: asset.status, ownerItemId, costs: shown.map(project) }
  if (!options.canViewCosts) return base
  const open = live ? rows.filter(isOpenStatus) : []
  return { ...base, currencyCode: asset.currencyCode, margin: rows.length > 0 && live ? computeAssetMargin({ purchasePrice: asset.purchasePrice, costs: open.map(marginCost) }) : null }
}
