import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CpqQuoteConfiguration } from '@dainamite/cpq/modules/cpq/data/entities'
import { ARC_COST_DEMO } from '../data/cost-plus'
import { seedGixCostArcExamples } from '../cost-arc-examples'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async (em: { find: (...a: unknown[]) => unknown }, entity: unknown, where: unknown) => em.find(entity, where)) }))

const scope = { tenantId: 't', organizationId: 'o' }
type Row = Record<string, unknown>

function setup(opts: { customer?: boolean; tail?: boolean; subscription?: boolean } = {}) {
  const quotes: Row[] = []
  const em = {
    // Catalog lookups find an existing row so only the quote / order / subscription path runs.
    findOne: jest.fn(async (_entity: unknown, where: Row) => ({ id: 'catalog-row', ...where })),
    find: jest.fn(async (entity: unknown) => {
      if (entity === CustomerEntity) return opts.customer === false ? [] : [{ id: 'acme', displayName: 'Acme Telecom S.A.' }]
      return entity === CpqQuoteConfiguration ? quotes : []
    }),
    create: jest.fn((entity: unknown, data: Row) => ({ __entity: entity, ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  const calls: string[] = []
  const quoting = {
    createQuote: jest.fn(async (input: { quoteContext: Row }) => { quotes.push({ id: 'q-1', quoteContext: input.quoteContext }); return { id: 'q-1', cpqStatus: 'draft' } }),
    addQuoteItem: jest.fn(async () => ({ id: 'q-1', cpqStatus: 'draft' })),
    recalculate: jest.fn(async () => ({ id: 'q-1', cpqStatus: 'ready' })),
    transitionStatus: jest.fn(async (_id: string, target: string) => { calls.push(`status:${target}`); return { id: 'q-1', cpqStatus: target } }),
  }
  const costs = {
    read: jest.fn(async () => ({ lines: [{ costs: opts.tail === false ? [] : [{ id: 'cost-1', costKey: ARC_COST_DEMO.tailElementCode }] }] })),
    updateCost: jest.fn(async () => { calls.push('supplier-term'); return {} }),
  }
  const orders = {
    convertQuoteToOrder: jest.fn(async () => { calls.push('convert'); return { id: 'o-1' } }),
    activateOrder: jest.fn(async () => { calls.push('activate'); return { id: 'o-1' } }),
  }
  const inventory = {
    listSubscriptions: jest.fn(async () => ({ items: opts.subscription === false ? [] : [{ id: 'sub-1' }] })),
    transitionSubscriptionStatus: jest.fn(async () => { calls.push('sub-active') }),
    updateSubscription: jest.fn(async () => { calls.push('term-end') }),
  }
  const services: Record<string, unknown> = { cpqQuotingService: quoting, cpqQuoteCostService: costs, cpqOrderService: orders, cpqInventoryService: inventory }
  return { em, quotes, quoting, costs, orders, inventory, calls, container: { resolve: (name: string) => services[name] } }
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

describe('seedGixCostArcExamples', () => {
  it('seeds one live subscription whose supplier term ends before its renewal, through the services', async () => {
    const t = setup()
    await seedGixCostArcExamples(t.em as never, t.container as never, scope)
    expect(t.quoting.createQuote.mock.calls[0][0]).toMatchObject({ customerId: 'acme', currencyCode: 'USD', quoteContext: { scenario: ARC_COST_DEMO.scenario } })
    // A valid quote is already ready after the saved recalculation. The supplier term is written on the quote cost line before the quote moves on, then order → subscription active → term end.
    expect(t.calls).toEqual(['supplier-term', 'status:with_customer', 'status:accepted', 'convert', 'activate', 'sub-active', 'term-end'])
    const patch = (t.costs.updateCost.mock.calls[0] as unknown[])[2] as { supplierTermEnd: string; note: string }
    const termEnd = (t.inventory.updateSubscription.mock.calls[0] as unknown[])[1] as { currentTermEnd: string }
    expect(patch.supplierTermEnd < termEnd.currentTermEnd).toBe(true)
    expect(patch.note).toBeTruthy()
    expect(t.inventory.listSubscriptions).toHaveBeenCalledWith({ customerId: 'acme', sourceOrderId: 'o-1' }, scope)
  })

  it('is idempotent: a quote with the scenario marker skips everything', async () => {
    const t = setup()
    await seedGixCostArcExamples(t.em as never, t.container as never, scope)
    await seedGixCostArcExamples(t.em as never, t.container as never, scope)
    expect(t.quoting.createQuote).toHaveBeenCalledTimes(1)
    expect(t.orders.activateOrder).toHaveBeenCalledTimes(1)
  })

  it('skips when the demo customer is missing', async () => {
    const t = setup({ customer: false })
    await seedGixCostArcExamples(t.em as never, t.container as never, scope)
    expect(t.quoting.createQuote).not.toHaveBeenCalled()
  })

  it('leaves the quote as is when the partner tail was not resolved (no order is created)', async () => {
    const t = setup({ tail: false })
    await seedGixCostArcExamples(t.em as never, t.container as never, scope)
    expect(t.orders.convertQuoteToOrder).not.toHaveBeenCalled()
  })

  it('does not move a subscription it cannot find', async () => {
    const t = setup({ subscription: false })
    await seedGixCostArcExamples(t.em as never, t.container as never, scope)
    expect(t.inventory.transitionSubscriptionStatus).not.toHaveBeenCalled()
  })
})
