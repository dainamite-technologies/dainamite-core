import {
  CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscription, CpqInventorySubscriptionItem, CpqOrderConfiguration, CpqProductCharge, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride, CpqQuoteTargetSubscription,
} from '../../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

jest.mock('../../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: async (em: any, quoteId: string, _scope: unknown, execute: any, makeError: any, optionsOrRevision?: any) => {
    const options = typeof optionsOrRevision === 'object' && optionsOrRevision !== null ? optionsOrRevision : { expectedRevision: optionsOrRevision }
    const expectedRevision: number | undefined = options.expectedRevision
    const quote = em.__quote
    if (!quote || quote.id !== quoteId) throw makeError(404, 'Quote not found')
    if (expectedRevision !== undefined && expectedRevision !== (quote.pricingRevision ?? 0)) throw makeError(409, 'STALE_REVISION')
    quote.pricingRevision = (quote.pricingRevision ?? 0) + 1
    // Opt-in (`em.__trackMargin`): run the real margin tracker around the write, as the real write transaction does.
    if (em.__trackMargin) await options.marginTracker?.before(em, quote)
    const result = await execute(em, quote)
    if (em.__trackMargin) em.__margin = await options.marginTracker?.after(em, quote)
    await options.afterCommit?.(result, quote)
    return result
  },
}))
import { CpqQuoteCostService } from '../quoteCostService'
import { COST_CLOSED_STATUSES } from '../costLock'
import { ADJUSTMENT_MUTABLE_STATUSES } from '../../../data/price-adjustments'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const ids = { quote: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', cost: '33333333-3333-4333-8333-333333333333' }
type Row = Record<string, any>

function setup(opts: { status?: string; orders?: number; costs?: Row[]; overrides?: Row[]; line?: Row; charges?: Row[]; enabled?: boolean; publisher?: jest.Mock; fx?: jest.Mock; fxPairs?: Row[]; trackMargin?: boolean; newTermEnd?: string | null } = {}) {
  const quote = { id: ids.quote, quoteId: ids.quote, cpqStatus: opts.status ?? 'ready', quoteType: 'new', currencyCode: 'EUR', pricingRevision: 4, quoteContext: {}, pricingSummary: { snapshotHash: 'snap-1' } }
  const line = { id: 'l', quoteLineId: ids.line, ...SCOPE, quoteConfigurationId: ids.quote, offeringId: 'off', productId: 'prod', configuration: {}, quantity: '1', charges: [], termMonths: 12, parentLineId: null, deletedAt: null, ...opts.line }
  const charges = opts.charges ?? [
    { code: 'tail', pricingMethod: 'cost_plus', chargeType: 'mrc', quantityAttributeCode: 'qty', offeringId: 'off' },
    { code: 'fixed_fee', pricingMethod: 'fixed', chargeType: 'nrc', quantityAttributeCode: null, offeringId: 'off' },
  ]
  const costs: Row[] = opts.costs ?? []
  const fxPairs = jest.fn(async (..._args: unknown[]): Promise<Row[]> => opts.fxPairs ?? [])
  const overrides: Row[] = opts.overrides ?? []
  const live = <T extends Row>(rows: T[]) => rows.filter((row) => !row.deletedAt)
  const subquery: Row = { select: jest.fn(() => subquery), where: jest.fn(() => subquery) }
  const em: Row = {
    __quote: quote,
    __trackMargin: opts.trackMargin === true,
    fork: jest.fn(() => em),
    createQueryBuilder: jest.fn(() => subquery),
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteLineConfiguration) return where.quoteLineId === ids.line ? line : null
      if (entity === CpqProductCharge) return charges.find((charge) => charge.code === where.code) ?? null
      if (entity === CpqQuoteLineCost) return live(costs).find((row) => row.id === where.id) ?? null
      if (entity === CpqQuoteMarkupOverride) return live(overrides).find((row) => row.quoteLineId === where.quoteLineId && row.chargeCode === where.chargeCode) ?? null
      if (entity === CpqQuoteConfiguration) return quote
      if (entity === CpqOrderConfiguration) return (opts.orders ?? 0) > 0 ? { id: 'order-1', sourceQuoteId: where.sourceQuoteId } : null
      if (entity === CpqQuoteTargetSubscription) return opts.newTermEnd ? { subscriptionId: where.subscriptionId, newTermEnd: opts.newTermEnd } : null
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === CpqQuoteLineConfiguration) return [line]
      if (entity === CpqQuoteLineCost) return live(costs)
      if (entity === CpqQuoteMarkupOverride) return live(overrides)
      return []
    }),
    count: jest.fn(async (entity: unknown) => (entity === CpqOrderConfiguration ? opts.orders ?? 0 : 0)),
    create: jest.fn((entity: unknown, data: Row) => ({ createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data })),
    persist: jest.fn((row: Row) => { (row.costKey !== undefined ? costs : overrides).push(row) }),
    flush: jest.fn(async () => undefined),
    getConnection: jest.fn(() => ({ execute: fxPairs })),
  }
  const recalculate = jest.fn(async () => ({}))
  const service = new CpqQuoteCostService({
    em: em as never,
    costService: { enabled: jest.fn(async () => opts.enabled ?? true) },
    quotingService: { recalculateLockedQuote: recalculate } as never,
    publisher: opts.publisher as never,
    fxRateResolver: opts.fx ? { resolve: opts.fx } as never : undefined,
  })
  return { service, em, quote, costs, overrides, recalculate, subquery, fxPairs, margin: () => em.__margin as Row | null | undefined }
}

const catalogRow = (over: Row = {}): Row => ({
  id: ids.cost, ...SCOPE, quoteConfigurationId: ids.quote, quoteLineId: ids.line, costKey: 'tail', chargeCode: 'tail', origin: 'catalog',
  costElementId: 'el', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'on_request', costModel: 'flat', valueStatus: 'estimated',
  valueOrigin: 'catalog', unitAmount: '300.0000', instanceAmount: '300.0000', currencyCode: 'EUR', supplierName: 'Acme', supplierQuoteRef: null,
  validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null, errorCode: null, deletedAt: null, ...over,
})
const manualRow = (over: Row = {}) => catalogRow({ costKey: 'manual:abcd1234', origin: 'manual', costElementId: null, valueOrigin: 'manual', source: 'fixed', valueStatus: 'confirmed', ...over })
const create = { quoteLineId: ids.line, name: 'Special build', role: 'margin_only' as const, costType: 'nrc' as const, source: 'fixed' as const, costModel: 'flat' as const, unitAmount: 1500 }
const FX_OK = { ok: true, rate: '0.92000000', rateDate: '2026-11-11', source: 'ECB', derivation: 'direct' }
const ACTOR = '44444444-4444-4444-8444-444444444444'

describe('reads', () => {
  it('toggle off: 404 for read and preview', async () => {
    const { service } = setup({ enabled: false })
    await expect(service.read(ids.quote, SCOPE, true)).rejects.toMatchObject({ status: 404 })
    await expect(service.preview({ productId: ids.line, configuration: {} }, SCOPE)).rejects.toMatchObject({ status: 404 })
  })
  it('the projection without cpq.costs.view carries no amount, supplier, markup or margin', async () => {
    const { service } = setup({
      costs: [catalogRow({ unitAmount: '7777.7700', instanceAmount: '7777.7700', supplierName: 'SecretSupplier', supplierQuoteRef: 'REF-9', note: 'secret note', validUntil: '2020-01-01' })],
      overrides: [{ id: 'o', quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: '31.0000', note: 'why' }],
    })
    const body = await service.read(ids.quote, SCOPE, false)
    expect(body).toEqual({ lines: [{ quoteLineId: ids.line, frozen: false, renegotiationDue: false, costs: [{ id: ids.cost, costKey: 'tail', name: 'Tail', role: 'price_basis', valueStatus: 'estimated', expired: true, carried: false, renegotiationDue: false,
      // sourcing status projection (statuses only)
      sourcingStatus: 'not_requested', requestSeq: null, requestedAt: null, hasAnswerPending: false, overdue: false, requestEligible: true }] }], pricingRevision: 4 })
    const json = JSON.stringify(body)
    for (const leak of ['7777', 'SecretSupplier', 'REF-9', 'secret note', 'markup', 'margin', 'amount', 'Amount', 'currency', 'supplier', '2020-01-01']) expect(json).not.toContain(leak)
  })
  it('with cpq.costs.view it adds values, supplier, markup overrides and the margin with its hash', async () => {
    const { service } = setup({
      costs: [catalogRow({ unitAmount: '7777.7700', instanceAmount: '7777.7700' })],
      overrides: [{ id: 'o', quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: '31.0000', note: 'why' }],
    })
    const body = await service.read(ids.quote, SCOPE, true) as any
    expect(body.lines[0].costs[0]).toMatchObject({ unitAmount: '7777.7700', supplierName: 'Acme', currencyCode: 'EUR', origin: 'catalog' })
    expect(body.markupOverrides[0]).toMatchObject({ chargeCode: 'tail', markupRule: 'markup_percent' })
    expect(body.margin.marginHash).toEqual(expect.any(String))
    expect(body.pricingRevision).toBe(4)
  })
  it('usage works with the toggle off', async () => {
    const { service } = setup({ enabled: false })
    await expect(service.usage(SCOPE)).resolves.toEqual({ enabled: false, costPlusCharges: 0, openQuotes: 0, openRequests: 0, liveSubscriptions: 0, openArcQuotesWithCarriedCosts: 0, missingFxPairs: [] })
  })
  it('usage counts with one aggregate query per figure: no cost row hydrated, no bound id list', async () => {
    const { service, em, subquery } = setup({ costs: [catalogRow()] })
    em.count.mockImplementation(async (entity: unknown) => (entity === CpqProductCharge ? 3 : entity === CpqQuoteConfiguration ? 2 : entity === CpqInventorySubscription ? 4 : entity === CpqQuoteLineCost ? 5 : 0))
    await expect(service.usage(SCOPE)).resolves.toEqual({ enabled: true, costPlusCharges: 3, openQuotes: 2, openRequests: 5, liveSubscriptions: 4, openArcQuotesWithCarriedCosts: 2, missingFxPairs: [] })
    expect(em.find).not.toHaveBeenCalled()
    expect(em.count).toHaveBeenCalledTimes(5)
    // Open requests: one COUNT of status-requested rows, restricted to quotes alive on both sides by a semi-join.
    const reqWhere = em.count.mock.calls.find(([entity]: unknown[]) => entity === CpqQuoteLineCost)[1]
    expect(reqWhere).toMatchObject({ ...SCOPE, deletedAt: null, sourcingStatus: 'requested' })
    expect(reqWhere.quoteConfigurationId.$in).toBe(subquery)
    expect(em.createQueryBuilder).toHaveBeenCalledWith(SalesQuote, 'sq')
    // Live subscriptions with an open cost: a semi-join on active inventory costs, no bound id list.
    const subWhere = em.count.mock.calls.find(([entity]: unknown[]) => entity === CpqInventorySubscription)[1]
    expect(subWhere).toMatchObject({ ...SCOPE, deletedAt: null, status: { $nin: ['terminated', 'expired', 'superseded'] } })
    expect(subWhere.id.$in).toBe(subquery)
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqInventoryCost, 'ic')
    // Q6: a cost is open only while its owner is live (item not terminated / expired / superseded, asset not cancelled / returned).
    expect(subquery.where).toHaveBeenCalledWith({
      ...SCOPE, deletedAt: null, status: 'active',
      $or: [{ subscriptionItemId: { $in: subquery } }, { assetId: { $in: subquery } }],
    })
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqInventorySubscriptionItem, 'si')
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null, status: { $nin: ['terminated', 'expired', 'superseded'] } })
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqInventoryAsset, 'ia')
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null, status: { $nin: ['cancelled', 'returned'] } })
    expect(em.count).toHaveBeenCalledWith(CpqProductCharge, { ...SCOPE, deletedAt: null, pricingMethod: 'cost_plus', isActive: true })
    const quoteWhere = em.count.mock.calls.find(([entity]: unknown[]) => entity === CpqQuoteConfiguration)[1]
    expect(quoteWhere).toMatchObject({ ...SCOPE, deletedAt: null, cpqStatus: { $nin: [...COST_CLOSED_STATUSES] } })
    // The quote ids come from a SQL subquery (semi-join), never from a materialized $in array.
    expect(Array.isArray(quoteWhere.id.$in)).toBe(false)
    expect(quoteWhere.id.$in).toBe(subquery)
    // Accepted-but-unconverted quotes are open; ordered quotes (NOT IN order sources) are not.
    expect(quoteWhere.cpqStatus.$nin).not.toContain('accepted')
    expect(quoteWhere.id.$nin).toBe(subquery)
    expect(em.createQueryBuilder).toHaveBeenCalledTimes(8) // + the carried-cost semi-join, + sales quotes and quote configurations of the open-request semi-join
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqQuoteLineCost, 'qlc')
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqOrderConfiguration, 'oc')
    expect(subquery.select).toHaveBeenCalledWith('oc.sourceQuoteId')
    expect(subquery.select).toHaveBeenCalledWith('qlc.quoteConfigurationId')
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null })
    // ARC exposure: same open definition, restricted by a semi-join on carried cost lines (the partial index predicate).
    const arcCall = em.count.mock.calls.find(([entity, where]: unknown[]) => entity === CpqQuoteConfiguration && (where as Row).id.$in === subquery && (where as Row) !== quoteWhere)
    expect(arcCall).toBeDefined()
    expect(arcCall[1]).toMatchObject({ ...SCOPE, deletedAt: null, cpqStatus: { $nin: [...COST_CLOSED_STATUSES] } })
    expect(arcCall[1].id.$nin).toBe(subquery)
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null, carriedFromItemCostId: { $ne: null } })
  })
})

describe('FX projection (FX step 8)', () => {
  const snapshot = { currencyCode: 'USD', unitAmount: '300', instanceAmount: '300', fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'inverse' }
  it('a costs.view holder gets the snapshot, the converted amount (quote currency, 4 dp) and the pair of a missing rate; a non-holder only the code', async () => {
    const costs = [
      catalogRow({ costKey: 'a', ...snapshot }),
      catalogRow({ id: 'c2', costKey: 'b', currencyCode: 'GBP', unitAmount: '10', instanceAmount: null, valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE' }),
    ]
    const holder = await setup({ costs }).service.read(ids.quote, SCOPE, true) as any
    expect(holder.lines[0].costs[0]).toMatchObject({ currencyCode: 'USD', fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'inverse', convertedInstanceAmount: '276', quoteCurrencyCode: 'EUR' })
    expect(holder.lines[0].costs[0]).not.toHaveProperty('errorDetail')
    expect(holder.lines[0].costs[1]).toMatchObject({ error: 'CURRENCY_NO_RATE', convertedInstanceAmount: null, errorDetail: { code: 'CURRENCY_NO_RATE', from: 'GBP', to: 'EUR', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } })
    const other = await setup({ costs }).service.read(ids.quote, SCOPE, false) as any
    expect(other.lines[0].costs[1]).toMatchObject({ error: 'CURRENCY_NO_RATE' })
    expect(JSON.stringify(other)).not.toMatch(/fx|GBP|USD|0\.92|ECB|errorDetail|converted/)
  })
  it('a write result carries the snapshot of the written line', async () => {
    const fx = jest.fn(async () => FX_OK)
    const { service } = setup({ fx })
    const result = await service.createCost(ids.quote, { ...create, currencyCode: 'USD' }, ACTOR, SCOPE)
    expect(result.cost).toMatchObject({ currencyCode: 'USD', fxRate: '0.92000000', fxRateSource: 'ECB', convertedInstanceAmount: '1380', quoteCurrencyCode: 'EUR' })
  })
})

describe('usage: missingFxPairs (FX step 8)', () => {
  it('groups the pairs with open-quote counts in ONE grouped query scoped to the tenant, excluding closed and converted quotes', async () => {
    const { service, fxPairs, em } = setup({ fxPairs: [{ from: 'USD', to: 'EUR', openQuotes: '2' }, { from: 'GBP', to: 'EUR', openQuotes: 1 }] })
    const usage = await service.usage(SCOPE)
    expect(usage.missingFxPairs).toEqual([{ from: 'USD', to: 'EUR', openQuotes: 2 }, { from: 'GBP', to: 'EUR', openQuotes: 1 }])
    expect(fxPairs).toHaveBeenCalledTimes(1)
    const [sql, params] = fxPairs.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual([SCOPE.organizationId, SCOPE.tenantId, ...ADJUSTMENT_MUTABLE_STATUSES])
    // review1-b: locked statuses (in_approval, with_customer, accepted, ...) never pick up a rate, so they are not counted
    expect(params).not.toContain('with_customer')
    expect(params).not.toContain('accepted')
    for (const closed of COST_CLOSED_STATUSES) expect(params).not.toContain(closed)
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toMatch(/group by c\.currency_code, q\.currency_code/)
    expect(flat).toMatch(/count\(distinct c\.quote_configuration_id\)/)
    expect(flat).toMatch(/c\.error_code = 'CURRENCY_NO_RATE'/)
    expect(flat).toMatch(/c\.deleted_at is null/)
    expect(flat).toMatch(/q\.deleted_at is null/)
    expect(flat).toMatch(/q\.cpq_status in \(\?, \?, \?\)/)
    expect(flat).toMatch(/not exists \(select 1 from cpq_order_configurations o where o\.source_quote_id = q\.id/)
    expect(flat).toMatch(/o\.organization_id = q\.organization_id and o\.tenant_id = q\.tenant_id and o\.deleted_at is null/)
    expect(em.find).not.toHaveBeenCalled() // no cost row is hydrated
  })
  it('is empty without pairs and also works with the toggle off', async () => {
    const { service } = setup({ enabled: false })
    expect((await service.usage(SCOPE)).missingFxPairs).toEqual([])
  })
})

describe('createCost', () => {
  it('creates a margin-only line cost with a reserved-prefix key and re-prices while unlocked', async () => {
    const { service, costs, recalculate } = setup()
    const result = await service.createCost(ids.quote, create, ACTOR, SCOPE)
    expect(costs).toHaveLength(1)
    expect(costs[0]).toMatchObject({ origin: 'manual', chargeCode: null, valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '1500', instanceAmount: '1500', currencyCode: 'EUR' })
    expect(costs[0].costKey).toMatch(/^manual:[0-9a-f]{8}$/)
    expect(recalculate).toHaveBeenCalledTimes(1)
    expect(result.pricingRevision).toBe(5)
    expect(result.audit).toEqual({ before: null, after: expect.objectContaining({ costKey: costs[0].costKey, role: 'margin_only' }) })
  })
  it('on_request without an amount is none; a status without an amount is refused', async () => {
    const { service, costs } = setup()
    await service.createCost(ids.quote, { ...create, source: 'on_request', unitAmount: undefined }, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: null, valueOrigin: null })
    await expect(service.createCost(ids.quote, { ...create, source: 'on_request', unitAmount: undefined, valueStatus: 'confirmed' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'AMOUNT_REQUIRED' })
  })
  it('R10: price_basis needs a cost-plus charge of the line', async () => {
    const { service } = setup()
    await expect(service.createCost(ids.quote, { ...create, role: 'price_basis' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'PRICE_BASIS_REQUIRES_COST_PLUS' })
    await expect(service.createCost(ids.quote, { ...create, role: 'price_basis', chargeCode: 'fixed_fee' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'PRICE_BASIS_REQUIRES_COST_PLUS' })
    await expect(service.createCost(ids.quote, { ...create, chargeCode: 'nope' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CHARGE_NOT_FOUND' })
    await expect(service.createCost(ids.quote, { ...create, role: 'price_basis', chargeCode: 'tail', costType: 'nrc' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'COST_TYPE_MISMATCH' })
  })
  it('a price-basis cost on a cost-plus charge is created and priced', async () => {
    const { service, costs, recalculate } = setup()
    await service.createCost(ids.quote, { ...create, role: 'price_basis', chargeCode: 'tail', costType: 'mrc', unitAmount: 280, valueStatus: 'confirmed' }, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ role: 'price_basis', chargeCode: 'tail', valueStatus: 'confirmed' })
    expect(recalculate).toHaveBeenCalled()
  })
  it('[FX step 7: replaces the step-1 refusal] a foreign-currency amount is stored as entered with the rate resolved at the write', async () => {
    const fx = jest.fn(async () => FX_OK)
    const { service, costs, recalculate } = setup({ fx })
    const result = await service.createCost(ids.quote, { ...create, currencyCode: 'USD' }, ACTOR, SCOPE)
    expect(fx).toHaveBeenCalledWith({ from: 'USD', to: 'EUR', scope: SCOPE })
    expect(costs[0]).toMatchObject({
      unitAmount: '1500', instanceAmount: '1500', currencyCode: 'USD', valueStatus: 'confirmed', valueOrigin: 'manual', errorCode: null,
      fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'direct',
    })
    expect(recalculate).toHaveBeenCalledTimes(1)
    expect(result.cost).toMatchObject({ currencyCode: 'USD', fxRate: '0.92000000' })
  })
  it('no rate: the value is stored (entered amount and currency) as none + CURRENCY_NO_RATE, never converted 1:1', async () => {
    const fx = jest.fn(async () => ({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'not_found' }))
    const { service, costs } = setup({ fx })
    await service.createCost(ids.quote, { ...create, currencyCode: 'USD' }, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: '1500', instanceAmount: null, currencyCode: 'USD', errorCode: 'CURRENCY_NO_RATE', valueOrigin: 'manual', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null })
    // Without any resolver (currencies not installed) the outcome is the same.
    const bare = setup()
    await bare.service.createCost(ids.quote, { ...create, currencyCode: 'USD' }, ACTOR, SCOPE)
    expect(bare.costs[0]).toMatchObject({ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', unitAmount: '1500', currencyCode: 'USD' })
  })
  it('a quote-currency amount never calls the resolver and carries no FX columns', async () => {
    const fx = jest.fn(async () => FX_OK)
    const { service, costs } = setup({ fx })
    await service.createCost(ids.quote, create, ACTOR, SCOPE)
    expect(fx).not.toHaveBeenCalled()
    expect(costs[0]).toMatchObject({ fxRate: null, fxRateSource: null })
  })
  it('Q9: a new lock-exempt margin-only foreign line on a locked quote takes the rate at the write and does not re-price', async () => {
    const fx = jest.fn(async () => FX_OK)
    const { service, costs, recalculate } = setup({ status: 'with_customer', fx })
    await service.createCost(ids.quote, { ...create, currencyCode: 'GBP' }, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ currencyCode: 'GBP', fxRate: '0.92000000', valueStatus: 'confirmed' })
    expect(recalculate).not.toHaveBeenCalled()
  })
  it('a foreign price-basis create on a locked quote is still COST_LOCKED (price never moves while locked)', async () => {
    const fx = jest.fn(async () => FX_OK)
    const { service, costs } = setup({ status: 'with_customer', fx })
    await expect(service.createCost(ids.quote, { ...create, role: 'price_basis', chargeCode: 'tail', costType: 'mrc', currencyCode: 'USD' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(costs).toHaveLength(0)
  })
  it('refuses cancel / mirror lines', async () => {
    const mirror = setup({ line: { configuration: { _arcMirroredFromItemId: 'i' } } })
    mirror.quote.quoteType = 'amend'
    await expect(mirror.service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    const bare = setup({ line: { offeringId: null, productId: null } })
    await expect(bare.service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
  })
  it('stale revision answers 409 and writes nothing', async () => {
    const { service, costs } = setup()
    await expect(service.createCost(ids.quote, { ...create, expectedRevision: 1 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
    expect(costs).toHaveLength(0)
  })
  it('toggle off: 404', async () => {
    await expect(setup({ enabled: false }).service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
  })
})

describe('cost lock matrix', () => {
  const locked = { status: 'with_customer' }
  const priceBasis = { role: 'price_basis' as const, chargeCode: 'tail', costType: 'mrc' as const, unitAmount: 280 }

  it('create: price-basis is COST_LOCKED, margin-only is allowed and does not re-price', async () => {
    const a = setup(locked)
    await expect(a.service.createCost(ids.quote, { ...create, ...priceBasis }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(a.costs).toHaveLength(0)
    const b = setup(locked)
    await b.service.createCost(ids.quote, create, ACTOR, SCOPE)
    expect(b.costs).toHaveLength(1)
    expect(b.recalculate).not.toHaveBeenCalled()
  })
  it('an existing order locks a ready quote too', async () => {
    const { service } = setup({ orders: 1 })
    await expect(service.createCost(ids.quote, { ...create, ...priceBasis }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
  })
  it('a rejected or cancelled quote refuses even margin-only writes', async () => {
    for (const status of ['rejected', 'cancelled']) {
      const { service } = setup({ status })
      await expect(service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    }
  })
  it('an accepted quote still confirms an unchanged estimated value (needed to convert, R7) but refuses price changes', async () => {
    const row = catalogRow()
    const { service } = setup({ status: 'accepted', costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { valueStatus: 'confirmed' }, ACTOR, SCOPE)
    expect(row.valueStatus).toBe('confirmed')
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 1 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
  })
  it('update: a price-basis value change is COST_LOCKED while locked', async () => {
    const row = manualRow()
    const { service } = setup({ ...locked, costs: [row] })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 100 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(row.unitAmount).toBe('300.0000')
  })
  it('R11 exemption: confirming an unchanged estimated value while locked', async () => {
    const row = catalogRow()
    const { service, recalculate } = setup({ ...locked, costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { valueStatus: 'confirmed' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ valueStatus: 'confirmed', valueOrigin: 'manual', unitAmount: '300' })
    expect(recalculate).not.toHaveBeenCalled()
  })
  it('R11 exemption: a margin-only value change while locked', async () => {
    const row = manualRow({ role: 'margin_only', chargeCode: null })
    const { service } = setup({ ...locked, costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 2000 }, ACTOR, SCOPE)
    expect(row.unitAmount).toBe('2000')
  })
  it('R11 exemption: extending validity needs a new supplier quote ref or a note', async () => {
    const row = catalogRow({ validUntil: '2026-12-01', supplierQuoteRef: 'OLD' })
    const { service } = setup({ ...locked, costs: [row] })
    await expect(service.updateCost(ids.quote, ids.cost, { validUntil: '2027-03-01' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'VALIDITY_EVIDENCE_REQUIRED' })
    await expect(service.updateCost(ids.quote, ids.cost, { validUntil: '2027-03-01', supplierQuoteRef: 'OLD' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'VALIDITY_EVIDENCE_REQUIRED' })
    await service.updateCost(ids.quote, ids.cost, { validUntil: '2027-03-01', supplierQuoteRef: 'NEW' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ validUntil: '2027-03-01', supplierQuoteRef: 'NEW' })
    await service.updateCost(ids.quote, ids.cost, { supplierTermEnd: '2028-01-01', note: 'extended by supplier mail' }, ACTOR, SCOPE)
    expect(row.supplierTermEnd).toBe('2028-01-01')
    // shortening needs no evidence
    await service.updateCost(ids.quote, ids.cost, { validUntil: '2027-01-01' }, ACTOR, SCOPE)
  })
  it('delete: a manual price-basis cost is COST_LOCKED, a margin-only one is deletable', async () => {
    const a = setup({ ...locked, costs: [manualRow()] })
    await expect(a.service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    const row = manualRow({ role: 'margin_only', chargeCode: null })
    const b = setup({ ...locked, costs: [row] })
    await b.service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE)
    expect(row.deletedAt).toBeInstanceOf(Date)
  })
  it('markup overrides are COST_LOCKED while locked (set and clear)', async () => {
    const a = setup({ ...locked, overrides: [{ id: 'o', quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: '10', note: 'n' }] })
    const input = { quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent' as const, markupValue: 30, note: 'deal' }
    await expect(a.service.setMarkupOverride(ids.quote, input, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    await expect(a.service.clearMarkupOverride(ids.quote, ids.line, 'tail', ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
  })
})

describe('ARC lines', () => {
  const mirrorConfig = (over: Row = {}) => ({ configuration: { _arcMirroredFromItemId: 'item-1', ...over } })
  function arc(quoteType: string, line: Row, costs: Row[] = [catalogRow()]) {
    const ctx = setup({ line, costs })
    ctx.quote.quoteType = quoteType
    return ctx
  }

  it.each([
    ['a reconfigured Renew mirror line (Q13)', 'renew', mirrorConfig({ _arcReconfigured: true })],
    ['a reconfigured (unfrozen) Amend mirror line', 'amend', mirrorConfig({ _arcReconfigured: true })],
  ])('confirms the estimated catalog cost of %s', async (_label, quoteType, line) => {
    const row = catalogRow()
    const { service, recalculate } = arc(quoteType, line, [row])
    await service.updateCost(ids.quote, ids.cost, { valueStatus: 'confirmed' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ valueStatus: 'confirmed', valueOrigin: 'manual', unitAmount: '300' })
    expect(recalculate).toHaveBeenCalled()
    // ...and enters a new value with a reason
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 280, note: 'partner quote' }, ACTOR, SCOPE)
    expect(row.unitAmount).toBe('280')
  })

  it.each([
    ['a frozen Amend mirror line', 'amend', mirrorConfig({ _arcPriceFrozen: true })],
    ['a frozen cost-plus Renew mirror line', 'renew', mirrorConfig({ _arcPriceFrozen: true, _arcCostPlusFrozen: true })],
    // CHANGED from feature 1 (these were confirmable): an unreconfigured mirror has no catalog cost lines (R1c).
    ['an unreconfigured Renew mirror line', 'renew', mirrorConfig()],
    ['an unfrozen Amend mirror line without the reconfigured marker', 'amend', mirrorConfig()],
    ['an item removed on Renew (cancel line)', 'renew', { action: 'cancel', ...mirrorConfig() }],
    ['an item removed on Amend (cancel line)', 'amend', { action: 'cancel', ...mirrorConfig() }],
    ['a Cancel-quote line', 'cancel', { action: 'cancel', ...mirrorConfig() }],
  ])('refuses every write on %s (LINE_NOT_ELIGIBLE)', async (_label, quoteType, line) => {
    const row = catalogRow()
    const { service } = arc(quoteType, line, [row])
    await expect(service.updateCost(ids.quote, ids.cost, { valueStatus: 'confirmed' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    await expect(service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    expect(row.valueStatus).toBe('estimated')
  })

  it('creates no manual cost and no markup override on a reconfigured mirror line (structure writes stay off mirrors)', async () => {
    const { service, costs } = arc('renew', mirrorConfig({ _arcReconfigured: true }), [])
    await expect(service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    const input = { quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent' as const, markupValue: 30, note: 'deal' }
    await expect(service.setMarkupOverride(ids.quote, input, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    expect(costs).toHaveLength(0)
  })
})

describe('carried costs on frozen Amend mirror lines (ARC costs spec step 7, Q4)', () => {
  const FROZEN = { configuration: { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' } }
  const carriedRow = (over: Row = {}) => catalogRow({ origin: 'carried', valueOrigin: 'carried', valueStatus: 'confirmed', source: 'fixed', costElementId: null,
    unitAmount: '270.0000', instanceAmount: '270.0000', carriedFromItemCostId: 'ic-1', carriedFromHash: 'h1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', ...over })
  function amend(opts: { status?: string; orders?: number; line?: Row; costs?: Row[]; quoteType?: string } = {}) {
    const ctx = setup({ status: opts.status ?? 'with_customer', orders: opts.orders, line: opts.line ?? FROZEN, costs: opts.costs ?? [carriedRow()], trackMargin: true })
    ctx.quote.quoteType = opts.quoteType ?? 'amend'
    return ctx
  }

  it('stores a changed price-basis value on a locked quote, leaves the price alone (no re-pricing, snapshotHash unchanged) and moves margin_hash', async () => {
    const row = carriedRow()
    const { service, quote, recalculate, margin } = amend({ costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 240, supplierQuoteRef: 'CX-2207', note: 'renegotiated' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ unitAmount: '240', instanceAmount: '240', valueOrigin: 'manual', origin: 'carried', supplierQuoteRef: 'CX-2207', carriedFromItemCostId: 'ic-1', carriedFromHash: 'h1' })
    expect(recalculate).not.toHaveBeenCalled()
    expect(quote.pricingSummary.snapshotHash).toBe('snap-1')
    // the margin signal the write emits as margin_changed: the hash moved, an approval given on the old margin no longer holds
    const signal = margin()
    expect(signal).toMatchObject({ approvalInvalidated: true })
    expect(signal!.marginHash).not.toBe(signal!.previousMarginHash)
  })

  it('review: once the quote has an order, an edit of a carried cost on a frozen line is refused with 409 QUOTE_CONVERTED (Re-confirm on the order is the path); nothing is written', async () => {
    const row = carriedRow()
    const { service, recalculate } = amend({ status: 'ready', orders: 1, costs: [row] })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 240, note: 'renegotiated' }, ACTOR, SCOPE))
      .rejects.toMatchObject({ status: 409, message: 'QUOTE_CONVERTED', details: { orderId: 'order-1' } })
    expect(row).toMatchObject({ unitAmount: '270.0000', valueOrigin: 'carried' })
    expect(recalculate).not.toHaveBeenCalled()
  })

  it('overwriting a carried value needs a note (NOTE_REQUIRED); keeping it with new validity and evidence does not', async () => {
    const row = carriedRow({ validUntil: '2026-12-01' })
    const { service } = amend({ costs: [row] })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 240 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'NOTE_REQUIRED' })
    expect(row).toMatchObject({ unitAmount: '270.0000', valueOrigin: 'carried' })
    await service.updateCost(ids.quote, ids.cost, { validUntil: '2027-06-01', supplierQuoteRef: 'CX-NEW' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ validUntil: '2027-06-01', supplierQuoteRef: 'CX-NEW', unitAmount: '270', valueOrigin: 'carried' })
  })

  it('a carried line refuses structural edits and deletion (its structure is the subscription item\'s)', async () => {
    const { service } = amend()
    await expect(service.updateCost(ids.quote, ids.cost, { role: 'margin_only' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'FIELD_NOT_ALLOWED' })
    await expect(service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CATALOG_COST_NOT_DELETABLE' })
  })

  it('a rejected or cancelled quote still refuses the write', async () => {
    for (const status of ['rejected', 'cancelled']) {
      await expect(amend({ status }).service.updateCost(ids.quote, ids.cost, { unitAmount: 240, note: 'x' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    }
  })

  it('once the line is un-frozen (reconfigured) the normal price-basis lock applies again', async () => {
    const row = carriedRow()
    const { service } = amend({ line: { configuration: { _arcMirroredFromItemId: 'item-1', _arcReconfigured: true, _arcCostsCarried: true } }, costs: [row] })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 240, note: 'x' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(row.unitAmount).toBe('270.0000')
  })

  it('a cost-plus Renew frozen mirror takes the same rule (frozen mirror line)', async () => {
    const row = carriedRow()
    const { service } = amend({ quoteType: 'renew', line: { configuration: { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostPlusFrozen: true } }, costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 240, note: 'x' }, ACTOR, SCOPE)
    expect(row.unitAmount).toBe('240')
  })

  it('does not widen anything else: a catalog cost on a frozen Amend line is still LINE_NOT_ELIGIBLE, and a manual cost cannot be created there', async () => {
    const catalog = catalogRow()
    const a = amend({ costs: [catalog] })
    await expect(a.service.updateCost(ids.quote, ids.cost, { valueStatus: 'confirmed' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    await expect(a.service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
  })

  it('a carried cost on a cancel (removal) line is still refused', async () => {
    const { service } = amend({ line: { action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true } } })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 240, note: 'x' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
  })
})

describe('Keep current cost (ARC costs step 15, App Spec R13)', () => {
  const RENEW_LINE = { targetSubscriptionId: 'sub-1', configuration: { _arcMirroredFromItemId: 'item-1', _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' } }
  const dueRow = (over: Row = {}) => catalogRow({
    origin: 'carried', valueOrigin: 'carried', valueStatus: 'estimated', renegotiationDue: true, source: 'fixed', costElementId: null, unitAmount: '320.0000', instanceAmount: '320.0000',
    currencyCode: 'EUR', fxRate: null, validUntil: '2027-06-30', supplierTermEnd: '2027-06-30', supplierQuoteRef: 'CX-1', carriedFromItemCostId: 'ic-1', carriedFromHash: 'h1', ...over,
  })
  function renew(opts: { status?: string; orders?: number; row?: Row; newTermEnd?: string | null; line?: Row } = {}) {
    const ctx = setup({ status: opts.status ?? 'with_customer', orders: opts.orders, line: opts.line ?? RENEW_LINE, costs: [opts.row ?? dueRow()], newTermEnd: opts.newTermEnd === undefined ? '2028-12-31' : opts.newTermEnd, trackMargin: true })
    ctx.quote.quoteType = 'renew'
    return ctx
  }
  const keep = (over: Row = {}) => ({ keepCurrent: true as const, validUntil: '2028-12-31', note: 'Carrier confirmed rolling term', ...over })

  it('confirms the cost unchanged: flag cleared, value / currency kept, new validity and evidence stored, margin_hash unchanged', async () => {
    const row = dueRow()
    const { service, margin } = renew({ row })
    const result = await service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: '2029-01-31' }), ACTOR, SCOPE)
    expect(row).toMatchObject({
      renegotiationDue: false, valueStatus: 'confirmed', valueOrigin: 'carried', origin: 'carried', unitAmount: '320.0000', instanceAmount: '320.0000', currencyCode: 'EUR',
      validUntil: '2028-12-31', supplierTermEnd: '2029-01-31', note: 'Carrier confirmed rolling term', supplierQuoteRef: 'CX-1',
    })
    const signal = margin()
    expect(signal!.marginHash).toBe(signal!.previousMarginHash)
    expect(result.cost).toMatchObject({ id: ids.cost, valueStatus: 'confirmed' })
  })

  it('the supplier term may be cleared to rolling (null) with the validity extended', async () => {
    const row = dueRow()
    const { service } = renew({ row })
    await service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)
    expect(row).toMatchObject({ supplierTermEnd: null, validUntil: '2028-12-31', renegotiationDue: false })
  })

  it('a new supplier quote ref is evidence on its own, and replaces the stored ref', async () => {
    const row = dueRow()
    const { service } = renew({ row })
    await service.updateCost(ids.quote, ids.cost, { keepCurrent: true, validUntil: '2028-12-31', supplierTermEnd: '2029-01-31', supplierQuoteRef: 'CX-2300' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ supplierQuoteRef: 'CX-2300', supplierTermEnd: '2029-01-31', renegotiationDue: false, valueStatus: 'confirmed' })
  })

  it('VALIDITY_EVIDENCE_REQUIRED without a note or a new supplier quote ref (the same ref is not evidence); nothing is written', async () => {
    const row = dueRow()
    const { service, recalculate } = renew({ row })
    for (const patch of [{ keepCurrent: true as const, validUntil: '2028-12-31' }, { keepCurrent: true as const, validUntil: '2028-12-31', supplierQuoteRef: 'CX-1' }]) {
      await expect(service.updateCost(ids.quote, ids.cost, patch, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'VALIDITY_EVIDENCE_REQUIRED' })
    }
    expect(row).toMatchObject({ renegotiationDue: true, valueStatus: 'estimated', validUntil: '2027-06-30' })
    expect(recalculate).not.toHaveBeenCalled()
  })

  it('RENEGOTIATION_DATES_SHORT while the validity or the (unchanged) supplier term is before the new term end', async () => {
    const row = dueRow()
    const { service } = renew({ row })
    // validity extended, supplier term still short (2027-06-30)
    await expect(service.updateCost(ids.quote, ids.cost, keep(), ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'RENEGOTIATION_DATES_SHORT', details: { newTermEnd: '2028-12-31', fields: ['supplierTermEnd'] } })
    // validity still short
    await expect(service.updateCost(ids.quote, ids.cost, keep({ validUntil: '2028-12-30', supplierTermEnd: null }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'RENEGOTIATION_DATES_SHORT' })
    expect(row).toMatchObject({ renegotiationDue: true, valueStatus: 'estimated' })
    // the new term end itself is enough
    await service.updateCost(ids.quote, ids.cost, keep({ validUntil: '2028-12-31', supplierTermEnd: '2028-12-31' }), ACTOR, SCOPE)
    expect(row.renegotiationDue).toBe(false)
  })

  it('is lock-exempt (R11): works on a locked quote (with_customer) and re-prices nothing', async () => {
    const ctx = renew({ status: 'with_customer' })
    await ctx.service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)
    expect(ctx.costs[0]).toMatchObject({ renegotiationDue: false, valueStatus: 'confirmed' })
    expect(ctx.recalculate).not.toHaveBeenCalled()
  })

  it('review: once the quote has an order Keep current is refused with 409 QUOTE_CONVERTED and writes nothing', async () => {
    const ctx = renew({ status: 'ready', orders: 1 })
    await expect(ctx.service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'QUOTE_CONVERTED', details: { orderId: 'order-1' } })
    expect(ctx.costs[0]).toMatchObject({ renegotiationDue: true, valueStatus: 'estimated' })
  })

  it('a rejected or cancelled quote still refuses it', async () => {
    for (const status of ['rejected', 'cancelled']) {
      await expect(renew({ status }).service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    }
  })

  it('accepts nothing but the keep fields beside the flag (FIELD_NOT_ALLOWED), and only a due carried cost (NOT_RENEGOTIATION_DUE)', async () => {
    const row = dueRow()
    const { service } = renew({ row })
    await expect(service.updateCost(ids.quote, ids.cost, keep({ unitAmount: 100 }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'FIELD_NOT_ALLOWED', details: { fields: ['unitAmount'] } })
    await expect(service.updateCost(ids.quote, ids.cost, keep({ valueStatus: 'confirmed' }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'FIELD_NOT_ALLOWED' })
    expect(row.unitAmount).toBe('320.0000')
    await expect(renew({ row: dueRow({ renegotiationDue: false }) }).service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE))
      .rejects.toMatchObject({ status: 422, message: 'NOT_RENEGOTIATION_DUE' })
    const catalog = renew({ row: dueRow({ origin: 'catalog', valueOrigin: 'catalog' }), line: { targetSubscriptionId: 'sub-1', configuration: { _arcMirroredFromItemId: 'item-1', _arcReconfigured: true } } })
    await expect(catalog.service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'NOT_RENEGOTIATION_DUE' })
  })

  it('cancels an open supplier request on the cost (manual_value) and drops an unapplied proposal', async () => {
    const row = dueRow({ sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 1, requestHistory: [], proposedAmount: '300', proposedAnswer: { unitAmount: 300 } })
    const { service } = renew({ row })
    await service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)
    expect(row).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'manual_value', proposedAmount: null, proposedAnswer: null, renegotiationDue: false })
  })

  it('entering a new confirmed value by hand on a due carried cost clears the flag too', async () => {
    const row = dueRow()
    const { service } = renew({ row, status: 'ready' })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 300, valueStatus: 'confirmed', note: 'phone quote', validUntil: '2028-12-31' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ renegotiationDue: false, valueStatus: 'confirmed', valueOrigin: 'manual', unitAmount: '300' })
  })

  it('a cancel line stays LINE_NOT_ELIGIBLE', async () => {
    const { service } = renew({ line: { action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } } })
    await expect(service.updateCost(ids.quote, ids.cost, keep({ supplierTermEnd: null }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
  })

  it('without a known new term end the dates are not checked', async () => {
    const row = dueRow()
    const { service } = renew({ row, newTermEnd: null })
    await service.updateCost(ids.quote, ids.cost, keep({ validUntil: '2027-07-01' }), ACTOR, SCOPE)
    expect(row.renegotiationDue).toBe(false)
  })
})

describe('updateCost rules', () => {
  it('overwriting a catalog value needs a note and then becomes manual', async () => {
    const row = catalogRow()
    const { service, recalculate } = setup({ costs: [row] })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 280 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'NOTE_REQUIRED' })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 280, valueStatus: 'confirmed', note: 'supplier call' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ unitAmount: '280', valueOrigin: 'manual', valueStatus: 'confirmed', note: 'supplier call' })
    expect(recalculate).toHaveBeenCalled()
  })
  it('entering a value on a cost without one needs no note', async () => {
    const row = catalogRow({ valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, currencyCode: null })
    const { service } = setup({ costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 280, valueStatus: 'confirmed' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ unitAmount: '280', currencyCode: 'EUR', valueOrigin: 'manual' })
  })
  it('catalog lines refuse structural edits', async () => {
    const { service } = setup({ costs: [catalogRow()] })
    await expect(service.updateCost(ids.quote, ids.cost, { role: 'margin_only' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'FIELD_NOT_ALLOWED' })
  })
  it('404 for an unknown cost line', async () => {
    await expect(setup().service.updateCost(ids.quote, ids.cost, { note: 'x' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
  })
})

describe('foreign-currency value edits (FX spec Q9)', () => {
  const fxFrozen = { fxRate: '0.90000000', fxRateDate: '2026-10-01', fxRateSource: 'ECB', fxRateDerivation: 'direct' }
  const usdRow = (over: Row = {}) => manualRow({ role: 'margin_only', chargeCode: null, unitAmount: '300', instanceAmount: '300', currencyCode: 'USD', ...fxFrozen, ...over })
  const FX_NEW = { ok: true, rate: '0.95000000', rateDate: '2026-11-14', source: 'Manual', derivation: 'inverse' }

  it('unlocked: re-entering a value in a foreign currency refreshes the snapshot at the write date', async () => {
    const row = usdRow()
    const fx = jest.fn(async () => FX_NEW)
    const { service, recalculate } = setup({ costs: [row], fx })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 400 }, ACTOR, SCOPE)
    expect(fx).toHaveBeenCalledWith({ from: 'USD', to: 'EUR', scope: SCOPE })
    expect(row).toMatchObject({ unitAmount: '400', instanceAmount: '400', currencyCode: 'USD', fxRate: '0.95000000', fxRateDate: '2026-11-14', fxRateSource: 'Manual', fxRateDerivation: 'inverse', valueStatus: 'confirmed', errorCode: null })
    expect(recalculate).toHaveBeenCalledTimes(1)
  })
  it('locked: a margin-only value re-entered takes the rate at the write date; the price is not re-priced', async () => {
    const row = usdRow()
    const fx = jest.fn(async () => FX_NEW)
    const { service, recalculate } = setup({ status: 'with_customer', costs: [row], fx })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 400 }, ACTOR, SCOPE)
    expect(row).toMatchObject({ unitAmount: '400', fxRate: '0.95000000' })
    expect(recalculate).not.toHaveBeenCalled()
  })
  it('locked: a same-value confirmation keeps the stored snapshot and never reads a rate', async () => {
    const row = usdRow({ valueStatus: 'estimated' })
    const fx = jest.fn(async () => FX_NEW)
    const { service } = setup({ status: 'with_customer', costs: [row], fx })
    await service.updateCost(ids.quote, ids.cost, { valueStatus: 'confirmed' }, ACTOR, SCOPE)
    expect(fx).not.toHaveBeenCalled()
    expect(row).toMatchObject({ valueStatus: 'confirmed', ...fxFrozen })
  })
  it('locked: a currency change counts as a value change (not a confirmation): margin-only re-rates, price-basis is COST_LOCKED', async () => {
    const margin = usdRow({ currencyCode: 'EUR', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null })
    const fx = jest.fn(async () => FX_NEW)
    const a = setup({ status: 'with_customer', costs: [margin], fx })
    await a.service.updateCost(ids.quote, ids.cost, { currencyCode: 'GBP' }, ACTOR, SCOPE)
    expect(fx).toHaveBeenCalledWith({ from: 'GBP', to: 'EUR', scope: SCOPE })
    expect(margin).toMatchObject({ currencyCode: 'GBP', fxRate: '0.95000000' })
    const basis = manualRow({ unitAmount: '300', currencyCode: 'USD', ...fxFrozen })
    const b = setup({ status: 'with_customer', costs: [basis], fx })
    await expect(b.service.updateCost(ids.quote, ids.cost, { currencyCode: 'GBP' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(basis).toMatchObject({ currencyCode: 'USD', ...fxFrozen })
  })
  it('locked: a price-basis foreign value is COST_LOCKED and keeps its snapshot (R4)', async () => {
    const basis = manualRow({ unitAmount: '300', currencyCode: 'USD', ...fxFrozen })
    const { service } = setup({ status: 'with_customer', costs: [basis], fx: jest.fn(async () => FX_NEW) })
    await expect(service.updateCost(ids.quote, ids.cost, { unitAmount: 100 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(basis).toMatchObject({ unitAmount: '300', ...fxFrozen })
  })
  it('a value moved back to the quote currency clears the snapshot', async () => {
    const row = usdRow()
    const fx = jest.fn(async () => FX_NEW)
    const { service } = setup({ costs: [row], fx })
    await service.updateCost(ids.quote, ids.cost, { currencyCode: 'EUR' }, ACTOR, SCOPE)
    expect(fx).not.toHaveBeenCalled()
    expect(row).toMatchObject({ currencyCode: 'EUR', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null })
  })
  it('no rate on edit: none + CURRENCY_NO_RATE with the entered amount kept and the old snapshot dropped', async () => {
    const row = usdRow()
    const { service } = setup({ costs: [row], fx: jest.fn(async () => ({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'not_found' })) })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 400 }, ACTOR, SCOPE)
    expect(row).toMatchObject({ valueStatus: 'none', unitAmount: '400', instanceAmount: null, currencyCode: 'USD', errorCode: 'CURRENCY_NO_RATE', fxRate: null, fxRateSource: null })
  })
  it('a note-only edit of a none + CURRENCY_NO_RATE line keeps it as it is (no FX_NOT_ALLOWED, no re-rate)', async () => {
    const row = usdRow({ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', instanceAmount: null, fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null })
    const fx = jest.fn(async () => FX_NEW)
    const { service } = setup({ costs: [row], fx })
    await service.updateCost(ids.quote, ids.cost, { note: 'waiting for treasury' }, ACTOR, SCOPE)
    expect(fx).not.toHaveBeenCalled()
    expect(row).toMatchObject({ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', unitAmount: '300', note: 'waiting for treasury' })
  })
})

describe('deleteCost', () => {
  it('catalog lines are not deletable', async () => {
    const { service } = setup({ costs: [catalogRow()] })
    await expect(service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CATALOG_COST_NOT_DELETABLE' })
  })
  it('deletes a manual line and re-prices; the audit holds no amounts', async () => {
    const row = manualRow({ unitAmount: '4242.4200', supplierName: 'Hidden', note: 'private' })
    const { service, recalculate } = setup({ costs: [row] })
    const result = await service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE, 4)
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(recalculate).toHaveBeenCalled()
    const audit = JSON.stringify(result.audit)
    for (const leak of ['4242', 'Hidden', 'private']) expect(audit).not.toContain(leak)
  })
})

describe('markup overrides', () => {
  const input = { quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent' as const, markupValue: 30, note: 'deal desk' }
  it('creates, re-prices, then updates in place', async () => {
    const { service, overrides, recalculate } = setup()
    const first = await service.setMarkupOverride(ids.quote, input, ACTOR, SCOPE)
    expect(overrides).toHaveLength(1)
    expect(overrides[0]).toMatchObject({ chargeCode: 'tail', markupRule: 'markup_percent', markupValue: '30', note: 'deal desk', createdByUserId: ACTOR })
    expect(recalculate).toHaveBeenCalledTimes(1)
    expect(first.audit.after).toEqual({ id: expect.any(String), quoteLineId: ids.line, chargeCode: 'tail' })
    await service.setMarkupOverride(ids.quote, { ...input, markupValue: 40 }, ACTOR, SCOPE)
    expect(overrides).toHaveLength(1)
    expect(overrides[0].markupValue).toBe('40')
  })
  it('CHARGE_NOT_COST_PLUS / CHARGE_NOT_FOUND', async () => {
    const { service } = setup()
    await expect(service.setMarkupOverride(ids.quote, { ...input, chargeCode: 'fixed_fee' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CHARGE_NOT_COST_PLUS' })
    await expect(service.setMarkupOverride(ids.quote, { ...input, chargeCode: 'nope' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CHARGE_NOT_FOUND' })
  })
  it('validates the markup like a charge: target margin below 100, non-negative', async () => {
    const { service } = setup()
    await expect(service.setMarkupOverride(ids.quote, { ...input, markupRule: 'target_margin_percent', markupValue: 100 }, ACTOR, SCOPE)).rejects.toThrow()
    await expect(service.setMarkupOverride(ids.quote, { ...input, markupValue: -1 }, ACTOR, SCOPE)).rejects.toThrow()
    await expect(service.setMarkupOverride(ids.quote, { ...input, note: '' }, ACTOR, SCOPE)).rejects.toThrow()
  })
  it('clear soft-deletes, 404 when absent, stale revision refused', async () => {
    const row = { id: 'o', quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: '10', note: 'n', deletedAt: null }
    const { service, recalculate } = setup({ overrides: [row] })
    await expect(service.clearMarkupOverride(ids.quote, ids.line, 'tail', ACTOR, SCOPE, 1)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
    await service.clearMarkupOverride(ids.quote, ids.line, 'tail', ACTOR, SCOPE)
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(recalculate).toHaveBeenCalled()
    await expect(service.clearMarkupOverride(ids.quote, ids.line, 'tail', ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
  })
})

// Supplier sourcing: a manual VALUE write cancels the request (step 9); other edits leave the sourcing columns alone.
describe('manual value writes and the sourcing columns', () => {
  const SOURCING = { sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 2, requestedAt: new Date('2026-01-01'), requestedByUserId: 'u1',
    answeredAt: null, answeredByUserId: null, declineReason: null, proposedAmount: '70.0000' }
  const sourcingOf = (row: Row) => Object.fromEntries(Object.keys(SOURCING).map((key) => [key, row[key]]))

  it('a created manual cost starts not_requested with no request data', async () => {
    const { service, costs } = setup()
    await service.createCost(ids.quote, create, ACTOR, SCOPE)
    expect(costs[0].sourcingStatus).toBe('not_requested')
    for (const key of ['costRequestId', 'requestSeq', 'requestedAt', 'answeredAt', 'proposedAmount', 'declineReason']) expect(costs[0][key] ?? null).toBeNull()
  })

  it('entering or overwriting a value cancels the open request (manual_value), clears the proposal and publishes request_cancelled (MODIFIED, step 9)', async () => {
    const publisher = jest.fn()
    const row = catalogRow({ valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, currencyCode: null, requestHistory: [], ...SOURCING })
    const { service } = setup({ costs: [row], publisher })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 280, valueStatus: 'confirmed', note: 'phone quote' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ unitAmount: '280', valueOrigin: 'manual', valueStatus: 'confirmed', sourcingStatus: 'cancelled', cancelReason: 'manual_value', costRequestId: 'req-1', proposedAmount: null, proposedAnswer: null, lastAnswerHash: null })
    expect(row.requestHistory).toEqual([expect.objectContaining({ outcome: 'cancelled', reason: 'manual_value' })])
    expect(publisher).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'request_cancelled', costRequestId: 'req-1', reason: 'manual_value', costLineId: ids.cost }),
      // Q11: a manual value write is a sourcing-relevant value change.
      expect.objectContaining({ kind: 'valued', cause: 'manual_value', valueStatus: 'confirmed', previousValueStatus: 'none', valueChanged: true, answerPending: false, costLineId: ids.cost }),
    ], expect.anything())
    expect(JSON.stringify(publisher.mock.calls)).not.toMatch(/280/)
  })

  it('hands the signal sink to the saved recalculation, so R1a / R1b signals of a cost write are published too (step 12 gap)', async () => {
    const publisher = jest.fn()
    const row = catalogRow({ unitAmount: '100', instanceAmount: '100' })
    const { service, recalculate } = setup({ costs: [row], publisher })
    const dropped = { kind: 'request_cancelled', costRequestId: 'req-9', requestSeq: 1, reason: 'reconfigured', costLineId: 'other' }
    recalculate.mockImplementationOnce((async (_em: unknown, _quote: unknown, _scope: unknown, _save: unknown, _adj: unknown, sourcing: { signals?: unknown[] }) => {
      sourcing.signals?.push(dropped)
      return {}
    }) as never)
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 90, valueStatus: 'confirmed', note: 'phone quote' }, ACTOR, SCOPE)
    expect((recalculate.mock.calls[0] as unknown[])[5]).toEqual({ signals: expect.any(Array) })
    const [signals] = publisher.mock.calls[0] as [Array<{ kind: string }>]
    expect(signals).toContain(dropped)
    expect(signals.filter((signal) => signal.kind === 'valued')).toHaveLength(1)
  })

  it('a note-only edit publishes nothing', async () => {
    const publisher = jest.fn()
    const row = catalogRow({ unitAmount: '100', instanceAmount: '100' })
    const { service } = setup({ costs: [row], publisher })
    await service.updateCost(ids.quote, ids.cost, { note: 'remark' }, ACTOR, SCOPE)
    expect(publisher).not.toHaveBeenCalled()
  })

  it('a manual value on a line holding an unapplied proposal clears the proposal and keeps the closed request status', async () => {
    const row = manualRow({ unitAmount: '100', instanceAmount: '100', sourcingStatus: 'answered', costRequestId: 'req-1', requestSeq: 2, proposedAmount: '70.0000', proposedAnswer: { unitAmount: '70' } })
    const { service } = setup({ costs: [row], status: 'ready' })
    await service.updateCost(ids.quote, ids.cost, { unitAmount: 90 }, ACTOR, SCOPE)
    expect(row).toMatchObject({ unitAmount: '90', sourcingStatus: 'answered', proposedAmount: null, proposedAnswer: null })
  })

  it('a note-only edit and a supplier-data edit leave the sourcing columns untouched (no value written)', async () => {
    const row = manualRow(SOURCING)
    const { service } = setup({ costs: [row] })
    await service.updateCost(ids.quote, ids.cost, { note: 'n', supplierName: 'Other' }, ACTOR, SCOPE)
    expect(row).toMatchObject({ note: 'n', supplierName: 'Other' })
    expect(sourcingOf(row)).toEqual(SOURCING)
  })

  it('deleting a manual line cancels its open request (line_removed), clears the proposal and publishes request_cancelled', async () => {
    const publisher = jest.fn()
    const row = manualRow({ requestHistory: [], ...SOURCING, proposedAnswer: { unitAmount: '70' } })
    const { service } = setup({ costs: [row], publisher })
    await service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE)
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(row).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'line_removed', costRequestId: 'req-1', proposedAmount: null, proposedAnswer: null })
    expect(row.requestHistory).toEqual([expect.objectContaining({ outcome: 'cancelled', reason: 'line_removed' })])
    expect(publisher).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'request_cancelled', costRequestId: 'req-1', reason: 'line_removed', costLineId: ids.cost }),
    ], expect.anything())
  })
  it('deleting a manual line without a request publishes nothing', async () => {
    const publisher = jest.fn()
    const { service } = setup({ costs: [manualRow()], publisher })
    await service.deleteCost(ids.quote, ids.cost, ACTOR, SCOPE)
    expect(publisher).not.toHaveBeenCalled()
  })
})

describe('preview: fxFrom rate hint (cost dialog)', () => {
  it('answers the rate a currency converts at, with no offering and no charges; nothing is stored', async () => {
    const fx = jest.fn(async () => FX_OK)
    const { service, em } = setup({ fx })
    const body = await service.preview({ fxFrom: 'USD', currencyCode: 'EUR', configuration: {} }, SCOPE)
    expect(body).toEqual({ currencyCode: 'EUR', charges: [], fxHint: { from: 'USD', to: 'EUR', fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'direct' } })
    expect(fx).toHaveBeenCalledWith(expect.objectContaining({ from: 'USD', to: 'EUR' }))
    expect(em.persist).not.toHaveBeenCalled()
  })
  it('names the missing pair when no rate exists, and answers null for the quote currency', async () => {
    const { service } = setup({ fx: jest.fn(async () => ({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'not_found' })) })
    const body = await service.preview({ fxFrom: 'USD', currencyCode: 'EUR', configuration: {} }, SCOPE) as { fxHint: Record<string, unknown> }
    expect(body.fxHint).toMatchObject({ from: 'USD', to: 'EUR', error: 'CURRENCY_NO_RATE', errorDetail: { code: 'CURRENCY_NO_RATE', from: 'USD', to: 'EUR' } })
    const same = await service.preview({ fxFrom: 'EUR', currencyCode: 'EUR', configuration: {} }, SCOPE) as { fxHint?: unknown }
    expect(same.fxHint).toBeUndefined()
  })
  it('still requires exactly one of offeringId / productId unless only fxFrom is sent', async () => {
    const { service } = setup({ fx: jest.fn(async () => FX_OK) })
    await expect(service.preview({ configuration: {} } as never, SCOPE)).rejects.toBeDefined()
    await expect(service.preview({ offeringId: ids.line, productId: ids.line, configuration: {} } as never, SCOPE)).rejects.toBeDefined()
  })
})
