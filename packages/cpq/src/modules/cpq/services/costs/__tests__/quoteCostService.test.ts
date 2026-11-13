import {
  CpqOrderConfiguration, CpqProductCharge, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride,
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
  const em: Row = {
    __quote: quote,
    fork: jest.fn(() => em),
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
  return { service, em, quote, costs, overrides, recalculate }
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
})
