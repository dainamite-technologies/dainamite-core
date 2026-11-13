import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CpqProductCharge,
  CpqProductOffering,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
  CpqQuoteMarkupOverride,
} from '../../data/entities'
import { cpqCostPreviewSchema, type CostPreviewInput } from '../../data/quote-costs'
import { evaluateApplicability } from '../cpqPricingService'
import { QuotingError, type DefaultCpqQuotingService } from '../cpqQuotingService'
import { getBaseCurrencyCode, TERMINAL_STATUSES, type TenantScope } from '../types'
import type { CpqCostService } from './costService'
import { isQuoteCostLocked, previewCatalogCosts } from './costResolution'
import { computeCostPlusPrice, type MarkupRule } from './costPlusPrice'
import type { QuoteMargin } from './quoteMargin'
import {
  fullCostView, groupByLine, loadQuoteCosts, loadQuoteMargin, loadQuoteMarkupOverrides, markupOverrideView, redactedCostView,
  type FullCostView, type MarkupOverrideView,
} from './quoteCostView'

type Dependencies = {
  em: EntityManager
  costService: Pick<CpqCostService, 'enabled'>
  quotingService: Pick<DefaultCpqQuotingService, 'recalculateLockedQuote'>
}

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const money = (value: number) => String(Math.round((value + Number.EPSILON) * 10_000) / 10_000)
const clean = (value: string | null | undefined) => (value === undefined || value === null || value.trim() === '' ? null : value.trim())
const notFound = () => new QuotingError(404, 'Not found')

/**
 * Quote cost reads, previews and writes (App Spec §1.4.6, R10, R11). Registered
 * in DI as `cpqQuoteCostService`.
 */
export class CpqQuoteCostService {
  constructor(private readonly deps: Dependencies) {}

  // ─── Reads ─────────────────────────────────────────────────────

  /** Toggle off -> 404 (feature spec Q8). Without `includeCosts` the projection carries status only. */
  async read(quoteId: string, scope: TenantScope, includeCosts: boolean) {
    await this.requireEnabled(scope)
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const quote = await this.findQuote(em, quoteId, scope)
    const costs = await loadQuoteCosts(em, quote.id, scope)
    const pricingRevision = quote.pricingRevision ?? 0
    if (!includeCosts) return { lines: groupByLine(costs, redactedCostView), pricingRevision }
    const [overrides, margin] = await Promise.all([loadQuoteMarkupOverrides(em, quote.id, scope), loadQuoteMargin(em, quote, scope)])
    return { lines: groupByLine(costs, fullCostView), markupOverrides: overrides.map(markupOverrideView), margin, pricingRevision }
  }

  /** Quote-independent costs and list price of a configuration. Persists nothing. */
  async preview(input: CostPreviewInput, scope: TenantScope) {
    const parsed = cpqCostPreviewSchema.parse(input)
    await this.requireEnabled(scope)
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const owner = parsed.offeringId ? { offeringId: parsed.offeringId } : { productId: parsed.productId }
    const offering = parsed.offeringId
      ? await em.findOne(CpqProductOffering, { ...scoped(scope), id: parsed.offeringId })
      : null
    if (parsed.offeringId && !offering) throw new QuotingError(404, 'Offering not found')
    const charges = await em.find(CpqProductCharge, { ...scoped(scope), isActive: true, ...owner }, { orderBy: { sortOrder: 'asc' } })
    const currency = parsed.currencyCode ?? await getBaseCurrencyCode(em, scope)
    const configuration: Record<string, unknown> = { ...(offering?.designTimeValues ?? {}), ...parsed.configuration }
    if (parsed.quantity !== undefined) {
      for (const charge of charges) if (charge.quantityAttributeCode) configuration[charge.quantityAttributeCode] = parsed.quantity
    }
    const lineConfig = { quoteLineId: randomUUID(), offeringId: parsed.offeringId ?? null, productId: parsed.productId ?? null, configuration } as unknown as CpqQuoteLineConfiguration
    const costs = await previewCatalogCosts({
      em, scope, lines: [{ lineConfig, mergedConfig: configuration }],
      quote: { id: randomUUID(), quoteId: randomUUID(), cpqStatus: 'new', quoteType: 'new', currencyCode: currency },
    })
    const result = []
    for (const charge of charges) {
      if (!evaluateApplicability(charge.applicabilityCondition, configuration)) continue
      const own = costs.filter((cost) => cost.chargeCode === charge.code)
      const costPlus = charge.pricingMethod === 'cost_plus'
      if (!costPlus && own.length === 0) continue
      const basis = own.filter((cost) => cost.role === 'price_basis')
      const costTotal = basis.reduce((sum, cost) => sum + Number(cost.instanceAmount ?? 0), 0)
      let listTotalPrice: number | null = null
      let error: string | undefined
      if (costPlus) {
        const priced = computeCostPlusPrice({
          costs: own as never, markupRule: (charge.markupRule ?? '') as MarkupRule, markupValue: charge.markupValue ?? 'NaN',
          chargeModel: charge.chargeModel === 'per_unit' ? 'per_unit' : 'flat',
          quantity: Number(configuration[charge.quantityAttributeCode ?? ''] ?? 0), currencyCode: currency,
        })
        if (priced.ok) listTotalPrice = priced.listTotal
        else error = priced.error
      }
      result.push({
        chargeCode: charge.code, pricingMethod: charge.pricingMethod,
        costs: own.map((cost) => ({
          costKey: cost.costKey, name: cost.name, role: cost.role, source: cost.source, valueStatus: cost.valueStatus,
          unitAmount: cost.unitAmount ?? null, instanceAmount: cost.instanceAmount ?? null, currencyCode: cost.currencyCode ?? null,
          ...(cost.errorCode ? { error: cost.errorCode } : {}),
        })),
        costTotal: money(costTotal),
        markupRule: costPlus ? charge.markupRule ?? null : null,
        markupValue: costPlus ? charge.markupValue ?? null : null,
        listTotalPrice,
        ...(error ? { error } : {}),
      })
    }
    return { currencyCode: currency, charges: result }
  }

  /** Always available to `cpq.costs.view`, also with the toggle off (it is what an operator checks before switching off). */
  async usage(scope: TenantScope) {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const enabled = await this.deps.costService.enabled(scope.tenantId)
    const costPlusCharges = await em.count(CpqProductCharge, { ...scoped(scope), pricingMethod: 'cost_plus', isActive: true })
    const costRows = await em.find(CpqQuoteLineCost, scoped(scope), { fields: ['quoteConfigurationId'] })
    const quoteIds = [...new Set(costRows.map((row) => row.quoteConfigurationId))]
    const openQuotes = quoteIds.length
      ? await em.count(CpqQuoteConfiguration, { ...scoped(scope), id: { $in: quoteIds }, cpqStatus: { $nin: TERMINAL_STATUSES } })
      : 0
    return { enabled, costPlusCharges, openQuotes, openRequests: 0, liveSubscriptions: 0 }
  }

  // ─── Internals ─────────────────────────────────────────────────

  private async requireEnabled(scope: TenantScope) {
    if (!(await this.deps.costService.enabled(scope.tenantId))) throw notFound()
  }

  private async findQuote(em: EntityManager, quoteId: string, scope: TenantScope) {
    const filter = scoped(scope)
    const quote = await findOneWithDecryption(em, CpqQuoteConfiguration, { ...filter, id: quoteId }, undefined, scope)
      ?? await findOneWithDecryption(em, CpqQuoteConfiguration, { ...filter, quoteId }, undefined, scope)
    if (!quote) throw new QuotingError(404, 'Quote not found')
    return quote
  }
}
