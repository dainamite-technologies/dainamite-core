import { roundTo } from './costPlusPrice'

/**
 * Margin of live subscription items and cost-owning assets (feature spec Q3, Q6). Pure and never stored: the
 * read routes compute it from the OPEN inventory costs on every call.
 *
 * Basis
 *  - `total_amount` of an inventory cost is the cost model applied x line quantity, in the subscription currency,
 *    the same basis as `item.mrcAmount` / `item.nrcAmount` (line totals with quantity applied).
 *  - Item MRC margin = item MRC - sum of open MRC cost totals. Item NRC margin = item NRC - sum of NRC cost totals,
 *    an "at activation" figure. An unknown cost (`value_status = none` or no total) contributes 0 and leaves its
 *    charge uncovered, exactly as on a quote (`quoteMargin.ts`).
 *  - A cost-owning asset has an NRC margin = purchase price - NRC cost totals; its recurring costs are a recurring
 *    cost with no recurring revenue on the asset. An asset created together with its own item never owns costs
 *    (it is not passed here), so its purchase price is never counted twice.
 *  - Coverage = share (percent) of the offer value carried by covered charges (>= 1 open cost, all known), the
 *    semantics of `computeQuoteMargin`. Offer value = MRC + NRC charge totals x quantity, usage excluded. No term
 *    horizon: an item has none.
 *  - The roll-up sums the items and cost-owning assets it is given, so a recurring asset cost reduces the
 *    subscription's MRC margin.
 *
 * Callers pass only OPEN costs (status active, owner live) and only live owners.
 */

export type MarginInventoryCost = {
  chargeCode: string | null
  costType: 'nrc' | 'mrc' | string
  valueStatus: 'none' | 'estimated' | 'confirmed' | string
  totalAmount: string | number | null
}

export type MarginItemCharge = { chargeCode: string; chargeType: string; totalPrice: number | string | null }

export type ItemMarginInput = {
  mrcAmount: string | number
  nrcAmount: string | number
  quantity: number
  charges: MarginItemCharge[] | null | undefined
  costs: MarginInventoryCost[]
}

export type AssetMarginInput = { purchasePrice: string | number; costs: MarginInventoryCost[] }

export type ItemMargin = {
  mrcOffer: number
  mrcCost: number
  mrcMargin: number
  /** Percent (50 = 50 %), null when the MRC offer is 0. */
  mrcMarginPercent: number | null
  nrcOffer: number
  nrcCost: number
  nrcMargin: number
  /** Percent of the offer value carried by covered charges (0 when there is no offer value). */
  coverage: number
}

export type AssetMargin = { nrcOffer: number; nrcCost: number; nrcMargin: number; mrcCost: number }

const R = (value: number) => roundTo(value, 4)
const num = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? 0 : Number(value))
const isKnown = (cost: Pick<MarginInventoryCost, 'valueStatus' | 'totalAmount'>) => cost.valueStatus !== 'none' && cost.totalAmount !== null && cost.totalAmount !== undefined

type Sums = { mrcOffer: number; mrcCost: number; nrcOffer: number; nrcCost: number; coveredOffer: number; offerValue: number }

function sumCosts(costs: MarginInventoryCost[]): { mrc: number; nrc: number } {
  let mrc = 0
  let nrc = 0
  for (const cost of costs) {
    if (!isKnown(cost)) continue
    if (cost.costType === 'nrc') nrc += Number(cost.totalAmount)
    else mrc += Number(cost.totalAmount)
  }
  return { mrc, nrc }
}

function itemSums(input: ItemMarginInput): Sums {
  const { mrc, nrc } = sumCosts(input.costs)
  let offerValue = 0
  let coveredOffer = 0
  for (const charge of input.charges ?? []) {
    if (charge.chargeType === 'usage') continue
    const value = num(charge.totalPrice) * input.quantity
    offerValue += value
    const own = input.costs.filter((cost) => cost.chargeCode === charge.chargeCode)
    if (own.length > 0 && own.every(isKnown)) coveredOffer += value
  }
  return { mrcOffer: num(input.mrcAmount), mrcCost: mrc, nrcOffer: num(input.nrcAmount), nrcCost: nrc, coveredOffer, offerValue }
}

const percent = (part: number, whole: number) => (whole === 0 ? null : R((part / whole) * 100))

function finalizeItem(sums: Sums): ItemMargin {
  const mrcMargin = sums.mrcOffer - sums.mrcCost
  return {
    mrcOffer: R(sums.mrcOffer), mrcCost: R(sums.mrcCost), mrcMargin: R(mrcMargin), mrcMarginPercent: percent(mrcMargin, sums.mrcOffer),
    nrcOffer: R(sums.nrcOffer), nrcCost: R(sums.nrcCost), nrcMargin: R(sums.nrcOffer - sums.nrcCost),
    coverage: sums.offerValue === 0 ? 0 : R((sums.coveredOffer / sums.offerValue) * 100),
  }
}

export function computeItemMargin(input: ItemMarginInput): ItemMargin {
  return finalizeItem(itemSums(input))
}

export function computeAssetMargin(input: AssetMarginInput): AssetMargin {
  const { mrc, nrc } = sumCosts(input.costs)
  const offer = num(input.purchasePrice)
  return { nrcOffer: R(offer), nrcCost: R(nrc), nrcMargin: R(offer - nrc), mrcCost: R(mrc) }
}

/** Subscription roll-up over its live items and its cost-owning live assets (Q3). Same shape as an item margin. */
export function computeSubscriptionMargin(items: ItemMarginInput[], assets: AssetMarginInput[]): ItemMargin {
  const total: Sums = { mrcOffer: 0, mrcCost: 0, nrcOffer: 0, nrcCost: 0, coveredOffer: 0, offerValue: 0 }
  const add = (sums: Sums) => { for (const key of Object.keys(total) as Array<keyof Sums>) total[key] += sums[key] }
  for (const item of items) add(itemSums(item))
  for (const asset of assets) {
    const { mrc, nrc } = sumCosts(asset.costs)
    const offer = num(asset.purchasePrice)
    add({ mrcOffer: 0, mrcCost: mrc, nrcOffer: offer, nrcCost: nrc, offerValue: offer, coveredOffer: asset.costs.length > 0 && asset.costs.every(isKnown) ? offer : 0 })
  }
  return finalizeItem(total)
}
