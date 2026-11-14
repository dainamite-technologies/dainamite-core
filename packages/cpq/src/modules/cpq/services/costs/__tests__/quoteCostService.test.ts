import {
  CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscription, CpqInventorySubscriptionItem, CpqOrderConfiguration, CpqProductCharge, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride,
} from '../../../data/entities'

jest.mock('../../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: async (em: any, quoteId: string, _scope: unknown, execute: any, makeError: any, expectedRevision?: number) => {
    const quote = em.__quote
    if (!quote || quote.id !== quoteId) throw makeError(404, 'Quote not found')
    if (expectedRevision !== undefined && expectedRevision !== (quote.pricingRevision ?? 0)) throw makeError(409, 'STALE_REVISION')
    quote.pricingRevision = (quote.pricingRevision ?? 0) + 1
    return execute(em, quote)
  },
}))
import { CpqQuoteCostService } from '../quoteCostService'
import { COST_CLOSED_STATUSES } from '../costLock'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const ids = { quote: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', cost: '33333333-3333-4333-8333-333333333333' }
type Row = Record<string, any>

function setup(opts: { status?: string; orders?: number; costs?: Row[]; overrides?: Row[]; line?: Row; charges?: Row[]; enabled?: boolean } = {}) {
  const quote = { id: ids.quote, quoteId: ids.quote, cpqStatus: opts.status ?? 'ready', quoteType: 'new', currencyCode: 'EUR', pricingRevision: 4, quoteContext: {} }
  const line = { id: 'l', quoteLineId: ids.line, ...SCOPE, quoteConfigurationId: ids.quote, offeringId: 'off', productId: 'prod', configuration: {}, quantity: '1', charges: [], termMonths: 12, parentLineId: null, deletedAt: null, ...opts.line }
  const charges = opts.charges ?? [
    { code: 'tail', pricingMethod: 'cost_plus', chargeType: 'mrc', quantityAttributeCode: 'qty', offeringId: 'off' },
    { code: 'fixed_fee', pricingMethod: 'fixed', chargeType: 'nrc', quantityAttributeCode: null, offeringId: 'off' },
  ]
  const costs: Row[] = opts.costs ?? []
  const overrides: Row[] = opts.overrides ?? []
  const live = <T extends Row>(rows: T[]) => rows.filter((row) => !row.deletedAt)
  const subquery: Row = { select: jest.fn(() => subquery), where: jest.fn(() => subquery) }
  const em: Row = {
    __quote: quote,
    fork: jest.fn(() => em),
    createQueryBuilder: jest.fn(() => subquery),
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteLineConfiguration) return where.quoteLineId === ids.line ? line : null
      if (entity === CpqProductCharge) return charges.find((charge) => charge.code === where.code) ?? null
      if (entity === CpqQuoteLineCost) return live(costs).find((row) => row.id === where.id) ?? null
      if (entity === CpqQuoteMarkupOverride) return live(overrides).find((row) => row.quoteLineId === where.quoteLineId && row.chargeCode === where.chargeCode) ?? null
      if (entity === CpqQuoteConfiguration) return quote
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
  }
  const recalculate = jest.fn(async () => ({}))
  const service = new CpqQuoteCostService({
    em: em as never,
    costService: { enabled: jest.fn(async () => opts.enabled ?? true) },
    quotingService: { recalculateLockedQuote: recalculate } as never,
  })
  return { service, em, quote, costs, overrides, recalculate, subquery }
}

const catalogRow = (over: Row = {}): Row => ({
  id: ids.cost, ...SCOPE, quoteConfigurationId: ids.quote, quoteLineId: ids.line, costKey: 'tail', chargeCode: 'tail', origin: 'catalog',
  costElementId: 'el', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'on_request', costModel: 'flat', valueStatus: 'estimated',
  valueOrigin: 'catalog', unitAmount: '300.0000', instanceAmount: '300.0000', currencyCode: 'EUR', supplierName: 'Acme', supplierQuoteRef: null,
  validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null, errorCode: null, deletedAt: null, ...over,
})
const manualRow = (over: Row = {}) => catalogRow({ costKey: 'manual:abcd1234', origin: 'manual', costElementId: null, valueOrigin: 'manual', source: 'fixed', valueStatus: 'confirmed', ...over })
const create = { quoteLineId: ids.line, name: 'Special build', role: 'margin_only' as const, costType: 'nrc' as const, source: 'fixed' as const, costModel: 'flat' as const, unitAmount: 1500 }
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
    expect(body).toEqual({ lines: [{ quoteLineId: ids.line, costs: [{ id: ids.cost, costKey: 'tail', name: 'Tail', role: 'price_basis', valueStatus: 'estimated', expired: true }] }], pricingRevision: 4 })
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
    await expect(service.usage(SCOPE)).resolves.toEqual({ enabled: false, costPlusCharges: 0, openQuotes: 0, openRequests: 0, liveSubscriptions: 0 })
  })
  it('usage counts with one aggregate query per figure: no cost row hydrated, no bound id list', async () => {
    const { service, em, subquery } = setup({ costs: [catalogRow()] })
    em.count.mockImplementation(async (entity: unknown) => (entity === CpqProductCharge ? 3 : entity === CpqQuoteConfiguration ? 2 : entity === CpqInventorySubscription ? 4 : 0))
    await expect(service.usage(SCOPE)).resolves.toEqual({ enabled: true, costPlusCharges: 3, openQuotes: 2, openRequests: 0, liveSubscriptions: 4 })
    expect(em.find).not.toHaveBeenCalled()
    expect(em.count).toHaveBeenCalledTimes(3)
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
    expect(em.createQueryBuilder).toHaveBeenCalledTimes(5)
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqQuoteLineCost, 'qlc')
    expect(em.createQueryBuilder).toHaveBeenCalledWith(CpqOrderConfiguration, 'oc')
    expect(subquery.select).toHaveBeenCalledWith('oc.sourceQuoteId')
    expect(subquery.select).toHaveBeenCalledWith('qlc.quoteConfigurationId')
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null })
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
  it('refuses a foreign-currency amount (no silent FX)', async () => {
    const { service } = setup()
    await expect(service.createCost(ids.quote, { ...create, currencyCode: 'USD' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CURRENCY_NO_RATE' })
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
    ['a Renew mirror line (re-priced at today\'s standard)', 'renew', mirrorConfig()],
    ['a reconfigured (unfrozen) Amend mirror line', 'amend', mirrorConfig()],
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

  it('creates no manual cost and no markup override on a non-frozen mirror line', async () => {
    const { service, costs } = arc('renew', mirrorConfig(), [])
    await expect(service.createCost(ids.quote, create, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    const input = { quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent' as const, markupValue: 30, note: 'deal' }
    await expect(service.setMarkupOverride(ids.quote, input, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
    expect(costs).toHaveLength(0)
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
