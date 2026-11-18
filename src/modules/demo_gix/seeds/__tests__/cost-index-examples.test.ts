import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CpqChargeCostElement, CpqCostIndex, CpqProductOffering, CpqQuoteConfiguration } from '@dainamite/cpq/modules/cpq/data/entities'
import { INDEX_DEMO } from '../data/cost-plus'
import { isoDayFrom, seedGixCostIndexExamples, seedGixDemoIndex } from '../cost-index-examples'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async (em: { find: (...a: unknown[]) => unknown }, entity: unknown, where: unknown) => em.find(entity, where)) }))

const scope = { tenantId: 't', organizationId: 'o' }
type Row = Record<string, unknown>
type ValueRow = { effectiveDate: string; value: number; revision: number }

/** In-memory EM + a fake costIndexService (the real one is covered by its own tests): the index, its values and the quotes are stored. */
function setup(opts: { customer?: boolean; failTransition?: boolean } = {}) {
  const indices: Row[] = []
  const values: ValueRow[] = []
  const elements: Row[] = []
  const quotes: Row[] = []
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqCostIndex) return indices.find((row) => row.code === where.code) ?? null
      if (entity === CpqChargeCostElement) return elements.find((row) => row.code === where.code) ?? null
      return { id: 'catalog-row', ...where }
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === CustomerEntity) return opts.customer === false ? [] : [{ id: 'acme', displayName: 'Acme Telecom S.A.' }]
      return entity === CpqQuoteConfiguration ? quotes : []
    }),
    create: jest.fn((entity: unknown, data: Row) => ({ __entity: entity, ...data })),
    persist: jest.fn((row: Row) => { if (row.__entity === CpqChargeCostElement) elements.push(row) }),
    flush: jest.fn(async () => undefined),
  }
  const append = (rows: Array<{ effectiveDate: string; value: number }>) => rows.map((row) => {
    const revision = Math.max(0, ...values.filter((v) => v.effectiveDate === row.effectiveDate).map((v) => v.revision)) + 1
    values.push({ effectiveDate: row.effectiveDate, value: row.value, revision })
    return { status: 'created', revision }
  })
  const indexService = {
    create: jest.fn(async (input: Row) => { indices.push({ id: 'idx-1', ...input }); return { id: 'idx-1' } }),
    listValues: jest.fn(async () => ({ total: values.length })),
    appendValues: jest.fn(async (_id: string, rows: Array<{ effectiveDate: string; value: number }>) => append(rows)),
    appendValue: jest.fn(async (_id: string, row: { effectiveDate: string; value: number }) => append([row])[0]),
  }
  let seq = 0
  const quoting = {
    createQuote: jest.fn(async (input: { quoteContext: Row }) => { const id = `q-${++seq}`; quotes.push({ id, quoteContext: input.quoteContext }); return { id } }),
    addQuoteItem: jest.fn(async (id: string) => ({ id })),
    recalculate: jest.fn(async (id: string) => ({ id, cpqStatus: 'ready' })),
    transitionStatus: jest.fn(async (id: string) => { if (opts.failTransition) throw new Error('409'); return { id } }),
    deleteQuote: jest.fn(async (id: string) => { quotes.splice(quotes.findIndex((q) => q.id === id), 1); return { ok: true } }),
  }
  const container = { resolve: (name: string) => ({ cpqQuotingService: quoting, cpqCostIndexService: indexService })[name] }
  return { em, indices, values, elements, quotes, quoting, indexService, container }
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

describe('isoDayFrom', () => {
  it('is the UTC calendar day, not local time', () => {
    expect(isoDayFrom(0, new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-15')
    expect(isoDayFrom(-30, new Date('2026-11-15T00:10:00Z'))).toBe('2026-10-16')
    expect(isoDayFrom(45, new Date('2026-11-15T12:00:00Z'))).toBe('2026-12-30')
  })
})

describe('seedGixDemoIndex', () => {
  const now = new Date('2026-11-15T10:00:00Z')

  it('creates DEMO-DC-POWER with three months of values, one same-date correction (r2) and one future value', async () => {
    const t = setup()
    await seedGixDemoIndex(t.em as never, t.container as never, scope, now)
    expect(t.indices).toHaveLength(1)
    expect(t.indices[0]).toMatchObject({ code: 'DEMO-DC-POWER', name: 'Demo data-centre power, EUR/MWh', unit: 'EUR/MWh', currencyCode: 'EUR' })
    const byDate = (date: string) => t.values.filter((v) => v.effectiveDate === date)
    expect(t.values.filter((v) => v.effectiveDate < '2026-11-15').length).toBeGreaterThanOrEqual(4)
    expect(t.values.some((v) => v.effectiveDate <= '2026-08-17')).toBe(true) // reaches back to three months
    // the correction: one date holds revisions 1 and 2
    const corrected = byDate(isoDayFrom(-30, now))
    expect(corrected.map((v) => [v.revision, v.value])).toEqual([[1, 98], [2, 99.5]])
    // the future value is strictly after the seed day and is the only one
    const future = t.values.filter((v) => v.effectiveDate > '2026-11-15')
    expect(future).toEqual([{ effectiveDate: isoDayFrom(INDEX_DEMO.future.days, now), value: 120, revision: 1 }])
    // today's value in force (latest date on or before the seed day, highest revision) is 100
    const inForce = t.values.filter((v) => v.effectiveDate <= '2026-11-15').sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : b.effectiveDate < a.effectiveDate ? -1 : b.revision - a.revision))[0]
    expect(inForce.value).toBe(100)
  })

  it('is idempotent: a second run, even on a later day, adds no index and no value', async () => {
    const t = setup()
    await seedGixDemoIndex(t.em as never, t.container as never, scope, now)
    const count = t.values.length
    await seedGixDemoIndex(t.em as never, t.container as never, scope, new Date('2026-12-20T09:00:00Z'))
    expect(t.indices).toHaveLength(1)
    expect(t.values).toHaveLength(count)
    expect(t.indexService.create).toHaveBeenCalledTimes(1)
  })

  it('tops up an index created by an interrupted run (no values yet) without creating it again', async () => {
    const t = setup()
    t.indices.push({ id: 'idx-1', code: 'DEMO-DC-POWER' })
    await seedGixDemoIndex(t.em as never, t.container as never, scope, now)
    expect(t.indexService.create).not.toHaveBeenCalled()
    expect(t.values.length).toBeGreaterThan(0)
  })
})

describe('seedGixCostIndexExamples', () => {
  it('seeds the index, an index price-basis element (factor 0.5) and two quotes: one ready, one moved to with_customer', async () => {
    const t = setup()
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    expect(t.elements).toHaveLength(1)
    expect(t.elements[0]).toMatchObject({ code: 'power_index', role: 'price_basis', source: 'index', costIndexId: 'idx-1', indexFactor: '0.5', indexOffset: '0' })
    expect(t.quoting.createQuote).toHaveBeenCalledTimes(2)
    const scenarios = t.quoting.createQuote.mock.calls.map((call) => (call[0].quoteContext as Row).scenario)
    expect(scenarios).toEqual([INDEX_DEMO.readyScenario, INDEX_DEMO.sentScenario])
    expect(t.quoting.createQuote.mock.calls[0][0]).toMatchObject({ customerId: 'acme', currencyCode: 'EUR' })
    expect(t.quoting.recalculate).toHaveBeenCalledTimes(2)
    // only the second quote is sent; the first stays `ready` (the saved recalculation settled it)
    expect(t.quoting.transitionStatus).toHaveBeenCalledTimes(1)
    expect(t.quoting.transitionStatus).toHaveBeenCalledWith('q-2', 'with_customer', scope)
  })

  it('is idempotent: a second run adds no index, value, element or quote', async () => {
    const t = setup()
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    const values = t.values.length
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    expect(t.indices).toHaveLength(1)
    expect(t.values).toHaveLength(values)
    expect(t.elements).toHaveLength(1)
    expect(t.quotes).toHaveLength(2)
  })

  it('creates only the missing quote when one scenario is already present', async () => {
    const t = setup()
    t.quotes.push({ id: 'old', quoteContext: { scenario: INDEX_DEMO.readyScenario } })
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    expect(t.quoting.createQuote).toHaveBeenCalledTimes(1)
    expect((t.quoting.createQuote.mock.calls[0][0].quoteContext as Row).scenario).toBe(INDEX_DEMO.sentScenario)
  })

  it('still seeds the index when the demo customer is missing, and creates no offering element and no quote', async () => {
    const t = setup({ customer: false })
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    expect(t.indices).toHaveLength(1)
    expect(t.values.length).toBeGreaterThan(0)
    expect(t.elements).toHaveLength(0)
    expect(t.quoting.createQuote).not.toHaveBeenCalled()
  })

  it('drops the half-built sent quote when it cannot be moved to with_customer, so the next run retries it', async () => {
    const t = setup({ failTransition: true })
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    expect(t.quoting.deleteQuote).toHaveBeenCalledWith('q-2', scope)
    expect(t.quotes.map((q) => (q.quoteContext as Row).scenario)).toEqual([INDEX_DEMO.readyScenario])
  })

  it('uses the dedicated offering, not the IP Transit one', async () => {
    const t = setup()
    await seedGixCostIndexExamples(t.em as never, t.container as never, scope)
    const lookups = t.em.findOne.mock.calls.filter((call) => call[0] === CpqProductOffering)
    expect(lookups[0][1]).toMatchObject({ code: INDEX_DEMO.offerCode })
  })
})
