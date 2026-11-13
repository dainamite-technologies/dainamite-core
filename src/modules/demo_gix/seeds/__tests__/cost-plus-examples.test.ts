import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { FeatureToggle, FeatureToggleOverride } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { CpqChargeCostElement, CpqPricingTable, CpqProductCharge, CpqProductOffering, CpqQuoteConfiguration } from '@dainamite/cpq/modules/cpq/data/entities'
import { COST_PLUS_SCENARIOS, CROSS_CONNECT_COST_TABLE, IP_TRANSIT } from '../data/cost-plus'
import { enableGixCostPlus, seedGixCostPlusCatalog, seedGixCostPlusExamples } from '../cost-plus-examples'

jest.mock('@dainamite/cpq/modules/cpq/lib/costPlusDefaults', () => ({ seedCostPlusDefaults: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async (em: { find: (...a: unknown[]) => unknown }, entity: unknown, where: unknown) => em.find(entity, where)) }))

const scope = { tenantId: 't', organizationId: 'o' }

/** Minimal in-memory EntityManager: rows keyed per entity class, subset matching on `where`. */
function fakeEm() {
  const store = new Map<unknown, Array<Record<string, unknown>>>()
  const rows = (entity: unknown) => store.get(entity) ?? []
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = row[key] ?? null // entities default nullable columns to null
      if (value !== null && typeof value === 'object') {
        const id = (value as { id?: unknown }).id
        return id !== undefined ? (actual as { id?: unknown } | null)?.id === id : JSON.stringify(actual) === JSON.stringify(value)
      }
      return actual === value
    })
  let seq = 0
  const em = {
    store,
    seed: (entity: unknown, row: Record<string, unknown>) => store.set(entity, [...rows(entity), row]),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => rows(entity).find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => rows(entity).filter((row) => matches(row, where))),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ id: `id-${++seq}`, ...data, __entity: entity })),
    persist: jest.fn((row: Record<string, unknown>) => { store.set(row.__entity, [...rows(row.__entity), row]) }),
    flush: jest.fn(async () => undefined),
  }
  return em
}

function quoteServices(em: ReturnType<typeof fakeEm>) {
  const quoting = {
    createQuote: jest.fn(async (input: { quoteContext: Record<string, unknown> }) => {
      const quote = { id: `q-${em.store.get(CpqQuoteConfiguration)?.length ?? 0}`, quoteContext: input.quoteContext, lines: [] }
      em.seed(CpqQuoteConfiguration, { id: quote.id, customerId: 'acme', deletedAt: null, tenantId: 't', organizationId: 'o', quoteContext: input.quoteContext })
      return quote
    }),
    addQuoteItem: jest.fn(async (id: string) => ({ id, lines: [{ lineId: 'l1' }] })),
  }
  const costs = {
    read: jest.fn(async () => ({ lines: [{ quoteLineId: 'l1', costs: [{ id: 'c-tail', costKey: 'partner_tail' }, { id: 'c-x', costKey: 'cross_connect' }] }] })),
    updateCost: jest.fn(async (..._args: unknown[]) => ({})),
  }
  const toggles = { invalidateIsEnabledCacheByKey: jest.fn(async () => undefined) }
  const container = { resolve: (name: string) => ({ cpqQuotingService: quoting, cpqQuoteCostService: costs, featureTogglesService: toggles })[name] }
  return { quoting, costs, toggles, container }
}

function seededEm() {
  const em = fakeEm()
  em.seed(FeatureToggle, { id: 'ft', identifier: 'cpq.cost_plus' })
  em.seed(CustomerEntity, { id: 'acme', displayName: 'Acme Telecom S.A.', kind: 'company', deletedAt: null, tenantId: 't', organizationId: 'o' })
  return em
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

describe('enableGixCostPlus', () => {
  it('adds a tenant override turning cpq.cost_plus on and clears the toggle cache', async () => {
    const em = seededEm()
    const { container, toggles } = quoteServices(em)
    await enableGixCostPlus(em as never, container as never, scope)
    const overrides = em.store.get(FeatureToggleOverride) ?? []
    expect(overrides).toHaveLength(1)
    expect(overrides[0]).toMatchObject({ tenantId: 't', value: true })
    expect(toggles.invalidateIsEnabledCacheByKey).toHaveBeenCalledWith('cpq.cost_plus', 't')
  })

  it('never touches an existing override (an operator may have turned it off)', async () => {
    const em = seededEm()
    em.seed(FeatureToggleOverride, { toggle: { id: 'ft', identifier: 'cpq.cost_plus' }, tenantId: 't', value: false })
    const { container } = quoteServices(em)
    await enableGixCostPlus(em as never, container as never, scope)
    expect(em.store.get(FeatureToggleOverride)).toHaveLength(1)
    expect(em.create).not.toHaveBeenCalled()
  })
})

describe('seedGixCostPlusCatalog', () => {
  it('creates the cost table, the cost-plus charge and its three cost elements', async () => {
    const em = seededEm()
    await seedGixCostPlusCatalog(em as never, quoteServices(em).container as never, scope)
    expect(em.store.get(CpqPricingTable)?.[0]).toMatchObject({ code: CROSS_CONNECT_COST_TABLE.code, purpose: 'cost' })
    expect(em.store.get(CpqProductCharge)?.[0]).toMatchObject({ pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: '25', chargeType: 'mrc' })
    const elements = em.store.get(CpqChargeCostElement) ?? []
    expect(elements.map((element) => [element.code, element.role, element.source])).toEqual([
      ['cross_connect', 'price_basis', 'table'],
      ['partner_tail', 'price_basis', 'on_request'],
      ['noc_monitoring', 'margin_only', 'fixed'],
    ])
    expect(elements[1]).toMatchObject({ estimateAmount: '100' })
    expect(elements[0]).toMatchObject({ costTableId: em.store.get(CpqPricingTable)?.[0].id, costColumnKey: 'mrc' })
  })

  it('is idempotent: a second run creates nothing', async () => {
    const em = seededEm()
    const { container } = quoteServices(em)
    await seedGixCostPlusCatalog(em as never, container as never, scope)
    const counts = () => [...em.store.entries()].map(([entity, list]) => [entity, list.length])
    const before = counts()
    em.create.mockClear()
    await seedGixCostPlusCatalog(em as never, container as never, scope)
    expect(em.create).not.toHaveBeenCalled()
    expect(counts()).toEqual(before)
  })
})

describe('seedGixCostPlusExamples', () => {
  it('creates one quote per cost state and confirms the partner tail on the confirmed and expired ones', async () => {
    const em = seededEm()
    em.seed(CpqProductOffering, { id: 'offer', code: IP_TRANSIT.offerCode, deletedAt: null, tenantId: 't', organizationId: 'o' })
    const { quoting, costs, container } = quoteServices(em)
    await seedGixCostPlusExamples(em as never, container as never, scope)
    expect(quoting.createQuote).toHaveBeenCalledTimes(4)
    const scenarios = quoting.createQuote.mock.calls.map(([input]) => input.quoteContext.scenario)
    expect(scenarios).toEqual(Object.values(COST_PLUS_SCENARIOS).map((demo) => demo.scenario))
    expect(quoting.addQuoteItem).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ offeringId: 'offer', configuration: { data_centre: 'equinix-sg1' } }), scope)
    expect(costs.updateCost).toHaveBeenCalledTimes(2)
    const [confirmed, expired] = costs.updateCost.mock.calls.map((call) => call[2] as { valueStatus: string; validUntil: string; unitAmount: number })
    expect(confirmed).toMatchObject({ valueStatus: 'confirmed', unitAmount: 110 })
    expect(expired).toMatchObject({ valueStatus: 'confirmed', unitAmount: 105 })
    expect(expired.validUntil < new Date().toISOString().slice(0, 10)).toBe(true)
    expect(confirmed.validUntil > new Date().toISOString().slice(0, 10)).toBe(true)
  })

  it('is idempotent: existing scenarios are skipped on a second run', async () => {
    const em = seededEm()
    em.seed(CpqProductOffering, { id: 'offer', code: IP_TRANSIT.offerCode, deletedAt: null, tenantId: 't', organizationId: 'o' })
    const { quoting, costs, container } = quoteServices(em)
    await seedGixCostPlusExamples(em as never, container as never, scope)
    quoting.createQuote.mockClear()
    costs.updateCost.mockClear()
    await seedGixCostPlusExamples(em as never, container as never, scope)
    expect(quoting.createQuote).not.toHaveBeenCalled()
    expect(costs.updateCost).not.toHaveBeenCalled()
  })

  it.each([['Acme is missing', 'acme'], ['the offering is missing', 'offering']])('is a no-op when %s', async (_label, missing) => {
    const em = fakeEm()
    if (missing !== 'acme') em.seed(CustomerEntity, { id: 'acme', displayName: 'Acme Telecom S.A.', kind: 'company', deletedAt: null, tenantId: 't', organizationId: 'o' })
    const { quoting, container } = quoteServices(em)
    await seedGixCostPlusExamples(em as never, container as never, scope)
    expect(quoting.createQuote).not.toHaveBeenCalled()
  })
})
