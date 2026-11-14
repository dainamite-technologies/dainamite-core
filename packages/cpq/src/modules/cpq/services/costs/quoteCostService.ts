import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  CpqInventoryAsset,
  CpqInventoryCost,
  CpqInventorySubscription,
  CpqInventorySubscriptionItem,
  CpqOrderConfiguration,
  CpqProductCharge,
  CpqProductOffering,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
  CpqQuoteMarkupOverride,
} from '../../data/entities'
import { MANUAL_COST_KEY_PREFIX, cpqCostPreviewSchema, cpqQuoteLineCostCreateSchema, cpqQuoteLineCostUpdateSchema, cpqQuoteMarkupOverrideSetSchema, type CostPreviewInput, type QuoteLineCostCreate, type QuoteLineCostUpdate, type QuoteMarkupOverrideSet } from '../../data/quote-costs'
import { ASSET_NOT_LIVE_STATUSES, ITEM_NOT_LIVE_STATUSES } from '../../data/costs'
import { isArcTerminationLine } from '../arcLineRemoval'
import { isArcMirrorLine, isFrozenMirrorLine } from '../arcPriceFreeze'
import { evaluateApplicability } from '../cpqPricingService'
import { QuotingError, type DefaultCpqQuotingService } from '../cpqQuotingService'
import { withQuotePricingWrite } from '../priceAdjustments/quotePricingWrite'
import { getBaseCurrencyCode, type TenantScope } from '../types'
import { affectsPrice, COST_CLOSED_STATUSES, extendsValidity, isWriteRefused, type CostLockState } from './costLock'
import type { CpqCostService } from './costService'
import { isQuoteCostLocked, previewCatalogCosts } from './costResolution'
import { computeCostPlusPrice, type MarkupRule } from './costPlusPrice'
import type { QuoteMargin } from './quoteMargin'
import { createMarginTracker } from './quoteMarginTracker'
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

/** What an action-log entry may carry of a cost line: ids, statuses, roles and the cost key. Never an amount, supplier or note. */
export type QuoteCostAudit = { id: string; quoteLineId: string; costKey: string; role: string; origin: string; valueStatus: string; valueOrigin: string | null }
export type MarkupOverrideAudit = { id: string; quoteLineId: string; chargeCode: string }

export interface QuoteCostWriteResult {
  cost: FullCostView | null
  audit: { before: QuoteCostAudit | null; after: QuoteCostAudit | null }
  margin: QuoteMargin
  pricingRevision: number
}
export interface MarkupOverrideWriteResult {
  override: MarkupOverrideView | null
  audit: { before: MarkupOverrideAudit | null; after: MarkupOverrideAudit | null }
  margin: QuoteMargin
  pricingRevision: number
}

export const costAudit = (row: CpqQuoteLineCost): QuoteCostAudit => ({
  id: row.id, quoteLineId: row.quoteLineId, costKey: row.costKey, role: row.role, origin: row.origin,
  valueStatus: row.valueStatus, valueOrigin: row.valueOrigin ?? null,
})

const lockState = (row: CpqQuoteLineCost): CostLockState => ({
  role: row.role, chargeCode: row.chargeCode, costType: row.costType, costModel: row.costModel, source: row.source,
  unitAmount: row.unitAmount, currencyCode: row.currencyCode, valueStatus: row.valueStatus,
  validUntil: row.validUntil, supplierTermEnd: row.supplierTermEnd, supplierMinTermMonths: row.supplierMinTermMonths,
})

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
          markupCurrencyCode: charge.currencyCode,
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

  /**
   * Always available to `cpq.costs.view`, also with the toggle off (it is what an operator checks before switching off).
   * One aggregate query per figure: no cost row is hydrated and no id list is bound, so the cost
   * of the call does not grow with the tenant's cost history (it backs every cost-plus editor load).
   */
  async usage(scope: TenantScope) {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const enabled = await this.deps.costService.enabled(scope.tenantId)
    const costPlusCharges = await em.count(CpqProductCharge, { ...scoped(scope), pricingMethod: 'cost_plus', isActive: true })
    // `id IN (SELECT quote_configuration_id FROM cpq_quote_line_costs WHERE …)`: a semi-join, so a
    // quote with many cost lines counts once (distinct) and Postgres never sees a bound id list.
    const costedQuotes = em.createQueryBuilder(CpqQuoteLineCost, 'qlc').select('qlc.quoteConfigurationId').where(scoped(scope))
    // Open = costs not closed (an accepted quote still needs its costs confirmed) and not yet converted to an order.
    const orderedQuotes = em.createQueryBuilder(CpqOrderConfiguration, 'oc').select('oc.sourceQuoteId').where(scoped(scope))
    const openQuotes = await em.count(CpqQuoteConfiguration, {
      ...scoped(scope), cpqStatus: { $nin: [...COST_CLOSED_STATUSES] }, id: { $in: costedQuotes, $nin: orderedQuotes },
    })
    // Live subscriptions carrying OPEN costs (Q6: status active AND the owning item / asset is live): nested
    // semi-joins on the inventory cost rows and their owners (one count, no row hydrated, no bound id list).
    const liveItems = em.createQueryBuilder(CpqInventorySubscriptionItem, 'si').select('si.id')
      .where({ ...scoped(scope), status: { $nin: [...ITEM_NOT_LIVE_STATUSES] } })
    const liveAssets = em.createQueryBuilder(CpqInventoryAsset, 'ia').select('ia.id')
      .where({ ...scoped(scope), status: { $nin: [...ASSET_NOT_LIVE_STATUSES] } })
    const costedSubscriptions = em.createQueryBuilder(CpqInventoryCost, 'ic').select('ic.subscriptionId').where({
      ...scoped(scope), status: 'active',
      $or: [{ subscriptionItemId: { $in: liveItems } }, { assetId: { $in: liveAssets } }],
    })
    const liveSubscriptions = await em.count(CpqInventorySubscription, {
      ...scoped(scope), status: { $nin: [...ITEM_NOT_LIVE_STATUSES] }, id: { $in: costedSubscriptions },
    })
    return { enabled, costPlusCharges, openQuotes, openRequests: 0, liveSubscriptions }
  }

  // ─── Cost line writes ──────────────────────────────────────────

  async createCost(quoteId: string, input: QuoteLineCostCreate, actor: string, scope: TenantScope): Promise<QuoteCostWriteResult> {
    const parsed = cpqQuoteLineCostCreateSchema.parse(input)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, actor, async (em, quote) => {
      const line = await this.requireLine(em, quote, parsed.quoteLineId, scope, 'structure')
      const charge = parsed.chargeCode ? await this.requireCharge(em, line, parsed.chargeCode, scope) : null
      this.assertRoleRules(parsed.role, parsed.costType, charge, parsed.costModel)
      const currency = quote.currencyCode
      const value = this.valueFields({ source: parsed.source, status: parsed.valueStatus ?? undefined, amount: parsed.unitAmount, currency: parsed.currencyCode, quoteCurrency: currency })
      const instance = value.unitAmount === null ? null : await this.instanceAmount(em, quote, line, charge, parsed.costModel, value.unitAmount)
      const candidate: CostLockState = {
        role: parsed.role, chargeCode: charge?.code ?? null, costType: parsed.costType, costModel: parsed.costModel, source: parsed.source,
        unitAmount: value.unitAmount, currencyCode: value.currencyCode, valueStatus: value.valueStatus,
      }
      const locked = await isQuoteCostLocked(em, quote, scope)
      this.assertWritable(quote, locked, affectsPrice(null, candidate))
      const row = em.create(CpqQuoteLineCost, {
        ...scope, id: randomUUID(), quoteConfigurationId: quote.id, quoteId: quote.quoteId, quoteLineId: line.quoteLineId,
        costKey: `${MANUAL_COST_KEY_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        chargeCode: charge?.code ?? null, origin: 'manual', costElementId: null, name: parsed.name, role: parsed.role,
        costType: parsed.costType, source: parsed.source, costModel: parsed.costModel,
        valueStatus: value.valueStatus, valueOrigin: value.valueStatus === 'none' ? null : 'manual',
        unitAmount: value.unitAmount === null ? null : String(value.unitAmount), instanceAmount: instance === null ? null : money(instance),
        currencyCode: value.currencyCode, supplierId: parsed.supplierId ?? null, supplierName: clean(parsed.supplierName),
        supplierQuoteRef: clean(parsed.supplierQuoteRef), validUntil: parsed.validUntil ?? null, supplierTermEnd: parsed.supplierTermEnd ?? null,
        supplierMinTermMonths: parsed.supplierMinTermMonths ?? null, note: clean(parsed.note), errorCode: null, sourcingStatus: 'not_requested',
      } as never)
      const margin = await this.persistAndPrice(em, quote, scope, locked, () => { em.persist(row) })
      return { cost: fullCostView(row), audit: { before: null, after: costAudit(row) }, margin, pricingRevision: quote.pricingRevision ?? 0 }
    })
  }

  async updateCost(quoteId: string, costId: string, patch: QuoteLineCostUpdate, actor: string, scope: TenantScope): Promise<QuoteCostWriteResult> {
    const parsed = cpqQuoteLineCostUpdateSchema.parse(patch)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, actor, async (em, quote) => {
      const row = await this.requireCost(em, quote, costId, scope)
      const line = await this.requireLine(em, quote, row.quoteLineId, scope, 'value')
      const before = lockState(row)
      const auditBefore = costAudit(row)
      const structural = (['name', 'role', 'costType', 'source', 'costModel', 'chargeCode'] as const).filter((key) => parsed[key] !== undefined)
      // Catalog lines take their structure from the catalog element; only values, supplier data and the note are editable.
      if (row.origin === 'catalog' && structural.length > 0) throw new QuotingError(422, 'FIELD_NOT_ALLOWED', undefined, { fields: structural })

      const chargeCode = parsed.chargeCode !== undefined ? clean(parsed.chargeCode) : row.chargeCode
      const charge = chargeCode ? await this.requireCharge(em, line, chargeCode, scope) : null
      const role = parsed.role ?? row.role
      const costType = parsed.costType ?? row.costType
      const source = parsed.source ?? row.source
      const costModel = parsed.costModel ?? row.costModel
      this.assertRoleRules(role, costType, charge, costModel)

      const amountGiven = parsed.unitAmount !== undefined
      const nextAmount = amountGiven ? parsed.unitAmount ?? null : row.unitAmount === null ? null : Number(row.unitAmount)
      const value = this.valueFields({
        source,
        status: parsed.valueStatus ?? (amountGiven ? (nextAmount === null ? 'none' : row.valueStatus === 'none' ? undefined : row.valueStatus) : row.valueStatus),
        amount: nextAmount, currency: parsed.currencyCode !== undefined ? parsed.currencyCode : row.currencyCode, quoteCurrency: quote.currencyCode,
      })
      const next: CostLockState = {
        role, chargeCode: charge?.code ?? null, costType, costModel, source, unitAmount: value.unitAmount, currencyCode: value.currencyCode,
        valueStatus: value.valueStatus,
        validUntil: parsed.validUntil !== undefined ? parsed.validUntil : row.validUntil,
        supplierTermEnd: parsed.supplierTermEnd !== undefined ? parsed.supplierTermEnd : row.supplierTermEnd,
        supplierMinTermMonths: parsed.supplierMinTermMonths !== undefined ? parsed.supplierMinTermMonths : row.supplierMinTermMonths,
      }
      const valueChanged = (before.unitAmount === null ? null : Number(before.unitAmount)) !== value.unitAmount || before.currencyCode !== value.currencyCode
      const statusChanged = before.valueStatus !== value.valueStatus

      const locked = await isQuoteCostLocked(em, quote, scope)
      this.assertWritable(quote, locked, affectsPrice(before, next))
      // Overwriting a catalog value needs a reason; the previous value is kept in the audit trail by the note.
      const note = clean(parsed.note)
      if (row.valueOrigin === 'catalog' && valueChanged && !note) throw new QuotingError(422, 'NOTE_REQUIRED')
      if (extendsValidity(before, next)) {
        const newRef = clean(parsed.supplierQuoteRef)
        if (!(newRef && newRef !== row.supplierQuoteRef) && !note) throw new QuotingError(422, 'VALIDITY_EVIDENCE_REQUIRED')
      }

      const instance = value.unitAmount === null ? null : await this.instanceAmount(em, quote, line, charge, costModel, value.unitAmount)
      const margin = await this.persistAndPrice(em, quote, scope, locked, () => {
        if (row.origin === 'manual') Object.assign(row, { name: parsed.name ?? row.name, role, costType, source, costModel, chargeCode: charge?.code ?? null })
        Object.assign(row, {
          valueStatus: value.valueStatus, unitAmount: value.unitAmount === null ? null : String(value.unitAmount),
          instanceAmount: instance === null ? null : money(instance), currencyCode: value.currencyCode, errorCode: valueChanged || statusChanged ? null : row.errorCode,
          validUntil: next.validUntil ?? null, supplierTermEnd: next.supplierTermEnd ?? null, supplierMinTermMonths: next.supplierMinTermMonths ?? null,
        })
        // A human entered or confirmed it: the catalog resolver must stop re-resolving this value (until a driver changes).
        if (valueChanged || statusChanged) row.valueOrigin = 'manual'
        if (parsed.supplierId !== undefined) row.supplierId = parsed.supplierId ?? null
        if (parsed.supplierName !== undefined) row.supplierName = clean(parsed.supplierName)
        if (parsed.supplierQuoteRef !== undefined) row.supplierQuoteRef = clean(parsed.supplierQuoteRef)
        if (parsed.note !== undefined) row.note = note
      })
      return { cost: fullCostView(row), audit: { before: auditBefore, after: costAudit(row) }, margin, pricingRevision: quote.pricingRevision ?? 0 }
    })
  }

  async deleteCost(quoteId: string, costId: string, actor: string, scope: TenantScope, expectedRevision?: number): Promise<QuoteCostWriteResult> {
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, expectedRevision, actor, async (em, quote) => {
      const row = await this.requireCost(em, quote, costId, scope)
      if (row.origin !== 'manual') throw new QuotingError(422, 'CATALOG_COST_NOT_DELETABLE')
      const auditBefore = costAudit(row)
      const locked = await isQuoteCostLocked(em, quote, scope)
      this.assertWritable(quote, locked, affectsPrice(lockState(row), null))
      const margin = await this.persistAndPrice(em, quote, scope, locked, () => { row.deletedAt = new Date() })
      return { cost: null, audit: { before: auditBefore, after: null }, margin, pricingRevision: quote.pricingRevision ?? 0 }
    })
  }

  // ─── Markup overrides ──────────────────────────────────────────

  async setMarkupOverride(quoteId: string, input: QuoteMarkupOverrideSet, actor: string, scope: TenantScope): Promise<MarkupOverrideWriteResult> {
    const parsed = cpqQuoteMarkupOverrideSetSchema.parse(input)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, actor, async (em, quote) => {
      const line = await this.requireLine(em, quote, parsed.quoteLineId, scope, 'structure')
      const charge = await this.requireCharge(em, line, parsed.chargeCode, scope)
      if (charge.pricingMethod !== 'cost_plus') throw new QuotingError(422, 'CHARGE_NOT_COST_PLUS')
      const locked = await isQuoteCostLocked(em, quote, scope)
      this.assertWritable(quote, locked, true)
      const existing = await em.findOne(CpqQuoteMarkupOverride, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId: line.quoteLineId, chargeCode: charge.code })
      const auditBefore = existing ? { id: existing.id, quoteLineId: existing.quoteLineId, chargeCode: existing.chargeCode } : null
      const values = { markupRule: parsed.markupRule, markupValue: String(parsed.markupValue), note: parsed.note, updatedByUserId: actor }
      const row = existing ?? em.create(CpqQuoteMarkupOverride, {
        ...scope, id: randomUUID(), quoteConfigurationId: quote.id, quoteId: quote.quoteId, quoteLineId: line.quoteLineId,
        chargeCode: charge.code, createdByUserId: actor, ...values,
      } as never)
      const margin = await this.persistAndPrice(em, quote, scope, locked, () => {
        if (existing) Object.assign(existing, values)
        else em.persist(row)
      })
      return { override: markupOverrideView(row), audit: { before: auditBefore, after: { id: row.id, quoteLineId: row.quoteLineId, chargeCode: row.chargeCode } }, margin, pricingRevision: quote.pricingRevision ?? 0 }
    })
  }

  async clearMarkupOverride(quoteId: string, quoteLineId: string, chargeCode: string, actor: string, scope: TenantScope, expectedRevision?: number): Promise<MarkupOverrideWriteResult> {
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, expectedRevision, actor, async (em, quote) => {
      const row = await em.findOne(CpqQuoteMarkupOverride, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId, chargeCode })
      if (!row) throw new QuotingError(404, 'Markup override not found')
      const locked = await isQuoteCostLocked(em, quote, scope)
      this.assertWritable(quote, locked, true)
      const auditBefore = { id: row.id, quoteLineId: row.quoteLineId, chargeCode: row.chargeCode }
      const margin = await this.persistAndPrice(em, quote, scope, locked, () => { row.deletedAt = new Date(); row.updatedByUserId = actor })
      return { override: null, audit: { before: auditBefore, after: null }, margin, pricingRevision: quote.pricingRevision ?? 0 }
    })
  }

  // ─── Internals ─────────────────────────────────────────────────

  private write<T>(quoteId: string, scope: TenantScope, revision: number | undefined, actor: string, execute: (em: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>) {
    return withQuotePricingWrite(this.deps.em, quoteId, scope, execute, (status, message) => new QuotingError(status, message), revision, undefined, { pricingCause: 'cost', actorUserId: actor },
      createMarginTracker({ scope, isEnabled: (tenantId) => this.deps.costService.enabled(tenantId), force: true }))
  }

  /**
   * Persists the change, then re-prices through the saved recalculation while the quote is unlocked. A locked quote
   * only ever receives price-neutral writes (margin-only, confirmation, validity), and re-pricing it would re-read the
   * catalog, so it is skipped. Returns the margin of the written state.
   */
  private async persistAndPrice(em: EntityManager, quote: CpqQuoteConfiguration, scope: TenantScope, locked: boolean, persist: () => void): Promise<QuoteMargin> {
    await withAtomicFlush(em, [
      persist,
      async () => { if (!locked) await this.deps.quotingService.recalculateLockedQuote(em, quote, scope) },
    ])
    return loadQuoteMargin(em, quote, scope)
  }

  private assertWritable(quote: CpqQuoteConfiguration, locked: boolean, priceAffecting: boolean) {
    if (isWriteRefused({ locked, status: quote.cpqStatus, priceAffecting })) throw new QuotingError(409, 'COST_LOCKED')
  }

  /** R10: a price-basis cost belongs to a cost-plus charge of the line; a line-level cost is margin-only. */
  private assertRoleRules(role: string, costType: string, charge: CpqProductCharge | null, costModel: string) {
    if (role === 'price_basis') {
      if (!charge || charge.pricingMethod !== 'cost_plus') throw new QuotingError(422, 'PRICE_BASIS_REQUIRES_COST_PLUS')
      if (charge.chargeType !== costType) throw new QuotingError(422, 'COST_TYPE_MISMATCH')
    }
    if (costModel === 'per_unit' && !charge?.quantityAttributeCode) throw new QuotingError(422, 'QUANTITY_ATTRIBUTE_REQUIRED')
  }

  /** Value, status and currency of a written cost line (`valueFields` of R10 / §1.4.6). */
  private valueFields(args: { source: string; status: string | null | undefined; amount: number | null | undefined; currency: string | null | undefined; quoteCurrency: string }) {
    const amount = args.amount ?? null
    if (amount === null) {
      if (args.status && args.status !== 'none') throw new QuotingError(422, 'AMOUNT_REQUIRED')
      if (args.source === 'fixed') throw new QuotingError(422, 'AMOUNT_REQUIRED')
      return { unitAmount: null, currencyCode: null, valueStatus: 'none' }
    }
    if (args.status === 'none') throw new QuotingError(422, 'FIELD_NOT_ALLOWED')
    const currency = args.currency ?? args.quoteCurrency
    // No FX before the FX feature: never a silent 1:1 conversion (R3).
    if (currency !== args.quoteCurrency) throw new QuotingError(422, 'CURRENCY_NO_RATE')
    const status = args.status ?? (args.source === 'fixed' ? 'confirmed' : 'estimated')
    return { unitAmount: amount, currencyCode: currency, valueStatus: status }
  }

  /** Per-instance amount: `per_unit` multiplies by the charge's quantity attribute of the line. */
  private async instanceAmount(em: EntityManager, quote: CpqQuoteConfiguration, line: CpqQuoteLineConfiguration, charge: CpqProductCharge | null, costModel: string, unit: number): Promise<number> {
    if (costModel !== 'per_unit') return unit
    const offering = line.offeringId ? await em.findOne(CpqProductOffering, { ...scoped({ organizationId: line.organizationId, tenantId: line.tenantId }), id: line.offeringId }) : null
    const merged: Record<string, unknown> = { ...(quote.quoteContext ?? {}), ...(offering?.designTimeValues ?? {}), ...line.configuration }
    const quantity = Number(merged[charge?.quantityAttributeCode ?? ''] ?? 0)
    return unit * (Number.isFinite(quantity) ? quantity : 0)
  }

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

  private async requireCost(em: EntityManager, quote: CpqQuoteConfiguration, id: string, scope: TenantScope) {
    const row = await em.findOne(CpqQuoteLineCost, { ...scoped(scope), id, quoteConfigurationId: quote.id })
    if (!row) throw new QuotingError(404, 'Cost line not found')
    return row
  }

  /**
   * `structure` (a manual cost, a markup override): only lines the quote itself prices — never an
   * ARC mirror or cancel line. `value` (entering / confirming a stored cost): also a non-frozen ARC
   * mirror line (a Renew mirror re-priced at today's standard, a reconfigured Amend mirror), whose
   * catalog cost lines bind at conversion (R7) — but never a cancel line or a frozen mirror.
   */
  private async requireLine(em: EntityManager, quote: CpqQuoteConfiguration, quoteLineId: string, scope: TenantScope, mode: 'structure' | 'value') {
    const line = await em.findOne(CpqQuoteLineConfiguration, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId })
    if (!line) throw new QuotingError(404, 'Quote line not found')
    const eligible = (line.offeringId || line.productId)
      && !isArcTerminationLine(line, quote.quoteType)
      && (mode === 'value'
        ? !isFrozenMirrorLine(line.configuration, quote.quoteType)
        : !isArcMirrorLine(line.configuration, quote.quoteType))
    if (!eligible) throw new QuotingError(422, 'LINE_NOT_ELIGIBLE')
    return line
  }

  private async requireCharge(em: EntityManager, line: CpqQuoteLineConfiguration, code: string, scope: TenantScope) {
    const owner = line.offeringId ? { offeringId: line.offeringId } : { productId: line.productId }
    const charge = await em.findOne(CpqProductCharge, { ...scoped(scope), isActive: true, ...owner, code })
    if (!charge) throw new QuotingError(422, 'CHARGE_NOT_FOUND')
    return charge
  }
}
