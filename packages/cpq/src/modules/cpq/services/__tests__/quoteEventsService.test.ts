import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { emitCpqEvent as emitImport } from '../../events'
import { CpqProductOffering, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'

jest.mock('../../events', () => ({ emitCpqEvent: jest.fn().mockResolvedValue(undefined) }))
const emit = emitImport as unknown as jest.Mock
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const ids = { quote: '33333333-3333-4333-8333-333333333333', sales: '44444444-4444-4444-8444-444444444444', line: '55555555-5555-4555-8555-555555555555', adjustment: '66666666-6666-4666-8666-666666666666' }

function setup(pricingSummary?: Record<string, unknown>) {
  const quote: Record<string, unknown> = { id: ids.quote, quoteId: ids.sales, customerId: 'customer', quoteType: 'new', cpqStatus: 'new', currencyCode: 'USD', pricingRevision: 0, ...scope }
  if (pricingSummary) quote.pricingSummary = pricingSummary
  const line = { id: 'config', quoteLineId: ids.line, quoteConfigurationId: ids.quote, offeringId: 'offer', productId: null, parentLineId: null, quantity: 1, configuration: {}, nrcTotal: '0', mrcTotal: '100', isConfigured: true, charges: [], usageEstimates: null, ...scope }
  const row = { id: ids.adjustment, quoteConfigurationId: ids.quote, quoteId: ids.sales, quoteLineId: ids.line, level: 'charge', chargeCode: 'fee', chargeTypeFilter: null, adjustmentType: 'discount_absolute', value: '20', currencyCode: 'USD', reasonCode: 'competitive_match', reasonNote: null as string | null, windowKind: 'relative', fromMonth: 1, toMonth: null, createdByUserId: '77777777-7777-4777-8777-777777777777', ...scope }
  const findOne = jest.fn(async (entity: unknown) => entity === CpqQuoteConfiguration ? quote : entity === SalesQuote ? { id: ids.sales, quoteNumber: 'Q-1', currencyCode: 'USD' } : entity === CpqProductOffering ? { id: 'offer', name: 'Offering', offeringType: 'simple' } : entity === SalesQuoteLine ? { id: ids.line, totalNetAmount: '100' } : null)
  const find = jest.fn(async (entity: unknown) => entity === CpqQuoteLineConfiguration ? [line] : entity === CpqQuotePriceAdjustment ? [row] : [])
  const tx = { findOne, find, assign: jest.fn((entity: object, updates: object) => Object.assign(entity, updates)), flush: jest.fn().mockResolvedValue(undefined) }
  const em = { ...tx, fork: jest.fn(), transactional: jest.fn(async (execute: (manager: typeof tx) => Promise<unknown>) => execute(tx)) }
  em.fork.mockReturnValue(em)
  const pricing = { resolveProductCharges: jest.fn().mockResolvedValue([{ chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', unitPrice: 100, totalPrice: 100, quantity: 1, currencyCode: 'USD', adjustments: [] }]) }
  const service = new DefaultCpqQuotingService({ em: em as never, cpqPricingService: pricing as never, cpqValidationService: { validateOfferingConfiguration: async () => ({ errors: [] }), validateRelationships: async () => [] } as never, cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never })
  return { service, quote, row }
}
const calls = (id: string) => emit.mock.calls.filter(([eventId]) => eventId === id).map(([, payload]) => payload)

beforeEach(() => emit.mockClear())

it('legacy quote: first save stores the baseline hash without a pricing signal, then a no-op save emits nothing', async () => {
  const { service, quote } = setup({ nrcTotal: 0, mrcTotal: 80, usageCharges: [], usageTotalEstimated: null, discountTotal: 0, surchargeTotal: 0, currencyCode: 'USD' })
  quote.cpqStatus = 'ready'
  await service.recalculate(ids.quote, { save: true }, scope)
  expect((quote.pricingSummary as Record<string, unknown>).snapshotHash).toEqual(expect.any(String))
  expect(emit).not.toHaveBeenCalled()
  await service.recalculate(ids.quote, { save: true }, scope)
  expect(emit).not.toHaveBeenCalled()
})

it('emits exactly one pricing_changed per save that changes prices, and an auto status_changed', async () => {
  const { service, row } = setup({ snapshotHash: 'empty-baseline' })
  await service.recalculate(ids.quote, { save: true }, scope)
  expect(calls('cpq.quote.pricing_changed')).toHaveLength(1)
  expect(calls('cpq.quote.status_changed')).toEqual([expect.objectContaining({ fromStatus: 'new', toStatus: 'ready', cause: 'auto', actorUserId: null })])
  emit.mockClear()
  row.value = '30'
  await service.recalculate(ids.quote, { save: true }, scope)
  expect(calls('cpq.quote.pricing_changed')).toEqual([expect.objectContaining({ cause: 'recalculate', dealValue: expect.objectContaining({ offer: 70 * 12 }) })])
  expect(calls('cpq.quote.status_changed')).toHaveLength(0)
})

it('reason edits do not change the hash, so no pricing signal', async () => {
  const { service, row } = setup({ snapshotHash: 'empty-baseline' })
  await service.recalculate(ids.quote, { save: true }, scope)
  emit.mockClear()
  row.reasonCode = 'other'; row.reasonNote = 'changed'
  await service.recalculate(ids.quote, { save: true }, scope)
  expect(emit).not.toHaveBeenCalled()
})

it('a read-only recalculation emits nothing', async () => {
  const { service } = setup({ snapshotHash: 'empty-baseline' })
  await service.recalculate(ids.quote, { save: false }, scope)
  expect(emit).not.toHaveBeenCalled()
})

it('a manual transition emits status_changed with the actor', async () => {
  const { service, quote } = setup({ snapshotHash: 'h' })
  quote.cpqStatus = 'ready'
  await service.transitionStatus(ids.quote, 'in_approval', scope, 'user-9')
  expect(calls('cpq.quote.pricing_changed')).toHaveLength(0)
  expect(calls('cpq.quote.status_changed')).toEqual([expect.objectContaining({ fromStatus: 'ready', toStatus: 'in_approval', cause: 'manual', actorUserId: 'user-9', snapshotHash: 'h' })])
})
