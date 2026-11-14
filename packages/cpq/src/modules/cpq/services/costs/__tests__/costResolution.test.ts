import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqPricingTable, CpqPricingTableEntry, CpqProductCharge,
  CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqPriceRule, CpqProductOffering,
} from '../../../data/entities'
import { DefaultCpqQuotingService } from '../../cpqQuotingService'
import { isQuoteCostLocked, resolveCostPlusInputs, resolveQuoteCosts } from '../costResolution'
import type { SourcingSignal } from '../sourcingSignals'

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

const run = (s: ReturnType<typeof store>, opts: { enabled?: boolean; config?: Row; quoteOver?: Row; lines?: Array<{ lineConfig: never; mergedConfig: Row }>; actorUserId?: string | null; signals?: SourcingSignal[]; autoOpen?: boolean } = {}) =>
  resolveQuoteCosts({
    em: s.em as never, quote: quote(opts.quoteOver), scope: SCOPE,
    isEnabled: async () => opts.enabled ?? true, actorUserId: opts.actorUserId, signals: opts.signals, autoOpen: opts.autoOpen,
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
    // a reconfigured mirror (`_arcReconfigured`, Q13) is instantiated
    const reconfigured = lineConfig({ configuration: { _arcMirroredFromItemId: 'item-1', _arcReconfigured: true } })
    await run(s, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: reconfigured, mergedConfig: {} }] })
    expect(s.costs).toHaveLength(1)
    const cancelled = lineConfig({ action: 'cancel' })
    const s2 = store({ charges: [charge()], elements: [element()] })
    await run(s2, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: cancelled, mergedConfig: {} }] })
    expect(s2.costs).toHaveLength(0)
  })

  it.each(['amend', 'renew'])('drops every cost line (catalog and manual) of an item removed on %s', async (quoteType) => {
    const manual = catalogCost({ id: 'c-2', costKey: 'manual:abcd1234', origin: 'manual', valueOrigin: 'manual' })
    const s = store({ charges: [charge()], elements: [element()], costs: [catalogCost({ valueStatus: 'estimated' }), manual] })
    const removed = lineConfig({ action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } })
    const stats = await run(s, { quoteOver: { quoteType }, lines: [{ lineConfig: removed, mergedConfig: {} }] })
    expect(stats).toMatchObject({ dropped: 2, created: 0 })
    expect(s.costs.map((row) => row.deletedAt)).toEqual([expect.any(Date), expect.any(Date)])
    // ...while a kept mirror line of the same Renew quote is instantiated from the catalog
    const kept = lineConfig({ quoteLineId: 'line-2', configuration: { _arcMirroredFromItemId: 'item-2', _arcReconfigured: true } })
    const s2 = store({ charges: [charge()], elements: [element()] })
    await run(s2, { quoteOver: { quoteType: 'renew' }, lines: [{ lineConfig: removed, mergedConfig: {} }, { lineConfig: kept, mergedConfig: {} }] })
    expect(s2.costs).toEqual([expect.objectContaining({ quoteLineId: 'line-2', costKey: 'tail' })])
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

  it('a matching cost-table row without the element\'s cost column is TABLE_NO_MATCH, never a confirmed 0 (R5)', async () => {
    const tables = [{ id: 'tbl', ...SCOPE, deletedAt: null, purpose: 'cost', dimensions: [{ key: 'dc' }] }]
    const entries = [
      { ...SCOPE, deletedAt: null, isActive: true, pricingTableId: 'tbl', dimensionValues: { dc: 'am1' }, prices: { nrc_cost: 500 }, currencyCode: 'USD' },
      { ...SCOPE, deletedAt: null, isActive: true, pricingTableId: 'tbl', dimensionValues: { dc: 'fr2' }, prices: { mrc_cost: 70 }, currencyCode: 'EUR' },
    ]
    const el = element({ source: 'table', amount: null, currencyCode: null, costTableId: 'tbl', costColumnKey: 'mrc_cost' })
    const s = store({ charges: [charge()], elements: [el], tables, entries })
    await run(s, { config: { dc: 'am1' } })
    expect(s.costs[0]).toMatchObject({ valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, errorCode: 'TABLE_NO_MATCH' })
    // a row priced only in another currency still reports CURRENCY_NO_RATE
    const foreign = store({ charges: [charge()], elements: [el], tables, entries })
    await run(foreign, { config: { dc: 'fr2' } })
    expect(foreign.costs[0]).toMatchObject({ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE' })
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

describe('mirror-line cost lines (Q13: reconfigured mirrors only; was feature 1 characterization)', () => {
  const mirrorCfg = (extra: Row = {}) => lineConfig({ configuration: { _arcMirroredFromItemId: 'item-1', ...extra } })
  const resolve = async (quoteType: string, lineConfigs: never[]) => {
    const s = store({ charges: [charge()], elements: [element()] })
    await run(s, { quoteOver: { quoteType }, lines: lineConfigs.map((cfg) => ({ lineConfig: cfg, mergedConfig: {} })) })
    return s.costs
  }

  it('a frozen Amend mirror gets no catalog cost line', async () => {
    expect(await resolve('amend', [mirrorCfg({ _arcPriceFrozen: true })])).toHaveLength(0)
  })

  it('a frozen cost-plus Renew mirror gets no catalog cost line', async () => {
    expect(await resolve('renew', [mirrorCfg({ _arcPriceFrozen: true, _arcCostPlusFrozen: true })])).toHaveLength(0)
  })

  it('an Amend / Renew removal (cancel) line gets no catalog cost line', async () => {
    for (const quoteType of ['amend', 'renew']) {
      const cancelLine = lineConfig({ action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } })
      expect(await resolve(quoteType, [cancelLine])).toHaveLength(0)
    }
  })

  // CHANGED from feature 1 (was: "NOT skipped ... gets 1 cost line"): an unreconfigured mirror never gets catalog cost lines.
  it('a Cancel-quote line (an unreconfigured mirror) gets no catalog cost line', async () => {
    const cancelLine = lineConfig({ action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } })
    expect(await resolve('cancel', [cancelLine])).toHaveLength(0)
  })

  // CHANGED from feature 1 (was: a non-frozen Renew mirror gets catalog cost lines).
  it('an unreconfigured Renew mirror re-priced at the current standard gets no catalog cost lines (R1c)', async () => {
    expect(await resolve('renew', [mirrorCfg()])).toHaveLength(0)
  })

  // CHANGED from feature 1 (was: any unfrozen Amend mirror): the line must carry `_arcReconfigured`.
  it('an unfrozen Amend mirror without the reconfigured marker gets none, a reconfigured one gets catalog cost lines', async () => {
    expect(await resolve('amend', [mirrorCfg()])).toHaveLength(0)
    expect(await resolve('amend', [mirrorCfg({ _arcReconfigured: true })])).toEqual([expect.objectContaining({ costKey: 'tail', origin: 'catalog' })])
  })

  it('a reconfigured Renew mirror (also un-frozen from a cost-plus freeze) gets catalog cost lines', async () => {
    expect(await resolve('renew', [mirrorCfg({ _arcReconfigured: true })])).toEqual([expect.objectContaining({ costKey: 'tail', origin: 'catalog' })])
  })

  // CHANGED from feature 1 (was: a freeze marker on a Renew mirror does not exempt it): moot, the marker no longer matters.
  it('a stray freeze marker on a Renew mirror does not instantiate costs', async () => {
    expect(await resolve('renew', [mirrorCfg({ _arcPriceFrozen: true })])).toHaveLength(0)
  })

  it('a reconfigured mirror is not a cancel line: cost lines of a cancelled one are still dropped', async () => {
    const cancelled = lineConfig({ action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1', _arcReconfigured: true } })
    expect(await resolve('renew', [cancelled])).toHaveLength(0)
  })

  it('drops catalog cost rows stored on an unreconfigured mirror before Q13 (they could never be confirmed)', async () => {
    const s = store({ charges: [charge()], elements: [element()], costs: [catalogCost({ valueStatus: 'estimated' })] })
    const stats = await run(s, { quoteOver: { quoteType: 'renew' }, lines: [{ lineConfig: mirrorCfg(), mergedConfig: {} }] })
    expect(stats).toMatchObject({ dropped: 1, created: 0 })
    expect(s.costs[0].deletedAt).toEqual(expect.any(Date))
  })

  it('cost-plus inputs of a reconfigured mirror carry its catalog cost lines (priced from cost); an unreconfigured one carries none', async () => {
    const inputs = async (cfg: Row) => {
      const s = store({ charges: [charge()], elements: [element()] })
      const out = await resolveCostPlusInputs({
        em: s.em as never, quote: quote({ quoteType: 'renew' }), scope: SCOPE,
        lines: [{ lineConfig: mirrorCfg(cfg), mergedConfig: {} }], isEnabled: async () => true, save: true,
      })
      return out.costsByLine.get(LINE_ID) ?? []
    }
    expect(await inputs({ _arcReconfigured: true })).toHaveLength(1)
    expect(await inputs({})).toHaveLength(0)
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

// Supplier sourcing step 6 (feature spec Q12, R1a / R1b): the resolver now owns the request side of a SAVED recalculation.
// MODIFIED from the step-1 characterization (which pinned "the resolver never touches the sourcing columns"):
//  - R1b reset: the open request is cancelled `reconfigured` in the same write (and a fresh one opens for requires_sourcing);
//  - R1a drop: the dropped line's open request is cancelled (`element_deactivated` / `reconfigured`);
//  - ARC removal: every dropped line's open request is cancelled `line_removed`;
//  - a new catalog line opens its request when the element requires sourcing (unchanged: otherwise it starts not_requested);
//  - a driver-unchanged re-resolve leaves an open request alone (unchanged).
describe('cost requests on saved recalculations (Q12, R1a, R1b)', () => {
  const SOURCING = { sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 3, requestedAt: new Date('2026-01-01'), requestedByUserId: 'u1',
    answeredAt: null, answeredByUserId: null, declineReason: null, proposedAmount: '70.0000', supplierId: 'sup-1', supplierName: 'Acme',
    supplierQuoteRef: 'Q-1', validUntil: '2999-01-01', supplierTermEnd: null, supplierMinTermMonths: null }
  const ACTOR = '44444444-4444-4444-8444-444444444444'
  const driven = (over: Row = {}) => element({ source: 'on_request', amount: null, estimateAmount: '55', applicabilityCondition: { attribute: 'speed', operator: 'neq', value: 'never' }, ...over })
  const cancelledEntry = (reason: string) => ({
    costRequestId: 'req-1', requestSeq: 3, requestedAt: '2026-01-01T00:00:00.000Z', requestedByUserId: 'u1',
    closedAt: expect.any(String), closedByUserId: ACTOR, outcome: 'cancelled', reason,
  })
  const seeded = async (over: Row = {}) => {
    const s = store({ charges: [charge()], elements: [driven(over)] })
    await run(s, { config: { speed: '1G' } })
    Object.assign(s.costs[0], { valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '80', instanceAmount: '80', note: 'carrier call', ...SOURCING })
    return s
  }

  describe('R1b reset', () => {
    it('cancels the open request (reconfigured) in the same write and keeps the previous value in the note', async () => {
      const s = await seeded()
      const signals: SourcingSignal[] = []
      await run(s, { config: { speed: '10G' }, actorUserId: ACTOR, signals })
      expect(s.costs[0]).toMatchObject({
        valueStatus: 'estimated', valueOrigin: 'catalog', unitAmount: '55', sourcingStatus: 'cancelled', cancelReason: 'reconfigured',
        costRequestId: 'req-1', requestSeq: 3, proposedAmount: null, proposedAnswer: null, lastAnswerHash: null,
      })
      expect(String(s.costs[0].note)).toContain('80 USD')
      expect(String(s.costs[0].note)).toContain('carrier call')
      expect(s.costs[0].requestHistory).toEqual([cancelledEntry('reconfigured')])
      expect(signals).toEqual([expect.objectContaining({ kind: 'request_cancelled', reason: 'reconfigured', costRequestId: 'req-1', requestSeq: 3, costLineId: s.costs[0].id })])
    })

    it('opens a fresh request for a requires_sourcing element (seq + 1, requester = the actor, supplier from the element default)', async () => {
      const s = await seeded({ requiresSourcing: true, defaultSupplierId: 'sup-9', defaultSupplierName: 'Default Carrier' })
      const signals: SourcingSignal[] = []
      await run(s, { config: { speed: '10G' }, actorUserId: ACTOR, signals })
      expect(s.costs[0]).toMatchObject({
        sourcingStatus: 'requested', requestSeq: 4, requestedByUserId: ACTOR, requestSupplierId: 'sup-9', requestSupplierName: 'Default Carrier',
        valueStatus: 'estimated', cancelReason: null, answeredAt: null,
      })
      expect(s.costs[0].costRequestId).not.toBe('req-1')
      expect(s.costs[0].requestedAt).toBeInstanceOf(Date)
      expect(s.costs[0].requestHistory).toEqual([{ ...cancelledEntry('reconfigured'), supplierId: 'sup-9' }])
      expect(signals.map((signal) => signal.kind)).toEqual(['request_cancelled', 'requested'])
      expect(signals[1]).toMatchObject({ kind: 'requested', requestSeq: 4, auto: true, supplierId: 'sup-9', requestedByUserId: ACTOR, costRequestId: s.costs[0].costRequestId })
    })

    it('a reset of an answered request opens a fresh one for a requires_sourcing element without cancelling anything', async () => {
      const s = await seeded({ requiresSourcing: true })
      Object.assign(s.costs[0], { sourcingStatus: 'answered', answeredAt: new Date(), requestHistory: [] })
      const signals: SourcingSignal[] = []
      await run(s, { config: { speed: '10G' }, actorUserId: ACTOR, signals })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 4, proposedAmount: null })
      expect(signals.map((signal) => signal.kind)).toEqual(['requested'])
    })

    it('leaves the sourcing columns alone while the driving attribute is unchanged', async () => {
      const s = await seeded({ requiresSourcing: true })
      const signals: SourcingSignal[] = []
      await run(s, { config: { speed: '1G' }, signals })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 3, proposedAmount: '70.0000' })
      expect(signals).toEqual([])
    })

    it('records the cancellation of a request on a non-sourcing element but opens none', async () => {
      const s = await seeded({ requiresSourcing: false })
      await run(s, { config: { speed: '10G' }, actorUserId: ACTOR })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'reconfigured' })
    })
  })

  describe('R1a drop', () => {
    it('cancels the request of a line whose element was deactivated (element_deactivated) and soft-deletes it', async () => {
      const s = store({ charges: [charge()], elements: [element({ isActive: false })], costs: [catalogCost({ costElementId: 'el-1', ...SOURCING })] })
      const signals: SourcingSignal[] = []
      const stats = await run(s, { actorUserId: ACTOR, signals })
      expect(stats.dropped).toBe(1)
      expect(s.costs[0].deletedAt).toBeInstanceOf(Date)
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'element_deactivated', proposedAmount: null })
      expect(s.costs[0].requestHistory).toEqual([cancelledEntry('element_deactivated')])
      expect(signals).toEqual([expect.objectContaining({ kind: 'request_cancelled', reason: 'element_deactivated' })])
    })

    it('an element that is still active but no longer applies is reconfigured', async () => {
      const el = element({ source: 'on_request', amount: null, applicabilityCondition: { attribute: 'speed', operator: 'eq', value: '1G' } })
      const s = store({ charges: [charge()], elements: [el], costs: [catalogCost(SOURCING)] })
      await run(s, { config: { speed: '10G' }, actorUserId: ACTOR })
      expect(s.costs[0].deletedAt).toBeInstanceOf(Date)
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'reconfigured' })
    })

    it('a closed request is not cancelled again; the line is just dropped', async () => {
      const s = store({ charges: [charge()], elements: [element({ isActive: false })], costs: [catalogCost({ ...SOURCING, sourcingStatus: 'answered' })] })
      const signals: SourcingSignal[] = []
      await run(s, { signals })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'answered', deletedAt: expect.any(Date) })
      expect(signals).toEqual([])
    })
  })

  it('an ARC removal drops every cost line and cancels their open requests (line_removed)', async () => {
    const manual = catalogCost({ id: 'c-2', costKey: 'manual:abcd1234', origin: 'manual', valueOrigin: 'manual', ...SOURCING })
    const s = store({ charges: [charge()], elements: [element()], costs: [catalogCost(SOURCING), manual] })
    const removed = lineConfig({ action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } })
    const signals: SourcingSignal[] = []
    await run(s, { quoteOver: { quoteType: 'renew' }, lines: [{ lineConfig: removed, mergedConfig: {} }], actorUserId: ACTOR, signals })
    for (const row of s.costs) expect(row).toMatchObject({ deletedAt: expect.any(Date), sourcingStatus: 'cancelled', cancelReason: 'line_removed' })
    expect(signals.map((signal) => signal.kind)).toEqual(['request_cancelled', 'request_cancelled'])
  })

  describe('auto-open (Q12)', () => {
    const tail = (over: Row = {}) => element({ source: 'on_request', amount: null, estimateAmount: '300', requiresSourcing: true, defaultSupplierId: 'sup-9', ...over })

    it('opens a request for a new on_request cost of a requires_sourcing element (seq 1, requester = the actor)', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      const signals: SourcingSignal[] = []
      await run(s, { actorUserId: ACTOR, signals })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 1, requestedByUserId: ACTOR, requestSupplierId: 'sup-9', valueStatus: 'estimated' })
      expect(s.costs[0].costRequestId).toEqual(expect.any(String))
      expect(signals).toEqual([expect.objectContaining({
        kind: 'requested', auto: true, requestSeq: 1, costLineId: s.costs[0].id, costRequestId: s.costs[0].costRequestId, supplierId: 'sup-9', costKey: 'tail',
      })])
    })

    it('autoOpen: false (a clone\'s first recalculation) resolves the cost but opens no request (spec "Clone", R16)', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      const signals: SourcingSignal[] = []
      await run(s, { actorUserId: ACTOR, signals, autoOpen: false })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'not_requested', valueStatus: 'estimated' })
      expect(s.costs[0].costRequestId ?? null).toBeNull()
      expect(signals).toEqual([])
    })

    it('an actor-less recalculation opens it with no requester (no notification recipient, Q5)', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      await run(s)
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', requestedByUserId: null })
    })

    it('opens nothing for elements that do not require sourcing, nor for fixed / table costs', async () => {
      const s = store({ charges: [charge()], elements: [tail({ requiresSourcing: false }), element({ id: 'el-2', code: 'fixed', requiresSourcing: true })] })
      const signals: SourcingSignal[] = []
      await run(s, { signals })
      expect(s.costs.map((row) => row.sourcingStatus)).toEqual(['not_requested', 'not_requested'])
      expect(signals).toEqual([])
    })

    it('opens a request for an existing never-requested on_request cost line, once (repeated saves never duplicate)', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      await run(s)
      Object.assign(s.costs[0], { sourcingStatus: 'not_requested', costRequestId: null, requestSeq: null, requestedAt: null })
      await run(s, { actorUserId: ACTOR })
      const id = s.costs[0].costRequestId
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 1 })
      await run(s, { actorUserId: ACTOR })
      expect(s.costs[0]).toMatchObject({ costRequestId: id, requestSeq: 1 })
    })

    it('never re-opens a request that was cancelled, declined or answered', async () => {
      for (const status of ['cancelled', 'declined', 'answered']) {
        const s = store({ charges: [charge()], elements: [tail()] })
        await run(s)
        Object.assign(s.costs[0], { sourcingStatus: status })
        await run(s, { actorUserId: ACTOR })
        expect(s.costs[0].sourcingStatus).toBe(status)
      }
    })

    it('does not open for a confirmed value', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      await run(s)
      Object.assign(s.costs[0], { sourcingStatus: 'not_requested', costRequestId: null, valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '280', instanceAmount: '280' })
      await run(s)
      expect(s.costs[0].sourcingStatus).toBe('not_requested')
    })

    it('never opens with the toggle off, on a locked quote or on an unreconfigured mirror', async () => {
      const off = store({ charges: [charge()], elements: [tail()] })
      await run(off, { enabled: false })
      expect(off.costs).toHaveLength(0)
      const locked = store({ charges: [charge()], elements: [tail()], costs: [catalogCost({ valueStatus: 'estimated', sourcingStatus: 'not_requested', valueOrigin: 'catalog' })] })
      await run(locked, { quoteOver: { cpqStatus: 'with_customer' } })
      expect(locked.costs[0].sourcingStatus).toBe('not_requested')
      const mirror = store({ charges: [charge()], elements: [tail()] })
      await run(mirror, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: lineConfig({ configuration: { _arcMirroredFromItemId: 'item-1' } }), mergedConfig: {} }] })
      expect(mirror.costs).toHaveLength(0)
    })

    it('opens for a reconfigured mirror line (it is priced by the quote)', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      await run(s, { quoteOver: { quoteType: 'amend' }, lines: [{ lineConfig: lineConfig({ configuration: { _arcMirroredFromItemId: 'item-1', _arcReconfigured: true } }), mergedConfig: {} }], actorUserId: ACTOR })
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 1 })
    })

    it('a preview opens and cancels nothing and collects no signal', async () => {
      const s = store({ charges: [charge()], elements: [tail()], costs: [catalogCost({ ...SOURCING, valueStatus: 'estimated', valueOrigin: 'manual', unitAmount: '80',
        driverHash: 'stale' })] })
      const signals: SourcingSignal[] = []
      const inputs = await resolveCostPlusInputs({
        em: s.em as never, quote: quote(), scope: SCOPE, isEnabled: async () => true, save: false, signals, actorUserId: ACTOR,
        lines: [{ lineConfig: lineConfig(), mergedConfig: {} }],
      })
      expect(inputs.enabled).toBe(true)
      expect(signals).toEqual([])
      expect(s.costs[0]).toMatchObject({ sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 3 })
      expect(s.em.persist).not.toHaveBeenCalled()
      const fresh = store({ charges: [charge()], elements: [tail()] })
      await resolveCostPlusInputs({ em: fresh.em as never, quote: quote(), scope: SCOPE, isEnabled: async () => true, save: false, lines: [{ lineConfig: lineConfig(), mergedConfig: {} }] })
      expect(fresh.costs).toHaveLength(0)
    })

    it('a saved recalculation through resolveCostPlusInputs collects the signals', async () => {
      const s = store({ charges: [charge()], elements: [tail()] })
      const signals: SourcingSignal[] = []
      await resolveCostPlusInputs({
        em: s.em as never, quote: quote(), scope: SCOPE, isEnabled: async () => true, save: true, signals, actorUserId: ACTOR,
        lines: [{ lineConfig: lineConfig(), mergedConfig: {} }],
      })
      expect(signals).toEqual([expect.objectContaining({ kind: 'requested', auto: true, requestedByUserId: ACTOR })])
    })
  })

  it('a new catalog line starts not_requested with no request, answer or proposal data (no sourcing element)', async () => {
    const s = store({ charges: [charge()], elements: [element()] })
    await run(s)
    expect(s.costs[0].sourcingStatus).toBe('not_requested')
    for (const key of ['costRequestId', 'requestSeq', 'requestedAt', 'answeredAt', 'declineReason', 'proposedAmount']) expect(s.costs[0][key] ?? null).toBeNull()
  })
})
