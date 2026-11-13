import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqPricingTable, CpqPricingTableEntry, CpqProductCharge,
  CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqPriceRule, CpqProductOffering,
} from '../../../data/entities'
import { DefaultCpqQuotingService } from '../../cpqQuotingService'
import { isQuoteCostLocked, resolveCostPlusInputs, resolveQuoteCosts } from '../costResolution'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const QUOTE_ID = 'quote-cfg'
const LINE_ID = 'line-1'
const OFFERING = 'offering-1'

type Row = Record<string, unknown>

function store(rows: { charges?: Row[]; elements?: Row[]; tables?: Row[]; entries?: Row[]; costs?: Row[]; orders?: Row[] }) {
  const byEntity = new Map<unknown, Row[]>([
    [CpqProductCharge, rows.charges ?? []], [CpqChargeCostElement, rows.elements ?? []], [CpqPricingTable, rows.tables ?? []],
    [CpqPricingTableEntry, rows.entries ?? []], [CpqQuoteLineCost, rows.costs ?? []], [CpqOrderConfiguration, rows.orders ?? []],
  ])
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return (value as { $in: unknown[] }).$in.includes(row[key])
    return (row[key] ?? null) === value
  })
  const em: Record<string, jest.Mock> = {
    find: jest.fn(async (entity: unknown, where: Row) => (byEntity.get(entity) ?? []).filter((row) => matches(row, where))),
    count: jest.fn(async (entity: unknown, where: Row) => (byEntity.get(entity) ?? []).filter((row) => matches(row, where)).length),
    create: jest.fn((_entity: unknown, data: Row) => ({ id: `cost-${(byEntity.get(CpqQuoteLineCost)!.length + 1)}`, deletedAt: null, note: null, ...data })),
    persist: jest.fn((row: Row) => { byEntity.get(CpqQuoteLineCost)!.push(row) }),
    flush: jest.fn(async () => undefined),
  }
  return { em, costs: byEntity.get(CpqQuoteLineCost)! }
}

const charge = (over: Row = {}) => ({ id: 'charge-1', ...SCOPE, deletedAt: null, isActive: true, offeringId: OFFERING, code: 'mrc', sortOrder: 0,
  quantityAttributeCode: 'qty', applicabilityCondition: null, ...over })
const element = (over: Row = {}) => ({ id: 'el-1', ...SCOPE, deletedAt: null, isActive: true, productChargeId: 'charge-1', code: 'tail', name: 'Tail',
  role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat', amount: '100', currencyCode: 'USD', costTableId: null,
  costColumnKey: null, estimateAmount: null, applicabilityCondition: null, sortOrder: 0, ...over })
const lineConfig = (over: Row = {}) => ({ quoteLineId: LINE_ID, offeringId: OFFERING, productId: null, configuration: {}, ...over }) as never
const quote = (over: Row = {}) => ({ id: QUOTE_ID, quoteId: 'sales-quote', cpqStatus: 'new', quoteType: 'new_sale', currencyCode: 'USD', ...over }) as never
const catalogCost = (over: Row = {}) => ({ id: 'c-1', ...SCOPE, deletedAt: null, quoteConfigurationId: QUOTE_ID, quoteLineId: LINE_ID, costKey: 'tail',
  origin: 'catalog', valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '100', instanceAmount: '100', currencyCode: 'USD',
  note: null, driverHash: null, errorCode: null, ...over })

const run = (s: ReturnType<typeof store>, opts: { enabled?: boolean; config?: Row; quoteOver?: Row; lines?: Array<{ lineConfig: never; mergedConfig: Row }> } = {}) =>
  resolveQuoteCosts({
    em: s.em as never, quote: quote(opts.quoteOver), scope: SCOPE,
    isEnabled: async () => opts.enabled ?? true,
    lines: opts.lines ?? [{ lineConfig: lineConfig(), mergedConfig: opts.config ?? {} }],
  })

describe('resolveQuoteCosts', () => {
  it('toggle off is a no-op: no reads beyond the toggle check (R14)', async () => {
    const s = store({ charges: [charge()], elements: [element()] })
    expect(await run(s, { enabled: false })).toMatchObject({ skipped: 'disabled' })
    expect(s.em.find).not.toHaveBeenCalled()
    expect(s.em.count).not.toHaveBeenCalled()
    expect(s.em.persist).not.toHaveBeenCalled()
  })

  it('instantiates one catalog cost line per element and is idempotent (R1a, I-1)', async () => {
    const s = store({ charges: [charge()], elements: [element(), element({ id: 'el-2', code: 'tail', name: 'Duplicate key' })] })
    await run(s)
    expect(s.costs).toHaveLength(1)
    expect(s.costs[0]).toMatchObject({ costKey: 'tail', origin: 'catalog', chargeCode: 'mrc', costElementId: 'el-1', valueStatus: 'confirmed',
      valueOrigin: 'catalog', unitAmount: '100', instanceAmount: '100', currencyCode: 'USD', sourcingStatus: 'not_requested', quoteId: 'sales-quote' })
    await run(s)
    await run(s)
    expect(s.costs).toHaveLength(1)
    expect(s.em.create).toHaveBeenCalledTimes(1)
  })

  it('drops catalog lines whose element is deactivated on unlocked quotes, keeps manual lines (R1a)', async () => {
    const manual = catalogCost({ id: 'c-2', costKey: 'extra', origin: 'manual', valueOrigin: 'manual' })
    const s = store({ charges: [charge()], elements: [element({ isActive: false })], costs: [catalogCost(), manual] })
    const stats = await run(s)
    expect(stats.dropped).toBe(1)
    expect(s.costs[0].deletedAt).toBeInstanceOf(Date)
    expect(s.costs[1].deletedAt).toBeNull()
  })

  it('keeps stored lines and values on locked quotes (R4)', async () => {
    const stored = catalogCost({ unitAmount: '77' })
    const s = store({ charges: [charge()], elements: [element({ isActive: false })], costs: [stored] })
    expect(await run(s, { quoteOver: { cpqStatus: 'with_customer' } })).toMatchObject({ skipped: 'locked' })
    expect(stored.deletedAt).toBeNull()
    expect(stored.unitAmount).toBe('77')
    expect(s.em.persist).not.toHaveBeenCalled()
  })

  it('treats a quote with an order as locked even in a mutable status', async () => {
    const s = store({ orders: [{ ...SCOPE, sourceQuoteId: QUOTE_ID, deletedAt: null }] })
    expect(await isQuoteCostLocked(s.em as never, { id: QUOTE_ID, cpqStatus: 'ready' }, SCOPE)).toBe(true)
    expect(await isQuoteCostLocked(store({}).em as never, { id: QUOTE_ID, cpqStatus: 'ready' }, SCOPE)).toBe(false)
  })

  it('skips frozen Amend mirror lines and cancelled mirror lines (R1c)', async () => {
    const mirror = lineConfig({ configuration: { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true } })
    const s = store({ charges: [charge()], elements: [element()] })
    await run(s, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: mirror, mergedConfig: {} }] })
    expect(s.costs).toHaveLength(0)
    // a reconfigured (unfrozen) mirror is instantiated
    const reconfigured = lineConfig({ configuration: { _arcMirroredFromItemId: 'item-1' } })
    await run(s, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: reconfigured, mergedConfig: {} }] })
    expect(s.costs).toHaveLength(1)
    const cancelled = lineConfig({ action: 'cancel' })
    const s2 = store({ charges: [charge()], elements: [element()] })
    await run(s2, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: cancelled, mergedConfig: {} }] })
    expect(s2.costs).toHaveLength(0)
  })

  it('computes per_unit instance amount from the charge quantity attribute', async () => {
    const s = store({ charges: [charge()], elements: [element({ costModel: 'per_unit', amount: '2.5' })] })
    await run(s, { config: { qty: 4 } })
    expect(s.costs[0]).toMatchObject({ unitAmount: '2.5', instanceAmount: '10' })
  })

  it('a manual per_unit cost keeps its unit amount but its instance amount follows the quantity', async () => {
    const manual = catalogCost({ id: 'c-m', costKey: 'manual:abcd1234', origin: 'manual', valueOrigin: 'manual', chargeCode: 'mrc',
      costModel: 'per_unit', unitAmount: '10', instanceAmount: '30', valueStatus: 'confirmed', note: 'carrier fee' })
    const s = store({ charges: [charge()], costs: [manual] })
    await run(s, { config: { qty: 5 } })
    expect(s.costs[0]).toMatchObject({ unitAmount: '10', instanceAmount: '50', valueStatus: 'confirmed', valueOrigin: 'manual', note: 'carrier fee' })
    // a manual flat cost is left alone
    const flat = catalogCost({ id: 'c-f', costKey: 'manual:ffff0000', origin: 'manual', valueOrigin: 'manual', chargeCode: 'mrc', costModel: 'flat', unitAmount: '10', instanceAmount: '10' })
    const s2 = store({ charges: [charge()], costs: [flat] })
    expect(await run(s2, { config: { qty: 5 } })).toMatchObject({ updated: 0 })
  })

  it('applies charge and element applicability conditions', async () => {
    const s = store({
      charges: [charge(), charge({ id: 'charge-2', code: 'nrc', applicabilityCondition: { attribute: 'tier', operator: 'eq', value: 'gold' } })],
      elements: [
        element({ applicabilityCondition: { attribute: 'speed', operator: 'eq', value: '10G' } }),
        element({ id: 'el-2', productChargeId: 'charge-2', code: 'gold_fee' }),
      ],
    })
    await run(s, { config: { speed: '1G', tier: 'gold' } })
    expect(s.costs.map((c) => c.costKey)).toEqual(['gold_fee'])
    await run(s, { config: { speed: '10G', tier: 'silver' } })
    expect(s.costs.filter((c) => c.deletedAt === null).map((c) => c.costKey)).toEqual(['tail'])
  })

  it('resolves table costs through the cost table and column', async () => {
    const tables = [{ id: 'tbl', ...SCOPE, deletedAt: null, purpose: 'cost', dimensions: [{ key: 'speed' }] }]
    const entries = [
      { ...SCOPE, deletedAt: null, isActive: true, pricingTableId: 'tbl', dimensionValues: { speed: '10G' }, prices: { cost: 40 }, currencyCode: 'USD' },
      { ...SCOPE, deletedAt: null, isActive: true, pricingTableId: 'tbl', dimensionValues: { speed: '100G' }, prices: { cost: 90 }, currencyCode: 'EUR' },
    ]
    const el = element({ source: 'table', amount: null, currencyCode: null, costTableId: 'tbl', costColumnKey: 'cost', costModel: 'per_unit' })
    const s = store({ charges: [charge()], elements: [el], tables, entries })
    await run(s, { config: { speed: '10G', qty: 3 } })
    expect(s.costs[0]).toMatchObject({ valueStatus: 'confirmed', unitAmount: '40', instanceAmount: '120', errorCode: null })

    const none = store({ charges: [charge()], elements: [el], tables, entries })
    await run(none, { config: { speed: '1G', qty: 3 } })
    expect(none.costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: null, errorCode: 'TABLE_NO_MATCH' })

    const foreign = store({ charges: [charge()], elements: [el], tables, entries })
    await run(foreign, { config: { speed: '100G', qty: 3 } })
    expect(foreign.costs[0]).toMatchObject({ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE' })

    const gone = store({ charges: [charge()], elements: [el] })
    await run(gone)
    expect(gone.costs[0]).toMatchObject({ valueStatus: 'none', errorCode: 'TABLE_NO_MATCH' })
  })

  it('flags a fixed cost in another currency as CURRENCY_NO_RATE (no 1:1 conversion)', async () => {
    const s = store({ charges: [charge()], elements: [element({ currencyCode: 'EUR' })] })
    await run(s)
    expect(s.costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: null, errorCode: 'CURRENCY_NO_RATE' })
  })

  it('resolves on_request costs to estimated with an estimate, else none', async () => {
    const withEstimate = store({ charges: [charge()], elements: [element({ source: 'on_request', amount: null, estimateAmount: '55' })] })
    await run(withEstimate)
    expect(withEstimate.costs[0]).toMatchObject({ valueStatus: 'estimated', valueOrigin: 'catalog', unitAmount: '55', instanceAmount: '55' })
    const without = store({ charges: [charge()], elements: [element({ source: 'on_request', amount: null })] })
    await run(without)
    expect(without.costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: null, errorCode: null })
  })

  describe('R1b value reset', () => {
    const el = element({ source: 'on_request', amount: null, estimateAmount: '55',
      applicabilityCondition: { attribute: 'speed', operator: 'neq', value: 'never' } })
    const seed = async () => {
      const s = store({ charges: [charge()], elements: [el] })
      await run(s, { config: { speed: '1G' } })
      return s
    }

    it('keeps an entered value while the driving attribute is unchanged', async () => {
      const s = await seed()
      Object.assign(s.costs[0], { valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '80', instanceAmount: '80' })
      await run(s, { config: { speed: '1G' } })
      expect(s.costs[0]).toMatchObject({ valueOrigin: 'manual', unitAmount: '80', note: null })
    })

    it('resets to the estimate and moves the previous value into the note when it changes', async () => {
      const s = await seed()
      Object.assign(s.costs[0], { valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '80', instanceAmount: '80' })
      await run(s, { config: { speed: '10G' } })
      expect(s.costs[0]).toMatchObject({ valueStatus: 'estimated', valueOrigin: 'catalog', unitAmount: '55' })
      expect(String(s.costs[0].note)).toContain('speed')
      expect(String(s.costs[0].note)).toContain('80 USD')
    })

    it('resets to none without an estimate', async () => {
      const noEstimate = element({ ...el, estimateAmount: null })
      const s = store({ charges: [charge()], elements: [noEstimate] })
      await run(s, { config: { speed: '1G' } })
      Object.assign(s.costs[0], { valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '80', currencyCode: 'USD' })
      await run(s, { config: { speed: '2G' } })
      expect(s.costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: null })
      expect(String(s.costs[0].note)).toContain('80 USD')
    })
  })
})

describe('recalculateInternal wiring', () => {
  function service(enabled: jest.Mock) {
    const em: Record<string, jest.Mock> = {
      find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [lineConfig({ id: 'lc', quantity: 1, usageEstimates: null, charges: [] })] : [])),
      findOne: jest.fn(async (entity: unknown) => (entity === CpqProductOffering ? null : {})),
      count: jest.fn().mockResolvedValue(0),
      assign: jest.fn((entity: Row, updates: Row) => Object.assign(entity, updates)),
      persist: jest.fn(),
      create: jest.fn((_e: unknown, data: Row) => data),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const quotingService = new DefaultCpqQuotingService({
      em: em as never,
      cpqPricingService: { resolveProductCharges: jest.fn().mockResolvedValue([]) } as never,
      cpqValidationService: { validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }), validateRelationships: jest.fn().mockResolvedValue([]) } as never,
      cpqProductService: {} as never,
      salesDocumentNumberGenerator: {} as never,
      cpqCostService: { enabled },
    })
    return { em, quotingService }
  }
  const cfg = () => ({ id: QUOTE_ID, quoteId: 'sales-quote', cpqStatus: 'new', quoteType: 'new_sale', currencyCode: 'USD', quoteContext: {} }) as unknown as CpqQuoteConfiguration

  it('invokes it when saving', async () => {
    const enabled = jest.fn().mockResolvedValue(false)
    const { em, quotingService } = service(enabled)
    await quotingService.recalculateLockedQuote(em as never, cfg(), SCOPE, true)
    expect(enabled).toHaveBeenCalledWith(SCOPE.tenantId)
  })

  it('resolves cost inputs for a preview too, but persists nothing', async () => {
    const enabled = jest.fn().mockResolvedValue(true)
    const { em, quotingService } = service(enabled)
    await quotingService.recalculateLockedQuote(em as never, cfg(), SCOPE, false)
    expect(enabled).toHaveBeenCalledWith(SCOPE.tenantId)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('resolveCostPlusInputs', () => {
  const inputs = (s: ReturnType<typeof store>, save: boolean, opts: { enabled?: boolean; quoteOver?: Row } = {}) =>
    resolveCostPlusInputs({
      em: s.em as never, quote: quote(opts.quoteOver), scope: SCOPE, save,
      isEnabled: async () => opts.enabled ?? true,
      lines: [{ lineConfig: lineConfig(), mergedConfig: {} }],
    })

  it('toggle off reads nothing and reports disabled (R14)', async () => {
    const s = store({ charges: [charge()], elements: [element()] })
    expect(await inputs(s, true, { enabled: false })).toMatchObject({ enabled: false })
    expect(s.em.find).not.toHaveBeenCalled()
  })

  it('a preview returns the values a save would persist and writes nothing', async () => {
    const preview = store({ charges: [charge()], elements: [element()] })
    const previewResult = await inputs(preview, false)
    expect(preview.costs).toHaveLength(0)
    expect(preview.em.persist).not.toHaveBeenCalled()
    const saved = store({ charges: [charge()], elements: [element()] })
    const savedResult = await inputs(saved, true)
    expect(saved.costs).toHaveLength(1)
    expect(previewResult.costsByLine).toEqual(savedResult.costsByLine)
    expect(previewResult.costsByLine.get(LINE_ID)).toEqual([expect.objectContaining({ costKey: 'tail', chargeCode: 'mrc', role: 'price_basis', valueStatus: 'confirmed', instanceAmount: '100' })])
  })

  it('a preview does not mutate stored rows when the catalog value moved', async () => {
    const s = store({ charges: [charge()], elements: [element({ amount: '150' })], costs: [catalogCost()] })
    const result = await inputs(s, false)
    expect(s.costs[0]).toMatchObject({ instanceAmount: '100' })
    expect(result.costsByLine.get(LINE_ID)).toEqual([expect.objectContaining({ instanceAmount: '150' })])
  })

  it('a locked quote reads the stored lines (values frozen, R4)', async () => {
    const s = store({ charges: [charge()], elements: [element({ amount: '150' })], costs: [catalogCost({ instanceAmount: '100' })] })
    const result = await inputs(s, true, { quoteOver: { cpqStatus: 'with_customer' } })
    expect(result.costsByLine.get(LINE_ID)).toEqual([expect.objectContaining({ instanceAmount: '100' })])
    expect(s.costs[0]).toMatchObject({ instanceAmount: '100' })
  })

  it('a converted quote keeps its prices frozen: a ready quote with an order reads stored lines, never the moved catalog', async () => {
    const s = store({
      charges: [charge()], elements: [element({ amount: '150' })], costs: [catalogCost({ instanceAmount: '100' })],
      orders: [{ ...SCOPE, sourceQuoteId: QUOTE_ID, deletedAt: null }],
    })
    const saved = await inputs(s, true, { quoteOver: { cpqStatus: 'ready' } })
    expect(saved.costsByLine.get(LINE_ID)).toEqual([expect.objectContaining({ instanceAmount: '100' })])
    expect(await run(s, { quoteOver: { cpqStatus: 'ready' } })).toMatchObject({ skipped: 'locked' })
    expect(s.costs[0]).toMatchObject({ instanceAmount: '100' })
    expect(s.em.persist).not.toHaveBeenCalled()
  })
})
