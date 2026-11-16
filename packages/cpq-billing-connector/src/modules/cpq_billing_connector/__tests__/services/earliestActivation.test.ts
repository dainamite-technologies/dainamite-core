import { CpqBillingOrderSetupService } from '../../services/orderSetupService'

const scope = { tenantId: 't-1', organizationId: 'o-1' }
const ORDER = '22222222-2222-4222-8222-222222222222'

function setup(options: { quoteType: string; sourceQuoteId?: string | null; items?: Array<Record<string, unknown>>; failBilling?: boolean }) {
  const em = {
    fork: () => em,
    findOne: jest.fn(async () => null),
    find: jest.fn(async (_entity: unknown, _where: Record<string, unknown>) => {
      if (options.failBilling) throw new Error('billing down')
      return options.items ?? []
    }),
  }
  const cpqOrderService = {
    getOrder: jest.fn(async () => ({
      id: ORDER,
      orderNumber: 'SO-1',
      customerId: 'c-1',
      cpqStatus: 'pending_activation',
      currencyCode: 'EUR',
      quoteType: options.quoteType,
      sourceQuoteId: options.sourceQuoteId === undefined ? 'quote-cfg-1' : options.sourceQuoteId,
      lines: [],
    })),
    getOrderCustomerFields: jest.fn(async () => ({})),
  }
  const cpqQuotingService = {
    listTargetSubscriptions: jest.fn(async () => [
      { subscriptionId: 'sub-1', quoteType: options.quoteType },
      { subscriptionId: 'sub-1', quoteType: options.quoteType },
    ]),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'cpqOrderService') return cpqOrderService
      if (name === 'cpqQuotingService') return cpqQuotingService
      if (name === 'em') return em
      if (name === 'commandBus') return {}
      throw new Error(`unexpected resolve ${name}`)
    },
  }
  const service = new CpqBillingOrderSetupService({ em: em as never, container: container as never })
  return { service, em, cpqQuotingService }
}

const items = [
  { subscriptionId: 'sub-1', description: 'Fiber 300', billStartDate: new Date('2026-10-01T00:00:00Z'), billEndDate: null, isActive: true },
  { subscriptionId: 'sub-1', description: 'Static IP', billStartDate: new Date('2026-11-20T00:00:00Z'), billEndDate: null, isActive: true },
]

describe('order-setup read model — earliest activation date', () => {
  it('reads the quote targets, then their billing items in one query, for an amend order', async () => {
    const { service, em, cpqQuotingService } = setup({ quoteType: 'amend', items })
    const view = await service.getView(scope, ORDER)
    expect(cpqQuotingService.listTargetSubscriptions).toHaveBeenCalledWith('quote-cfg-1', scope)
    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.find.mock.calls[0][1]).toMatchObject({ subscriptionId: { $in: ['sub-1'] } })
    expect(view.earliestActivationDate).toBe('2026-11-20')
    expect(view.earliestActivationReason).toEqual({ subscriptionId: 'sub-1', itemDescription: 'Static IP' })
  })

  it('returns nulls without reading targets for renewals and new business', async () => {
    for (const quoteType of ['renew', 'new']) {
      const { service, cpqQuotingService } = setup({ quoteType, items })
      const view = await service.getView(scope, ORDER)
      expect(view.earliestActivationDate).toBeNull()
      expect(view.earliestActivationReason).toBeNull()
      expect(cpqQuotingService.listTargetSubscriptions).not.toHaveBeenCalled()
    }
  })

  it('returns nulls for an order without a source quote', async () => {
    const { service } = setup({ quoteType: 'cancel', sourceQuoteId: null, items })
    expect((await service.getView(scope, ORDER)).earliestActivationDate).toBeNull()
  })

  it('hides the hint instead of failing the view when billing cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = setup({ quoteType: 'amend', failBilling: true })
    const view = await service.getView(scope, ORDER)
    expect(view.earliestActivationDate).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resolveEarliestActivationForOrder propagates read failures (the guard decides)', async () => {
    const { service } = setup({ quoteType: 'amend', failBilling: true })
    await expect(service.resolveEarliestActivationForOrder(scope, ORDER)).rejects.toThrow('billing down')
  })
})
