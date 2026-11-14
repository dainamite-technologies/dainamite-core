/**
 * Pure view helpers for the order and inventory (subscription / asset) cost UI (feature spec §UI/UX).
 * Client-safe: type-only imports from the services. The read routes decide what a user may see (status-only
 * projection without `cpq.costs.view`); these helpers only mirror the shape and never compare feature arrays.
 */
import type { AssetMargin, ItemMargin } from '../services/costs/itemMargin'
import { formatMoney, formatPercent, lineCostBadges, type CostBadge, type QuoteMargin } from './quoteCostView'

/** What every user with the page's view feature gets for an order or inventory cost. */
export type CostRow = {
  id: string
  costKey: string
  name: string
  role: 'price_basis' | 'margin_only' | string
  costType: 'nrc' | 'mrc' | string
  valueStatus: 'none' | 'estimated' | 'confirmed' | string
  /** Inventory costs only: `active` or `ended`. */
  status?: string
}

/** The full projection, `cpq.costs.view` only. Decimals are strings. */
export type FullCostRow = CostRow & {
  chargeCode: string | null
  source: string
  costModel: string
  unitAmount: string | null
  instanceAmount: string | null
  totalAmount: string | null
  currencyCode: string | null
  supplierName: string | null
  validUntil: string | null
  supplierTermEnd: string | null
  supplierMinTermMonths: number | null
  startedAt?: string
  endedAt?: string | null
  /** Order costs only: the inventory cost seeded at activation. */
  inventoryCostId?: string | null
}

export const isFullCostRow = (cost: CostRow | FullCostRow): cost is FullCostRow => 'totalAmount' in cost

export type OrderCostsResponse = {
  orderId: string
  currencyCode?: string
  lines: Array<{ orderLineId: string; costs: Array<CostRow | FullCostRow> }>
  margin?: QuoteMargin
}

export type SubscriptionCostsResponse = {
  subscriptionId: string
  currencyCode?: string
  items: Array<{ subscriptionItemId: string; itemStatus: string; costs: Array<CostRow | FullCostRow>; margin?: ItemMargin | null }>
  assets: Array<{ assetId: string; assetStatus: string; costs: Array<CostRow | FullCostRow>; margin?: AssetMargin | null }>
  margin?: ItemMargin
}

export type AssetCostsResponse = {
  assetId: string
  assetStatus: string
  ownerItemId: string | null
  costs: Array<CostRow | FullCostRow>
  currencyCode?: string
  margin?: AssetMargin | null
}

/** The full projection carries a currency; the status-only one never does. */
export const hasCostAccess = (response: { currencyCode?: string } | null | undefined): boolean => Boolean(response?.currencyCode)

export const isEnded = (cost: CostRow): boolean => cost.status === 'ended'

/** A cost whose validity date has passed while it is still open. Status-only rows carry no date: never expired. */
export function isCostExpired(cost: CostRow | FullCostRow, today: string): boolean {
  return isFullCostRow(cost) && !isEnded(cost) && Boolean(cost.validUntil) && (cost.validUntil as string) < today
}

/** Inputs for the shared status chips: open costs only (an ended cost raises none), expiry from the validity date. */
export function badgeInputs(costs: ReadonlyArray<CostRow | FullCostRow>, today: string): Array<{ valueStatus: string; expired: boolean }> {
  return costs.filter((cost) => !isEnded(cost)).map((cost) => ({ valueStatus: cost.valueStatus, expired: isCostExpired(cost, today) }))
}

/** Status chips for a set of costs (text labels, so colour is never the only signal). */
export const costChips = (costs: ReadonlyArray<CostRow | FullCostRow>, today: string): CostBadge[] => lineCostBadges(badgeInputs(costs, today))

/** "No cost recorded": the owner has no listed cost at all (open ones, or any when ended are shown). */
export const noCostRecorded = (costs: ReadonlyArray<unknown> | undefined): boolean => !costs || costs.length === 0

export type CostValueView = { amount: string; period: 'month' | 'one_off' | null }

/** Formatted value and its period: an MRC cost is per month, an NRC cost is one-off. `—` while no amount is known. */
export function costValueView(cost: FullCostRow, fallbackCurrency: string): CostValueView {
  const raw = cost.totalAmount ?? cost.instanceAmount ?? cost.unitAmount
  const period = cost.costType === 'mrc' ? 'month' : cost.costType === 'nrc' ? 'one_off' : null
  if (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) return { amount: '—', period: null }
  return { amount: formatMoney(Number(raw), cost.currencyCode ?? fallbackCurrency), period }
}

export const PERIOD_FALLBACKS: Record<'month' | 'one_off', string> = { month: '/ month', one_off: 'one-off' }

/** Costs grouped per order line id (lines without costs are absent). */
export function costsByOrderLine(response: OrderCostsResponse | null): Map<string, Array<CostRow | FullCostRow>> {
  return new Map((response?.lines ?? []).map((line) => [line.orderLineId, line.costs]))
}

/**
 * Order line id -> the asset that owns its costs once activated. Matches the order cost's `inventoryCostId`
 * (full projection only) against the costs of each subscription's cost-owning assets.
 */
export function assetLinksByOrderLine(order: OrderCostsResponse | null, subscriptions: ReadonlyArray<SubscriptionCostsResponse>): Map<string, string> {
  const assetByCost = new Map<string, string>()
  for (const subscription of subscriptions) for (const asset of subscription.assets) for (const cost of asset.costs) assetByCost.set(cost.id, asset.assetId)
  const links = new Map<string, string>()
  for (const line of order?.lines ?? []) {
    for (const cost of line.costs) {
      const inventoryCostId = isFullCostRow(cost) ? cost.inventoryCostId : null
      const assetId = inventoryCostId ? assetByCost.get(inventoryCostId) : undefined
      if (assetId) { links.set(line.orderLineId, assetId); break }
    }
  }
  return links
}

export type ItemMarginView = { mrcMargin: string; mrcMarginPercent: string; nrcMargin: string; coverage: string }

export function itemMarginView(margin: ItemMargin, currency: string): ItemMarginView {
  return {
    mrcMargin: formatMoney(margin.mrcMargin, currency),
    mrcMarginPercent: formatPercent(margin.mrcMarginPercent),
    nrcMargin: formatMoney(margin.nrcMargin, currency),
    coverage: formatPercent(margin.coverage),
  }
}

export type AssetMarginView = { nrcMargin: string; recurringCost: string; hasRecurringCost: boolean }

/** An asset has no recurring revenue: its recurring cost is shown as a cost, never as a margin. */
export function assetMarginView(margin: AssetMargin, currency: string): AssetMarginView {
  return { nrcMargin: formatMoney(margin.nrcMargin, currency), recurringCost: formatMoney(margin.mrcCost, currency), hasRecurringCost: margin.mrcCost > 0 }
}

/** `includeEnded` query string of the inventory cost routes. */
export const includeEndedQuery = (includeEnded: boolean): string => (includeEnded ? '?includeEnded=true' : '')
