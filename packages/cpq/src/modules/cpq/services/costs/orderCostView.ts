import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqOrderConfiguration, CpqOrderLineConfiguration, CpqOrderLineCost, CpqQuoteConfiguration } from '../../data/entities'
import { isArcTerminationLine } from '../arcLineRemoval'
import { isArcMirrorLine } from '../arcPriceFreeze'
import { QuotingError } from '../cpqQuotingService'
import type { ResolvedCharge, TenantScope } from '../types'
import { computeQuoteMargin, type MarginCost, type MarginLine, type QuoteMargin } from './quoteMargin'

/**
 * Read model of an order's line costs (feature spec §API Contracts, `GET /api/cpq/orders/{orderId}/costs`).
 * Two projections: status-only (no `cpq.costs.view`) and full. The margin is computed here on read and never stored.
 */

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const today = () => new Date().toISOString().slice(0, 10)

/** Identity and status only: no amount, currency, supplier, validity or margin. */
export function redactedOrderCostView(row: CpqOrderLineCost) {
  return { id: row.id, costKey: row.costKey, name: row.name, role: row.role, costType: row.costType, valueStatus: row.valueStatus }
}

export function fullOrderCostView(row: CpqOrderLineCost) {
  return {
    ...redactedOrderCostView(row),
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
    inventoryCostId: row.inventoryCostId ?? null,
    sourceQuoteLineCostId: row.sourceQuoteLineCostId,
  }
}

export type OrderCostsRead = {
  orderId: string
  currencyCode?: string
  lines: Array<{ orderLineId: string; costs: Array<ReturnType<typeof redactedOrderCostView> | ReturnType<typeof fullOrderCostView>> }>
  margin?: QuoteMargin
}

/** The order (by CPQ order id or sales order id), its lines and its costs: 4 queries, all tenant scoped. */
export async function readOrderCosts(em: EntityManager, orderId: string, scope: TenantScope, canViewCosts: boolean): Promise<OrderCostsRead> {
  const config = (await em.findOne(CpqOrderConfiguration, { id: orderId, ...scoped(scope) }))
    ?? (await em.findOne(CpqOrderConfiguration, { orderId, ...scoped(scope) }))
  if (!config) throw new QuotingError(404, 'Order not found')
  const [lines, costs] = await Promise.all([
    em.find(CpqOrderLineConfiguration, { orderConfigurationId: config.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }),
    em.find(CpqOrderLineCost, { orderConfigurationId: config.id, ...scoped(scope) }),
  ])
  // Same line predicate as the quote margin (`quoteCostView`): the source quote's type decides which lines are
  // ARC mirror lines (left out of the deal) and which are termination lines (their costs never count).
  const sourceQuote = config.sourceQuoteId
    ? await em.findOne(CpqQuoteConfiguration, { id: config.sourceQuoteId, ...scoped(scope) })
    : null
  const quoteType = sourceQuote?.quoteType ?? 'new'
  const ordered = [...costs].sort((a, b) => a.orderLineId.localeCompare(b.orderLineId) || a.costKey.localeCompare(b.costKey))
  const project = canViewCosts ? fullOrderCostView : redactedOrderCostView
  const groups = new Map<string, Array<ReturnType<typeof project>>>()
  for (const row of ordered) groups.set(row.orderLineId, [...(groups.get(row.orderLineId) ?? []), project(row)])
  const result: OrderCostsRead = { orderId: config.id, lines: [...groups].map(([orderLineId, lineCosts]) => ({ orderLineId, costs: lineCosts })) }
  if (!canViewCosts) return result
  const marginLines: MarginLine[] = lines.map((line) => ({
    lineId: line.orderLineId,
    parentLineId: line.parentLineId ?? null,
    quantity: Number(line.quantity),
    termMonths: line.termMonths ?? null,
    includeInDeal: !isArcMirrorLine(line.configuration, quoteType),
    charges: ((line.charges ?? []) as unknown as ResolvedCharge[]).map((charge) => ({ chargeCode: charge.chargeCode, chargeType: charge.chargeType, totalPrice: charge.totalPrice ?? null })),
  }))
  const terminationIds = new Set(lines.filter((line) => isArcTerminationLine(line, quoteType)).map((line) => line.orderLineId))
  const lineIds = new Set(marginLines.map((line) => line.lineId).filter((id) => !terminationIds.has(id)))
  const marginCosts: MarginCost[] = ordered.filter((row) => lineIds.has(row.orderLineId)).map((row) => ({
    quoteLineId: row.orderLineId, chargeCode: row.chargeCode ?? null, costKey: row.costKey, role: row.role, costType: row.costType,
    valueStatus: row.valueStatus, instanceAmount: row.instanceAmount, currencyCode: row.currencyCode, fxRate: row.fxRate, validUntil: row.validUntil,
  }))
  return { ...result, currencyCode: config.currencyCode, margin: computeQuoteMargin({ currencyCode: config.currencyCode, lines: marginLines, costs: marginCosts, today: today() }) }
}
