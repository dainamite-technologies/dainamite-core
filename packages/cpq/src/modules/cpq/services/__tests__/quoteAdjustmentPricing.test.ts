import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { CpqProductOffering, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const ids = { quote: '33333333-3333-4333-8333-333333333333', sales: '44444444-4444-4444-8444-444444444444', line: '55555555-5555-4555-8555-555555555555', adjustment: '66666666-6666-4666-8666-666666666666', user: '77777777-7777-4777-8777-777777777777' }
function setup() {
  const quote = { id: ids.quote, quoteId: ids.sales, customerId: 'customer', quoteType: 'new', cpqStatus: 'new', currencyCode: 'USD', pricingRevision: 0, ...scope }
  const sales = { id: ids.sales, quoteNumber: 'Q-1', currencyCode: 'USD' }
  const line = { id: 'config', quoteLineId: ids.line, quoteConfigurationId: ids.quote, offeringId: 'offer', productId: null, parentLineId: null, quantity: 2, configuration: {}, nrcTotal: '0', mrcTotal: '200', isConfigured: true, charges: [], usageEstimates: null, ...scope }
  const salesLine = { id: ids.line, totalNetAmount: '200' }
  const row = { id: ids.adjustment, quoteConfigurationId: ids.quote, quoteId: ids.sales, quoteLineId: ids.line, level: 'charge', chargeCode: 'fee', chargeTypeFilter: null, adjustmentType: 'discount_absolute', value: '20', currencyCode: 'USD', reasonCode: 'competitive_match', reasonNote: null, windowKind: 'relative', fromMonth: 1, toMonth: null, createdByUserId: ids.user, ...scope }
  const findOne = jest.fn(async (entity: unknown) => entity === CpqQuoteConfiguration ? quote : entity === SalesQuote ? sales : entity === CpqProductOffering ? { id: 'offer', name: 'Offering', offeringType: 'simple' } : entity === SalesQuoteLine ? salesLine : null)
  const find = jest.fn(async (entity: unknown) => entity === CpqQuoteLineConfiguration ? [line] : entity === CpqQuotePriceAdjustment ? [row] : [])
  const tx = { findOne, find, assign: jest.fn((entity: object, updates: object) => Object.assign(entity, updates)), flush: jest.fn().mockResolvedValue(undefined) }
  const em = { ...tx, fork: jest.fn(), transactional: jest.fn(async (execute: (manager: typeof tx) => Promise<unknown>) => execute(tx)) }
  em.fork.mockReturnValue(em)
  const pricing = { resolveProductCharges: jest.fn().mockResolvedValue([{ chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', unitPrice: 100, totalPrice: 100, quantity: 1, currencyCode: 'USD', adjustments: [] }]) }
  const service = new DefaultCpqQuotingService({ em: em as never, cpqPricingService: pricing as never, cpqValidationService: { validateOfferingConfiguration: async () => ({ errors: [] }), validateRelationships: async () => [] } as never, cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never })
  return { service, quote, line, row, salesLine, em, tx }
}
it('applies stored adjustments to quote/sales totals exactly once and preserves deprecated discountTotal', async () => {
  const { service, quote, line, salesLine, em } = setup()
  const first = await service.recalculate(ids.quote, { save: true }, scope)
  expect(first.lines[0].mrcTotal).toBe(160)
  expect(first.lines[0].charges[0]).toMatchObject({ listTotalPrice: 100, standardTotalPrice: 100, totalPrice: 80 })
  expect(first.pricingSummary).toMatchObject({ mrcTotal: 160, manualDiscountTotal: 40, ruleDiscountTotal: 0, discountTotal: 0 })
  expect(first.pricingRevision).toBe(1)
  expect(salesLine.totalNetAmount).toBe('160')
  expect(line.mrcTotal).toBe('160')
  const second = await service.recalculate(ids.quote, { save: true }, scope)
  expect(second.lines[0].charges).toEqual(first.lines[0].charges)
  expect(second.pricingSummary.snapshotHash).toBe(first.pricingSummary.snapshotHash)
  expect(quote.pricingRevision).toBe(2)
  expect(em.transactional).toHaveBeenCalledTimes(2)
})
it('keeps an invalid row, marks the line and quote incomplete, and charges standard', async () => {
  const { service, row } = setup()
  row.chargeCode = 'removed-charge'
  const result = await service.recalculate(ids.quote, { save: true }, scope)
  expect(result.cpqStatus).toBe('incomplete')
  expect(result.lines[0].isConfigured).toBe(false)
  expect(result.lines[0].mrcTotal).toBe(200)
  expect(result.lines[0].validationErrors).toEqual([expect.objectContaining({ message: 'ADJUSTMENT_TARGET_MISSING' })])
  expect(row.chargeCode).toBe('removed-charge')
})
it('previews saved adjustments without changing a managed entity, revision or persisted snapshot', async () => {
  const { service, quote, line, tx, em } = setup()
  const result = await service.recalculate(ids.quote, { save: false }, scope)
  expect(result.lines[0].mrcTotal).toBe(160)
  expect(quote.cpqStatus).toBe('new')
  expect(quote.pricingRevision).toBe(0)
  expect(quote).not.toHaveProperty('pricingSummary')
  expect(line.mrcTotal).toBe('200')
  expect(line.charges).toEqual([])
  expect(tx.flush).not.toHaveBeenCalled()
  expect(tx.assign).not.toHaveBeenCalled()
  expect(em.transactional).not.toHaveBeenCalled()
})
it('loads adjustments only once per recalculation and scopes the query', async () => {
  const { service, tx } = setup()
  await service.recalculate(ids.quote, { save: false }, scope)
  const calls = tx.find.mock.calls.filter(([entity]) => entity === CpqQuotePriceAdjustment)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual([CpqQuotePriceAdjustment, expect.objectContaining({ quoteConfigurationId: ids.quote, ...scope, deletedAt: null }), { limit: 500, orderBy: { id: 'asc' } }])
})
