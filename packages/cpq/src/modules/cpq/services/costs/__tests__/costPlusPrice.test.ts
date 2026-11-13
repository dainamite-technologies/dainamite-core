import { DefaultCpqPricingService, type CostPlusLineContext } from '../../cpqPricingService'
import { DefaultCpqQuotingService } from '../../cpqQuotingService'
import { resolveManualAdjustments } from '../../priceAdjustments/resolveManualAdjustments'
import { computeCostPlusPrice, currencyPrecision, type CostPlusCostInput } from '../costPlusPrice'
import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqProductCharge, CpqQuoteConfiguration, CpqQuoteLineConfiguration,
  CpqQuoteLineCost, CpqQuoteMarkupOverride, CpqProductOffering, CpqPriceRule,
} from '../../../data/entities'
import type { PriceAdjustment } from '../../../data/price-adjustments'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const basis = (amount: number | string | null, valueStatus = 'confirmed'): CostPlusCostInput => ({ role: 'price_basis', valueStatus, instanceAmount: amount === null ? null : String(amount) })
const price = (over: Partial<Parameters<typeof computeCostPlusPrice>[0]> = {}) => computeCostPlusPrice({
  costs: [basis(300), basis(100)], markupRule: 'markup_percent', markupValue: 25, chargeModel: 'flat', quantity: 1, currencyCode: 'EUR', ...over,
})

describe('computeCostPlusPrice (R2)', () => {
  const costSets: number[][] = [[300, 100], [0.3333, 0.3334, 10.0001], [1234.5678], [0], [99.99, 0.01, 1e-4]]
  const rules = [
    ['markup_percent', 25, (c: number) => c * 1.25],
    ['markup_percent', 0, (c: number) => c],
    ['target_margin_percent', 20, (c: number) => c / 0.8],
    ['target_margin_percent', 33.3333, (c: number) => c / (1 - 0.333333)],
    ['markup_absolute', 12.5, (c: number) => c + 12.5],
  ] as const

  it.each(rules.flatMap(([rule, value, f]) => costSets.flatMap((set) => (['flat', 'per_unit'] as const).map((model) => [rule, value, f, set, model] as const))))(
    '%s %s over %j (%s): formula, single rounding, per_unit unit at 4 dp',
    (rule, value, formula, set, model) => {
      const quantity = model === 'per_unit' ? 7 : 1
      const result = price({ costs: set.map((amount) => basis(amount)), markupRule: rule, markupValue: value, chargeModel: model, quantity })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const exact = formula(set.reduce((sum, amount) => sum + amount, 0))
      // rounded ONCE from the unrounded sum (not per cost, not per unit)
      expect(result.listTotal).toBeCloseTo(Math.round(exact * 100) / 100, 8)
      expect(Math.abs(result.listTotal - exact)).toBeLessThanOrEqual(0.005 + 1e-9)
      if (model === 'flat') {
        expect(result).toMatchObject({ listUnit: result.listTotal, quantity: 1 })
      } else {
        expect(result.quantity).toBe(7)
        expect(result.listUnit).toBeCloseTo(Math.round((result.listTotal / 7) * 10_000) / 10_000, 8)
        // unit × qty reproduces the total to within the 4 dp unit precision; the engine keeps the exact total.
        expect(Math.abs(result.listUnit * 7 - result.listTotal)).toBeLessThanOrEqual(7 * 0.00005 + 1e-9)
      }
    })

  it('spec scenario: costs 300 + 100 at markup_percent 25 give 500.00', () => {
    expect(price()).toEqual({ ok: true, listTotal: 500, listUnit: 500, quantity: 1 })
  })

  it('counts estimated and confirmed values, ignores margin_only lines', () => {
    const result = price({ costs: [basis(300, 'estimated'), basis(100), { role: 'margin_only', valueStatus: 'none', instanceAmount: null }] })
    expect(result).toMatchObject({ ok: true, listTotal: 500 })
  })

  it('rounds to the currency precision (JPY 0, EUR 2)', () => {
    expect(currencyPrecision('JPY')).toBe(0)
    expect(currencyPrecision('EUR')).toBe(2)
    expect(price({ costs: [basis(10.01)], markupValue: 0, currencyCode: 'JPY' })).toMatchObject({ listTotal: 10 })
  })

  it('per_unit divides the rounded total by the quantity (3 units of a 100.00 total)', () => {
    expect(price({ costs: [basis(80)], chargeModel: 'per_unit', quantity: 3 })).toEqual({ ok: true, listTotal: 100, listUnit: 33.3333, quantity: 3 })
  })

  it('per_unit with zero quantity prices at zero', () => {
    expect(price({ chargeModel: 'per_unit', quantity: 0 })).toEqual({ ok: true, listTotal: 0, listUnit: 0, quantity: 0 })
  })

  it('COST_PENDING when any price-basis cost has no value', () => {
    expect(price({ costs: [basis(300), basis(null, 'none')] })).toEqual({ ok: false, error: 'COST_PENDING' })
  })

  it('NO_PRICE_BASIS_COST when there is no price-basis line', () => {
    expect(price({ costs: [] })).toEqual({ ok: false, error: 'NO_PRICE_BASIS_COST' })
    expect(price({ costs: [{ role: 'margin_only', valueStatus: 'confirmed', instanceAmount: '5' }] })).toEqual({ ok: false, error: 'NO_PRICE_BASIS_COST' })
  })

  it('rejects an unusable markup', () => {
    expect(price({ markupRule: 'target_margin_percent', markupValue: 100 })).toEqual({ ok: false, error: 'MARKUP_INVALID' })
    expect(price({ markupRule: 'bogus' })).toEqual({ ok: false, error: 'MARKUP_INVALID' })
  })
})

// ─── Through the pricing service and the real waterfall ─────────────────────

const costPlusCharge = (over: Record<string, unknown> = {}) => ({
  id: 'charge-1', ...SCOPE, code: 'tail_mrc', name: 'Tail', chargeType: 'mrc', pricingMethod: 'cost_plus', chargeModel: 'flat',
  markupRule: 'markup_percent', markupValue: '25', currencyCode: 'EUR', quantityAttributeCode: null, applicabilityCondition: null,
  isActive: true, deletedAt: null, sortOrder: 0, pricingTableId: null, fixedPrice: null, ...over,
})
const ctx = (over: Partial<CostPlusLineContext> = {}): CostPlusLineContext => ({
  enabled: true, errors: [], overrides: new Map(),
  costs: [{ chargeCode: 'tail_mrc', ...basis(300) }, { chargeCode: 'tail_mrc', ...basis(100) }], ...over,
})
async function priced(charge: Record<string, unknown>, costPlus: CostPlusLineContext, configuration: Record<string, unknown> = {}) {
  const em = { find: jest.fn(async (entity: unknown) => (entity === CpqProductCharge ? [charge] : [])), findOne: jest.fn() }
  const service = new DefaultCpqPricingService(em as never)
  return service.resolveProductCharges({ offeringId: 'o', configuration, currencyCode: 'EUR', ...SCOPE, costPlus })
}
const lineDiscount = (value: number): PriceAdjustment => ({
  id: 'adj-1', quoteLineId: 'line-1', level: 'line', adjustmentType: 'discount_percent', value, currencyCode: null, reasonCode: 'competitive',
  chargeCode: null, chargeTypeFilter: null, createdByUserId: 'user',
} as unknown as PriceAdjustment)

describe('cost-plus charge through the pricing service', () => {
  it('prices the spec scenario and a 10% manual line discount gives an offer of 450.00', async () => {
    const [charge] = await priced(costPlusCharge(), ctx())
    expect(charge).toMatchObject({ pricingMethod: 'cost_plus', unitPrice: 500, totalPrice: 500, listTotalPrice: 500, standardTotalPrice: 500 })
    const adjusted = resolveManualAdjustments([{ lineId: 'line-1', parentLineId: null, enginePriced: true, mirrored: false, charges: [charge] }], [lineDiscount(10)], 'EUR')
    expect(adjusted.errors).toEqual([])
    expect(adjusted.lines[0].charges[0]).toMatchObject({ listTotalPrice: 500, totalPrice: 450, unitPrice: 450 })
  })

  it('COST_PENDING leaves the charge unpriced and records the error', async () => {
    const costPlus = ctx({ costs: [{ chargeCode: 'tail_mrc', ...basis(300) }, { chargeCode: 'tail_mrc', ...basis(null, 'none') }] })
    const [charge] = await priced(costPlusCharge(), costPlus)
    expect(charge).toMatchObject({ pricingMethod: 'cost_plus', unitPrice: null, totalPrice: null, listUnitPrice: null, standardUnitPrice: null })
    expect(costPlus.errors).toEqual([{ chargeCode: 'tail_mrc', code: 'COST_PENDING' }])
    // an unpriced charge neither breaks the waterfall nor takes an adjustment
    const adjusted = resolveManualAdjustments([{ lineId: 'line-1', parentLineId: null, enginePriced: true, mirrored: false, charges: [charge] }], [lineDiscount(10)], 'EUR')
    expect(adjusted.lines[0].charges[0]).toMatchObject({ unitPrice: null, totalPrice: null })
  })

  it('NO_PRICE_BASIS_COST when no cost line belongs to the charge', async () => {
    const costPlus = ctx({ costs: [{ chargeCode: 'other', ...basis(300) }] })
    const [charge] = await priced(costPlusCharge(), costPlus)
    expect(charge.unitPrice).toBeNull()
    expect(costPlus.errors).toEqual([{ chargeCode: 'tail_mrc', code: 'NO_PRICE_BASIS_COST' }])
  })

  it('applies the markup override instead of the charge markup', async () => {
    const costPlus = ctx({ overrides: new Map([['tail_mrc', { markupRule: 'markup_absolute', markupValue: '50' }]]) })
    const [charge] = await priced(costPlusCharge(), costPlus)
    expect(charge).toMatchObject({ totalPrice: 450 })
  })

  it('target_margin_percent and per_unit: unit derived at 4 dp from the rounded total', async () => {
    const [charge] = await priced(
      costPlusCharge({ chargeModel: 'per_unit', quantityAttributeCode: 'qty', markupRule: 'target_margin_percent', markupValue: '20' }),
      ctx({ costs: [{ chargeCode: 'tail_mrc', ...basis(100) }] }), { qty: 3 })
    expect(charge).toMatchObject({ quantity: 3, totalPrice: 125, unitPrice: 41.6667, listTotalPrice: 125 })
  })

  it('toggle off never prices from nothing (COST_PLUS_DISABLED)', async () => {
    const costPlus = ctx({ enabled: false })
    const [charge] = await priced(costPlusCharge(), costPlus)
    expect(charge.unitPrice).toBeNull()
    expect(costPlus.errors).toEqual([{ chargeCode: 'tail_mrc', code: 'COST_PLUS_DISABLED' }])
  })

  it('applies price rules to the cost-plus list price', async () => {
    const rule = { id: 'r', code: 'promo', name: 'Promo', ruleType: 'discount_percent', value: '10', sortOrder: 0, applicabilityCondition: null, chargeCodeFilter: null, chargeTypeFilter: null }
    const em = { find: jest.fn(async (entity: unknown) => (entity === CpqProductCharge ? [costPlusCharge()] : entity === CpqPriceRule ? [rule] : [])), findOne: jest.fn() }
    const [charge] = await new DefaultCpqPricingService(em as never).resolveProductCharges({ offeringId: 'o', configuration: {}, currencyCode: 'EUR', ...SCOPE, costPlus: ctx() })
    expect(charge).toMatchObject({ listTotalPrice: 500, standardTotalPrice: 450, totalPrice: 450 })
  })
})

// ─── Readiness and preview = save through recalculateInternal ───────────────

type Row = Record<string, unknown>
const QUOTE = 'quote-cfg'
const LINE = 'line-1'
function harness(options: { costs: Row[]; elements?: Row[]; status?: string }) {
  const costRows = options.costs
  const lineConfig: Row = { id: 'lc', quoteLineId: LINE, offeringId: 'offering-1', productId: null, configuration: {}, quantity: 1, usageEstimates: null, charges: [], termMonths: null, parentLineId: null }
  const em: Record<string, jest.Mock> = {
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteLineConfiguration) return [lineConfig]
      if (entity === CpqProductCharge) return [costPlusCharge()]
      if (entity === CpqChargeCostElement) return options.elements ?? []
      if (entity === CpqQuoteLineCost) return costRows.filter((row) => row.deletedAt === null && row.quoteConfigurationId === where.quoteConfigurationId)
      if (entity === CpqQuoteMarkupOverride) return []
      return []
    }),
    findOne: jest.fn(async (entity: unknown) => (entity === CpqProductOffering ? null : {})),
    count: jest.fn(async (entity: unknown) => (entity === CpqOrderConfiguration ? 0 : 0)),
    assign: jest.fn((entity: Row, updates: Row) => Object.assign(entity, updates)),
    persist: jest.fn(), create: jest.fn((_e: unknown, data: Row) => data), flush: jest.fn().mockResolvedValue(undefined),
  }
  const quoting = new DefaultCpqQuotingService({
    em: em as never,
    cpqPricingService: new DefaultCpqPricingService(em as never) as never,
    cpqValidationService: { validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }), validateRelationships: jest.fn().mockResolvedValue([]) } as never,
    cpqProductService: {} as never,
    salesDocumentNumberGenerator: {} as never,
    cpqCostService: { enabled: jest.fn().mockResolvedValue(true) },
  })
  const cfg = () => ({ id: QUOTE, quoteId: 'sales-quote', cpqStatus: options.status ?? 'ready', quoteType: 'new_sale', currencyCode: 'EUR', quoteContext: {} }) as unknown as CpqQuoteConfiguration
  return { em, quoting, cfg, lineConfig }
}
const costRow = (over: Row = {}): Row => ({
  ...SCOPE, id: 'c', deletedAt: null, quoteConfigurationId: QUOTE, quoteLineId: LINE, costKey: 'k', origin: 'manual', chargeCode: 'tail_mrc', role: 'price_basis',
  valueStatus: 'confirmed', valueOrigin: 'manual', instanceAmount: '300', unitAmount: '300', currencyCode: 'EUR', errorCode: null, ...over,
})

describe('cost-plus pricing in recalculateInternal', () => {
  it('prices the line from its cost lines and keeps a ready quote ready', async () => {
    const { em, quoting, cfg, lineConfig } = harness({ costs: [costRow({ costKey: 'a' }), costRow({ id: 'd', costKey: 'b', instanceAmount: '100' })] })
    const config = cfg()
    const result = await quoting.recalculateLockedQuote(em as never, config, SCOPE, true)
    expect(config.cpqStatus).toBe('ready')
    expect(lineConfig.charges).toEqual([expect.objectContaining({ pricingMethod: 'cost_plus', totalPrice: 500 })])
    expect(result.pricingSummary.mrcTotal).toBe(500)
  })

  it('a ready quote becomes incomplete when a price-basis cost is none (COST_PENDING)', async () => {
    const { em, quoting, cfg, lineConfig } = harness({ costs: [costRow({ costKey: 'a' }), costRow({ id: 'd', costKey: 'b', valueStatus: 'none', instanceAmount: null })] })
    const config = cfg()
    const result = await quoting.recalculateLockedQuote(em as never, config, SCOPE, true)
    expect(config.cpqStatus).toBe('incomplete')
    expect(lineConfig.charges).toEqual([expect.objectContaining({ pricingMethod: 'cost_plus', unitPrice: null, totalPrice: null })])
    expect(lineConfig.validationErrors).toEqual([expect.objectContaining({ message: 'COST_PENDING', attribute: 'tail_mrc', lineId: LINE })])
    expect(result.pricingSummary.mrcTotal).toBe(0)
  })

  it('a line with no price-basis cost lines is not ready (NO_PRICE_BASIS_COST)', async () => {
    const { em, quoting, cfg, lineConfig } = harness({ costs: [] })
    const config = cfg()
    await quoting.recalculateLockedQuote(em as never, config, SCOPE, true)
    expect(config.cpqStatus).toBe('incomplete')
    expect(lineConfig.validationErrors).toEqual([expect.objectContaining({ message: 'NO_PRICE_BASIS_COST' })])
  })

  it('a preview shows the same price a save produces, and persists no cost line', async () => {
    const element = { id: 'el', ...SCOPE, deletedAt: null, isActive: true, productChargeId: 'charge-1', code: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc',
      source: 'fixed', costModel: 'flat', amount: '400', currencyCode: 'EUR', costTableId: null, costColumnKey: null, estimateAmount: null, applicabilityCondition: null, sortOrder: 0 }
    const previewHarness = harness({ costs: [], elements: [element], status: 'new' })
    const preview = await previewHarness.quoting.recalculateLockedQuote(previewHarness.em as never, previewHarness.cfg(), SCOPE, false)
    expect(previewHarness.em.persist).not.toHaveBeenCalled()
    const saveHarness = harness({ costs: [], elements: [element], status: 'new' })
    const saved = await saveHarness.quoting.recalculateLockedQuote(saveHarness.em as never, saveHarness.cfg(), SCOPE, true)
    expect(saveHarness.em.persist).toHaveBeenCalledTimes(1)
    expect(preview.pricingSummary.mrcTotal).toBe(500)
    expect(preview.pricingSummary).toEqual(saved.pricingSummary)
  })

  it('a locked quote prices from the stored cost lines', async () => {
    const element = { id: 'el', ...SCOPE, deletedAt: null, isActive: true, productChargeId: 'charge-1', code: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc',
      source: 'fixed', costModel: 'flat', amount: '999', currencyCode: 'EUR', costTableId: null, costColumnKey: null, estimateAmount: null, applicabilityCondition: null, sortOrder: 0 }
    const { em, quoting, cfg } = harness({ costs: [costRow({ costKey: 'tail', origin: 'catalog' })], elements: [element], status: 'with_customer' })
    const result = await quoting.recalculateLockedQuote(em as never, cfg(), SCOPE, false)
    expect(result.pricingSummary.mrcTotal).toBe(375)
  })
})
