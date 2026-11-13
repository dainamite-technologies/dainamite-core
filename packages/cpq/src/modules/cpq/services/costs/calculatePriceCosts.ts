import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CpqQuoteLineConfiguration } from '../../data/entities'
import type { CostPlusLineContext } from '../cpqPricingService'
import type { ResolvedCharge, TenantScope } from '../types'
import { previewCatalogCosts } from './costResolution'

export type PriceItemInput = { offeringId?: string | null; productId?: string | null; configuration: Record<string, unknown> }

/**
 * Cost inputs of cost-plus pricing for calculate-price (R15): no quote, nothing persisted.
 * Toggle off (R14) returns disabled contexts, so cost-plus charges are price-on-request.
 * Catalog costs are resolved in memory per item, exactly as a quote line would get them.
 */
export async function resolveCalculatePriceCostContexts(params: {
  em: EntityManager
  isEnabled: (tenantId: string) => Promise<boolean>
  items: PriceItemInput[]
  currencyCode: string
  scope: TenantScope
}): Promise<CostPlusLineContext[]> {
  const { items, currencyCode, scope } = params
  if (!(await params.isEnabled(scope.tenantId))) {
    return items.map(() => ({ enabled: false, costs: [], overrides: new Map(), errors: [] }))
  }
  const em = params.em.fork({ clear: true, useContext: false })
  const contexts: CostPlusLineContext[] = []
  for (const item of items) {
    const lineConfig = { quoteLineId: randomUUID(), offeringId: item.offeringId ?? null, productId: item.productId ?? null, configuration: item.configuration } as unknown as CpqQuoteLineConfiguration
    const costs = await previewCatalogCosts({
      em, scope, lines: [{ lineConfig, mergedConfig: item.configuration }],
      quote: { id: randomUUID(), quoteId: randomUUID(), cpqStatus: 'new', quoteType: 'new', currencyCode },
    })
    contexts.push({
      enabled: true, overrides: new Map(), errors: [],
      costs: costs.map((cost) => ({
        chargeCode: (cost.chargeCode as string | null | undefined) ?? null, role: cost.role as string,
        valueStatus: cost.valueStatus as string, instanceAmount: (cost.instanceAmount as string | null | undefined) ?? null,
      })),
    })
  }
  return contexts
}

export type PublicCharge = ResolvedCharge & { indicative?: boolean; priceOnRequest?: boolean }

/**
 * Presents one resolved charge for calculate-price. Cost-plus charges gain `priceOnRequest`
 * (unpriced) or `indicative` (priced from an on-request estimate); the response never carries
 * a cost, supplier, markup or the stored fallback price. Other charges are returned untouched.
 */
export function presentCostPlusCharge(charge: ResolvedCharge, context: CostPlusLineContext): PublicCharge {
  if (charge.pricingMethod !== 'cost_plus') return charge
  const { fallbackPrice: _fallback, ...rest } = charge
  if (charge.unitPrice === null || charge.totalPrice === null) return { ...rest, priceOnRequest: true }
  const estimated = context.costs.some((cost) => cost.chargeCode === charge.chargeCode && cost.role === 'price_basis' && cost.valueStatus === 'estimated')
  return estimated ? { ...rest, indicative: true } : rest
}
