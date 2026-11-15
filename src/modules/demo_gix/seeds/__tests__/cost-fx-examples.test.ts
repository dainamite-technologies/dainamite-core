import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { ExchangeRate } from '@open-mercato/core/modules/currencies/data/entities'
import { CpqProductOffering, CpqQuoteConfiguration } from '@dainamite/cpq/modules/cpq/data/entities'
import { FX_DEMO } from '../data/cost-plus'
import { seedGixCostFxExamples, seedGixDemoFxRates, utcMidnight } from '../cost-fx-examples'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async (em: { find: (...a: unknown[]) => unknown }, entity: unknown, where: unknown) => em.find(entity, where)) }))

const scope = { tenantId: 't', organizationId: 'o' }
type Row = Record<string, unknown>

/** In-memory EM: rate rows and quotes are stored; catalog lookups find an existing offering so only the rate / quote paths run. */
function setup(opts: { customer?: boolean } = {}) {
  const rates: Row[] = []
  const quotes: Row[] = []
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => (value instanceof Date ? (row[key] as Date)?.getTime() === value.getTime() : row[key] === value))
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === ExchangeRate) return rates.find((row) => matches(row, where)) ?? null
      return { id: 'catalog-row', ...where }
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === CustomerEntity) return opts.customer === false ? [] : [{ id: 'acme', displayName: 'Acme Telecom S.A.' }]
      return entity === CpqQuoteConfiguration ? quotes : []
    }),
    create: jest.fn((entity: unknown, data: Row) => ({ __entity: entity, ...data })),
    persist: jest.fn((row: Row) => { if (row.__entity === ExchangeRate) rates.push(row) }),
    flush: jest.fn(async () => undefined),
  }
  let seq = 0
  const quoting = {
    createQuote: jest.fn(async (input: { quoteContext: Row }) => { const id = `q-${++seq}`; quotes.push({ id, quoteContext: input.quoteContext }); return { id } }),
    addQuoteItem: jest.fn(async (id: string) => ({ id })),
    recalculate: jest.fn(async (id: string) => ({ id })),
  }
  const container = { resolve: (name: string) => ({ cpqQuotingService: quoting })[name] }
  return { em, rates, quotes, quoting, container }
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

describe('utcMidnight', () => {
  it('is the UTC calendar day, not local time', () => {
    expect(utcMidnight(0, new Date('2026-11-15T23:30:00Z')).toISOString()).toBe('2026-11-15T00:00:00.000Z')
    expect(utcMidnight(-2, new Date('2026-11-15T00:10:00Z')).toISOString()).toBe('2026-11-13T00:00:00.000Z')
  })
})

describe('seedGixDemoFxRates', () => {
  const now = new Date('2026-11-15T10:00:00Z')

  it('writes one USD→EUR rate per day for the last three days, source Manual, at UTC midnight', async () => {
    const t = setup()
    await seedGixDemoFxRates(t.em as never, scope, now)
    expect(t.rates.map((row) => [(row.date as Date).toISOString(), row.rate])).toEqual([
      ['2026-11-15T00:00:00.000Z', '0.92000000'],
      ['2026-11-14T00:00:00.000Z', '0.91500000'],
      ['2026-11-13T00:00:00.000Z', '0.91000000'],
    ])
    expect(t.rates.every((row) => row.source === 'Manual' && row.fromCurrencyCode === 'USD' && row.toCurrencyCode === 'EUR' && row.tenantId === 't' && row.organizationId === 'o' && row.isActive === true)).toBe(true)
  })

  it('is idempotent and never overwrites an existing row of the same day and source', async () => {
    const t = setup()
    await seedGixDemoFxRates(t.em as never, scope, now)
    t.rates[0].rate = '0.99000000'
    await seedGixDemoFxRates(t.em as never, scope, now)
    expect(t.rates).toHaveLength(3)
    expect(t.rates[0].rate).toBe('0.99000000')
  })

  it('adds only the new day on a later run', async () => {
    const t = setup()
    await seedGixDemoFxRates(t.em as never, scope, now)
    await seedGixDemoFxRates(t.em as never, scope, new Date('2026-11-16T09:00:00Z'))
    expect(t.rates).toHaveLength(4)
  })
})

describe('seedGixCostFxExamples', () => {
  it('seeds the rates and one EUR quote with the USD tail, priced by a saved recalculation', async () => {
    const t = setup()
    await seedGixCostFxExamples(t.em as never, t.container as never, scope)
    expect(t.rates).toHaveLength(3)
    expect(t.quoting.createQuote).toHaveBeenCalledTimes(1)
    expect(t.quoting.createQuote.mock.calls[0][0]).toMatchObject({ customerId: 'acme', currencyCode: 'EUR', quoteContext: { scenario: FX_DEMO.scenario } })
    expect(t.quoting.recalculate).toHaveBeenCalledWith('q-1', { save: true }, scope)
  })

  it('is idempotent: a second run adds no rate and no quote', async () => {
    const t = setup()
    await seedGixCostFxExamples(t.em as never, t.container as never, scope)
    await seedGixCostFxExamples(t.em as never, t.container as never, scope)
    expect(t.rates).toHaveLength(3)
    expect(t.quotes).toHaveLength(1)
  })

  it('still seeds the rates when the demo customer is missing, and creates no quote', async () => {
    const t = setup({ customer: false })
    await seedGixCostFxExamples(t.em as never, t.container as never, scope)
    expect(t.rates).toHaveLength(3)
    expect(t.quoting.createQuote).not.toHaveBeenCalled()
  })

  it('uses no cpq offering lookup shortcut: the offering is the demo one', async () => {
    const t = setup()
    await seedGixCostFxExamples(t.em as never, t.container as never, scope)
    const offeringLookups = t.em.findOne.mock.calls.filter((call) => call[0] === CpqProductOffering)
    expect(offeringLookups[0][1]).toMatchObject({ code: FX_DEMO.offerCode })
  })
})
