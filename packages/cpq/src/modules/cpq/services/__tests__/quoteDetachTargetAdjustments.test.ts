import { randomUUID } from 'node:crypto'
import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment, CpqQuoteTargetSubscription } from '../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'

jest.mock('../../events', () => ({ emitCpqEvent: jest.fn().mockResolvedValue(undefined) }))
const scope = { tenantId: randomUUID(), organizationId: randomUUID() }

it('detaching an ARC target removes its lines and their adjustments under the pricing lock', async () => {
  const quoteId = randomUUID(), salesId = randomUUID(), lineId = randomUUID(), childId = randomUUID(), subscriptionId = randomUUID()
  const quote = { id: quoteId, quoteId: salesId, customerId: randomUUID(), cpqStatus: 'ready', quoteType: 'amend', version: 1, pricingRevision: 4, currencyCode: 'USD', ...scope }
  const line = { id: randomUUID(), quoteLineId: lineId, quoteConfigurationId: quoteId, offeringId: 'offer', parentLineId: null, targetSubscriptionId: subscriptionId, quantity: 1, configuration: {}, charges: [], deletedAt: null as Date | null, ...scope }
  const child = { ...line, id: randomUUID(), quoteLineId: childId, parentLineId: lineId, targetSubscriptionId: null }
  const adjustment = { id: randomUUID(), quoteConfigurationId: quoteId, quoteLineId: childId, deletedAt: null as Date | null, isActive: true, ...scope }
  const target = { id: randomUUID(), quoteId, subscriptionId, quoteType: 'amend', deletedAt: null as Date | null, ...scope }
  const salesLine = { id: lineId, deletedAt: null as Date | null, ...scope }
  const rows = new Map<unknown, Array<Record<string, unknown>>>([
    [CpqQuoteConfiguration, [quote]], [CpqQuoteLineConfiguration, [line, child]], [CpqQuotePriceAdjustment, [adjustment]],
    [CpqQuoteTargetSubscription, [target]], [SalesQuote, [{ id: salesId, quoteNumber: 'Q-1', currencyCode: 'USD', ...scope }]], [SalesQuoteLine, [salesLine]],
  ])
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) =>
    value === null ? row[key] == null : typeof value === 'object' ? true : row[key] === value)
  const em = {
    fork: jest.fn(), transactional: jest.fn(), persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
    assign: jest.fn((entity: object, values: object) => Object.assign(entity, values)),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (rows.get(entity) ?? []).find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (rows.get(entity) ?? []).filter((row) => matches(row, where))),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (execute: (tx: typeof em) => Promise<unknown>) => execute(em))
  const service = new DefaultCpqQuotingService({ em: em as never,
    cpqPricingService: { resolveProductCharges: async () => [] } as never,
    cpqValidationService: { validateOfferingConfiguration: async () => ({ errors: [] }), validateRelationships: async () => [] } as never,
    cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never })

  await expect(service.detachTargetSubscription(quoteId, target.id, scope)).resolves.toEqual({ ok: true })
  expect(em.transactional).toHaveBeenCalledTimes(1)
  expect(quote.pricingRevision).toBe(5)
  expect(target.deletedAt).toBeInstanceOf(Date)
  expect(line.deletedAt).toBeInstanceOf(Date)
  expect(child.deletedAt).toBeInstanceOf(Date)
  expect(salesLine.deletedAt).toBeInstanceOf(Date)
  expect(adjustment).toMatchObject({ isActive: false, deletedAt: expect.any(Date) })
})

it('refuses to detach on a submitted quote before changing anything', async () => {
  const quote = { id: randomUUID(), quoteId: randomUUID(), cpqStatus: 'in_approval', pricingRevision: 1, ...scope }
  const em = { fork: jest.fn(), flush: jest.fn(), find: jest.fn(), findOne: jest.fn().mockResolvedValue(quote), transactional: jest.fn() }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (execute: (tx: typeof em) => Promise<unknown>) => execute(em))
  const service = new DefaultCpqQuotingService({ em: em as never, cpqPricingService: {} as never, cpqValidationService: {} as never, cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never })
  await expect(service.detachTargetSubscription(quote.id, randomUUID(), scope)).rejects.toMatchObject({ status: 409 })
  expect(em.find).not.toHaveBeenCalled()
})
