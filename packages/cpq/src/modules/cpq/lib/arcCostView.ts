/**
 * Pure view helpers for the ARC cost UI (ARC costs spec §UI/UX). Client-safe (no service imports). The API stays the
 * authority; these only decide what to show.
 */
import type { OrderCostsResponse } from './orderInventoryCostView'
import type { ArcCostsView, QuoteCostLineEntry, QuoteCostsResponse } from './quoteCostView'

// ─── Line meta from the costs read ──────────────────────────────

export const costLineEntry = (data: QuoteCostsResponse | null | undefined, lineId: string): QuoteCostLineEntry | undefined =>
  data?.lines.find((line) => line.quoteLineId === lineId)

/** The `costs` prop of `ArcLineDiff` for a quote line: present for `cpq.costs.view` holders only (the server omits it otherwise). */
export const arcCostsOfLine = (data: QuoteCostsResponse | null | undefined, lineId: string): ArcCostsView | undefined =>
  costLineEntry(data, lineId)?.arcCosts

/** Same for an order line (`GET /orders/{id}/costs`; before activation only, holders only). */
export const orderArcCostsOfLine = (response: OrderCostsResponse | null | undefined, orderLineId: string): ArcCostsView | undefined =>
  response?.lines.find((line) => line.orderLineId === orderLineId)?.arcCosts

// ─── ArcLineDiff cost rows ──────────────────────────────────────

export type ArcDiffCostRow = { key: 'mrcCost' | 'mrcMargin' | 'nrcCost'; before: number; after: number }

/**
 * "MRC cost" / "MRC margin" / "NRC cost" rows. Margin = the line's price minus its cost (the cancel line's price after is 0).
 * `null` without costs: the rows stay hidden (the server omits `costs` without `cpq.costs.view`).
 */
export function arcDiffCostRows(costs: ArcCostsView | null | undefined, prices: { beforeMrc: number; afterMrc: number }): ArcDiffCostRow[] | null {
  if (!costs) return null
  const round = (value: number) => Math.round(value * 10_000) / 10_000
  return [
    { key: 'mrcCost', before: costs.before.mrcCost, after: costs.after.mrcCost },
    { key: 'mrcMargin', before: round(prices.beforeMrc - costs.before.mrcCost), after: round(prices.afterMrc - costs.after.mrcCost) },
    { key: 'nrcCost', before: costs.before.nrcCost, after: costs.after.nrcCost },
  ]
}
