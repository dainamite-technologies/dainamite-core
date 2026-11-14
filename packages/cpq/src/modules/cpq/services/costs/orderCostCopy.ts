import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqOrderLineCost, type CpqQuoteConfiguration } from '../../data/entities'
import type { TenantScope } from '../types'
import { costLineTotal } from './quoteMargin'
import { loadQuoteCosts } from './quoteCostView'

/**
 * Conversion copy (feature spec "Order line costs copied at conversion"). Copies every non-deleted quote cost
 * line of a quote to exactly one `CpqOrderLineCost` on the order line its quote line became. Runs inside the
 * conversion transaction, after the order lines were created: a throw here rolls the whole conversion back.
 *
 * Order line costs never touch an order price: this writes cost rows only. `total_amount` is the per-line cost
 * total `computeQuoteMargin` uses (instance amount x line quantity; null while the cost is unknown), so the
 * order shows the margin the quote showed. A cost line whose quote line has no order line (a soft-deleted
 * line) is skipped. Persists the rows on `em`; the caller flushes.
 */
export async function copyQuoteCostsToOrder(
  em: EntityManager,
  quote: Pick<CpqQuoteConfiguration, 'id'>,
  orderConfigurationId: string,
  quoteLineIdToOrderLineId: Map<string, string>,
  quantityByQuoteLineId: Map<string, number>,
  scope: TenantScope,
): Promise<CpqOrderLineCost[]> {
  // One query for the whole quote (no per-line lookups); soft-deleted rows are excluded by the loader.
  const costLines = await loadQuoteCosts(em, quote.id, scope)
  const copies: CpqOrderLineCost[] = []
  for (const cost of costLines) {
    const orderLineId = quoteLineIdToOrderLineId.get(cost.quoteLineId)
    if (!orderLineId) continue
    const total = costLineTotal(cost, quantityByQuoteLineId.get(cost.quoteLineId) ?? 1)
    const copy = em.create(CpqOrderLineCost, {
      id: crypto.randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderConfigurationId,
      orderLineId,
      sourceQuoteLineCostId: cost.id,
      costKey: cost.costKey,
      chargeCode: cost.chargeCode ?? null,
      origin: cost.origin,
      costElementId: cost.costElementId ?? null,
      name: cost.name,
      role: cost.role,
      costType: cost.costType,
      source: cost.source,
      costModel: cost.costModel,
      valueStatus: cost.valueStatus,
      valueOrigin: cost.valueOrigin ?? null,
      unitAmount: cost.unitAmount ?? null,
      instanceAmount: cost.instanceAmount ?? null,
      totalAmount: total === null ? null : String(total),
      currencyCode: cost.currencyCode ?? null,
      fxRate: cost.fxRate ?? null,
      fxRateDate: cost.fxRateDate ?? null,
      indexSnapshot: cost.indexSnapshot ?? null,
      supplierId: cost.supplierId ?? null,
      supplierName: cost.supplierName ?? null,
      supplierQuoteRef: cost.supplierQuoteRef ?? null,
      validUntil: cost.validUntil ?? null,
      supplierTermEnd: cost.supplierTermEnd ?? null,
      supplierMinTermMonths: cost.supplierMinTermMonths ?? null,
      note: cost.note ?? null,
    } as never)
    em.persist(copy)
    copies.push(copy)
  }
  return copies
}
