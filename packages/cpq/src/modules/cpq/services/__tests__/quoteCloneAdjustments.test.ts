import { randomUUID } from 'node:crypto'
import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { CpqProductOffering, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
const scope = { tenantId: randomUUID(), organizationId: randomUUID() }

it.each([false, true])('clones with remapped adjustments and safe pricing markers (ARC source=%s)', async (arc) => {
  const quoteId = randomUUID(), salesId = randomUUID(), lineId = randomUUID(), userId = randomUUID()
  const charge = { chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', unitPrice: 100, totalPrice: 100, quantity: 1, currencyCode: 'USD', adjustments: [] }
  const original = { id: quoteId, quoteId: salesId, customerId: userId, cpqStatus: 'ready', quoteType: arc ? 'amend' : 'new', version: 1, pricingRevision: 0, currencyCode: 'USD', ...scope }
  const line = { id: randomUUID(), quoteLineId: lineId, quoteConfigurationId: quoteId, offeringId: 'offer', productId: null, parentLineId: null, quantity: 1, configuration: arc ? { _arcPriceFrozen: true, _arcMirroredFromItemId: randomUUID() } : {}, charges: [charge], mrcTotal: '100', nrcTotal: '0', isConfigured: true, deletedAt: null, ...scope }
  const rows = new Map<unknown, Array<Record<string, unknown>>>([
    [CpqQuoteConfiguration, [original]], [CpqQuoteLineConfiguration, [line]],
    [SalesQuote, [{ id: salesId, quoteNumber: 'Q-1', customerEntityId: userId, currencyCode: 'USD', ...scope }]],
    [SalesQuoteLine, [{ id: lineId, lineNumber: 1, quantity: '1', ...scope }]],
    [CpqQuotePriceAdjustment, arc ? [] : [{ id: randomUUID(), quoteConfigurationId: quoteId, quoteId: salesId, quoteLineId: lineId, level: 'charge', chargeCode: 'fee', chargeTypeFilter: null, adjustmentType: 'price_override', value: '80', currencyCode: 'USD', reasonCode: 'inactive_reason', reasonNote: null, windowKind: 'relative', fromMonth: 1, toMonth: null, createdByUserId: userId, deletedAt: null, isActive: true, ...scope }]],
  ])
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) =>
    value === null ? row[key] == null : typeof value === 'object' ? true : row[key] === value)
  const em = {
    fork: jest.fn(), transactional: jest.fn(), persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
    assign: jest.fn((entity: object, values: object) => Object.assign(entity, values)),
    create: jest.fn((entity: unknown, values: Record<string, unknown>) => {
      const row = { id: randomUUID(), quoteType: 'new', createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...values }
      const group = rows.get(entity) ?? []; group.push(row); rows.set(entity, group); return row
    }),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => entity === CpqProductOffering ? { id: 'offer', name: 'Offering', offeringType: 'simple' } : (rows.get(entity) ?? []).find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (rows.get(entity) ?? []).filter((row) => matches(row, where))),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (execute: (tx: typeof em) => Promise<unknown>) => execute(em))
  const service = new DefaultCpqQuotingService({ em: em as never,
    cpqPricingService: { resolveProductCharges: async () => [charge] } as never,
    cpqValidationService: { validateOfferingConfiguration: async () => ({ errors: [] }), validateRelationships: async () => [] } as never,
    cpqProductService: {} as never, salesDocumentNumberGenerator: { generate: async () => ({ number: 'Q-2' }) } as never })
  const result = await service.cloneQuote(quoteId, scope)
  expect(result.id).not.toBe(quoteId)
  expect(result.lines[0].lineId).not.toBe(lineId)
  expect(result.lines[0].configuration).not.toHaveProperty('_arcPriceFrozen')
  expect(result.lines[0].charges[0].totalPrice).toBe(arc ? 100 : 80)
  if (!arc) {
    const copied = (rows.get(CpqQuotePriceAdjustment) ?? []).find((row) => row.quoteConfigurationId === result.id)
    expect(copied).toMatchObject({ quoteLineId: result.lines[0].lineId, value: '80', reasonCode: 'inactive_reason' })
  } else expect(line.configuration).toHaveProperty('_arcPriceFrozen', true)
})
