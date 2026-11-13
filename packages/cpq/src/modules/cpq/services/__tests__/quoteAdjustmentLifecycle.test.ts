import { cloneQuoteAdjustments, removeQuoteLineTree } from '../priceAdjustments/quoteAdjustmentLifecycle'
import { CpqProductCharge, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride, CpqQuotePriceAdjustment } from '../../data/entities'
import { resolveCostPlusInputs } from '../costs/costResolution'
import { DefaultCpqPricingService } from '../cpqPricingService'
import { SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
const scope = { tenantId: 'tenant', organizationId: 'org' }
it('clones rows with new ids and remapped lines without changing reasons or the source', async () => {
  const source = { id: 'adjustment', quoteLineId: 'old-line', level: 'charge', chargeCode: 'fee', adjustmentType: 'price_override', value: '80', currencyCode: 'USD', reasonCode: 'inactive_reason', createdByUserId: 'author', windowKind: 'relative', fromMonth: 1, toMonth: null, isActive: true }
  const created: Array<Record<string, unknown>> = []
  const em = { find: jest.fn(async (entity: unknown) => entity === CpqQuotePriceAdjustment ? [source] : []), create: jest.fn((_entity: unknown, values: Record<string, unknown>) => { created.push(values); return values }), persist: jest.fn() }
  await cloneQuoteAdjustments(em as never, 'source', { id: 'target', quoteId: 'new-sales' }, new Map([['old-line', 'new-line']]), scope)
  expect(created[0]).toMatchObject({ quoteLineId: 'new-line', quoteConfigurationId: 'target', quoteId: 'new-sales', reasonCode: 'inactive_reason', createdByUserId: 'author', ...scope })
  expect(created[0].id).not.toBe(source.id)
  expect(source.quoteLineId).toBe('old-line')
  expect(em.find).toHaveBeenCalledWith(CpqQuotePriceAdjustment, expect.objectContaining({ quoteConfigurationId: 'source', ...scope, deletedAt: null }), expect.objectContaining({ limit: 500 }))
})
it('keeps missing targets invalid with a fresh orphan id rather than a source-quote pointer', async () => {
  const source = { id: 'adjustment', quoteLineId: 'missing', reasonCode: 'promotion' }
  const create = jest.fn((_entity: unknown, values: Record<string, unknown>) => values)
  await cloneQuoteAdjustments({ find: jest.fn(async (entity: unknown) => entity === CpqQuotePriceAdjustment ? [source] : []), create, persist: jest.fn() } as never, 'source', { id: 'target', quoteId: 'sales' }, new Map(), scope)
  expect(create.mock.calls[0][1].quoteLineId).not.toBe('missing')
})
it('soft-deletes the whole nested bundle subtree and its adjustments before returning', async () => {
  const root = { id: 'root-config', quoteLineId: 'root', parentLineId: null, deletedAt: null }
  const child = { id: 'child-config', quoteLineId: 'child', parentLineId: 'root', deletedAt: null }
  const grandchild = { id: 'grandchild-config', quoteLineId: 'grandchild', parentLineId: 'child', deletedAt: null }
  const unrelated = { id: 'other-config', quoteLineId: 'other', parentLineId: null, deletedAt: null }
  const sales = [{ id: 'root', deletedAt: null }, { id: 'child', deletedAt: null }, { id: 'grandchild', deletedAt: null }]
  const adjustments = [{ id: 'adjustment', quoteLineId: 'grandchild', deletedAt: null, isActive: true }]
  const em = { find: jest.fn(async (entity: unknown) => entity === CpqQuoteLineConfiguration ? [root, child, grandchild, unrelated] : entity === SalesQuoteLine ? sales : entity === CpqQuotePriceAdjustment ? adjustments : []), flush: jest.fn().mockResolvedValue(undefined) }
  await removeQuoteLineTree(em as never, 'quote', root as never, scope)
  for (const row of [root, child, grandchild, ...sales, ...adjustments]) expect(row.deletedAt).toBeInstanceOf(Date)
  expect(unrelated.deletedAt).toBe(null)
  expect(adjustments[0].isActive).toBe(false)
  expect(em.flush).toHaveBeenCalled()
  expect(em.find).toHaveBeenCalledWith(CpqQuotePriceAdjustment, expect.objectContaining({ quoteConfigurationId: 'quote', quoteLineId: { $in: ['root', 'child', 'grandchild'] }, ...scope }), expect.anything())
})

describe('cost lines and markup overrides (R16)', () => {
  const cost = (over: Record<string, unknown> = {}) => ({ id: 'cost-1', quoteLineId: 'old-line', costKey: 'transit', chargeCode: 'fee', origin: 'manual', costElementId: null,
    carriedFromItemCostId: null, carriedFromHash: null, name: 'Transit', role: 'price_basis', costType: 'recurring', source: 'on_request', costModel: 'flat',
    valueStatus: 'confirmed', valueOrigin: 'manual', unitAmount: '40.0000', instanceAmount: '40.0000', currencyCode: 'USD', fxRate: null, fxRateDate: null,
    driverHash: 'h', indexSnapshot: null, supplierId: 'sup', supplierName: 'Acme', supplierQuoteRef: 'Q-9', validUntil: '2020-01-01', supplierTermEnd: null,
    supplierMinTermMonths: 12, note: 'negotiated', errorCode: null, sourcingStatus: 'answered', costRequestId: 'req-1', requestSeq: 2, requestedAt: new Date(),
    requestedByUserId: 'u', answeredAt: new Date(), answeredByUserId: 'u2', declineReason: 'x', proposedAmount: '39.0000', ...over })
  const override = { id: 'ov-1', quoteLineId: 'old-line', chargeCode: 'fee', markupRule: 'markup_percent', markupValue: '30.0000', note: 'deal', createdByUserId: 'a', updatedByUserId: 'b' }
  const clone = async (costs: Array<Record<string, unknown>>, overrides: Array<Record<string, unknown>>, lines = new Map([['old-line', 'new-line']])) => {
    const created: Array<{ entity: unknown; values: Record<string, unknown> }> = []
    const em = {
      find: jest.fn(async (entity: unknown) => entity === CpqQuoteLineCost ? costs : entity === CpqQuoteMarkupOverride ? overrides : []),
      create: jest.fn((entity: unknown, values: Record<string, unknown>) => { created.push({ entity, values }); return values }), persist: jest.fn(),
    }
    await cloneQuoteAdjustments(em as never, 'source', { id: 'target', quoteId: 'new-sales' }, lines, scope)
    return { created, em }
  }
  it('copies cost lines as-is with new ids, re-pointed, and resets sourcing request state', async () => {
    const source = cost()
    const { created, em } = await clone([source], [])
    const copy = created.find((entry) => entry.entity === CpqQuoteLineCost)!.values
    expect(copy).toMatchObject({ quoteConfigurationId: 'target', quoteId: 'new-sales', quoteLineId: 'new-line', ...scope,
      origin: 'manual', valueOrigin: 'manual', valueStatus: 'confirmed', unitAmount: '40.0000', instanceAmount: '40.0000', supplierName: 'Acme',
      supplierQuoteRef: 'Q-9', validUntil: '2020-01-01', note: 'negotiated',
      sourcingStatus: 'not_requested', costRequestId: null, requestSeq: null, requestedAt: null, requestedByUserId: null, answeredAt: null, answeredByUserId: null, declineReason: null, proposedAmount: null })
    expect(copy.id).not.toBe('cost-1')
    expect(source).toMatchObject({ quoteLineId: 'old-line', sourcingStatus: 'answered', costRequestId: 'req-1' })
    expect(em.persist).toHaveBeenCalled()
  })
  it('copies markup overrides with new ids and the cloned line', async () => {
    const { created } = await clone([], [override])
    const copy = created.find((entry) => entry.entity === CpqQuoteMarkupOverride)!.values
    expect(copy).toMatchObject({ quoteConfigurationId: 'target', quoteId: 'new-sales', quoteLineId: 'new-line', chargeCode: 'fee', markupRule: 'markup_percent', markupValue: '30.0000', note: 'deal', ...scope })
    expect(copy.id).not.toBe('ov-1')
  })
  it('does not copy rows of lines missing from the clone', async () => {
    const { created } = await clone([cost({ quoteLineId: 'gone' })], [{ ...override, quoteLineId: 'gone' }])
    expect(created).toEqual([])
  })
  it('soft-deletes the cost lines and markup overrides of a removed line tree only', async () => {
    const root = { id: 'root-config', quoteLineId: 'root', parentLineId: null, deletedAt: null }
    const child = { id: 'child-config', quoteLineId: 'child', parentLineId: 'root', deletedAt: null }
    const costs = [{ id: 'c1', quoteLineId: 'child', deletedAt: null }], overrides = [{ id: 'o1', quoteLineId: 'root', deletedAt: null }]
    const em = { find: jest.fn(async (entity: unknown) => entity === CpqQuoteLineConfiguration ? [root, child] : entity === CpqQuoteLineCost ? costs : entity === CpqQuoteMarkupOverride ? overrides : []), flush: jest.fn().mockResolvedValue(undefined) }
    await removeQuoteLineTree(em as never, 'quote', root as never, scope)
    expect(costs[0].deletedAt).toBeInstanceOf(Date)
    expect(overrides[0].deletedAt).toBeInstanceOf(Date)
    expect(em.find).toHaveBeenCalledWith(CpqQuoteLineCost, expect.objectContaining({ quoteConfigurationId: 'quote', quoteLineId: { $in: ['root', 'child'] }, ...scope, deletedAt: null }), expect.anything())
  })
})

describe('toggle off (R14)', () => {
  it('re-pricing a stored cost-plus charge yields COST_PLUS_DISABLED and leaves stored cost data untouched', async () => {
    const stored = [{ id: 'c', quoteLineId: 'line', costKey: 'transit', role: 'price_basis', valueStatus: 'confirmed', instanceAmount: '40.0000', deletedAt: null }]
    const em = { find: jest.fn(async (entity: unknown) => entity === CpqQuoteLineCost ? stored : []), persist: jest.fn(), flush: jest.fn(), count: jest.fn() }
    const inputs = await resolveCostPlusInputs({
      em: em as never, quote: { id: 'q', quoteId: 's', cpqStatus: 'new', quoteType: 'new', currencyCode: 'USD' }, lines: [], scope, save: true, isEnabled: async () => false,
    })
    expect(inputs.enabled).toBe(false)
    expect(inputs.costsByLine.size).toBe(0)
    expect(em.find).not.toHaveBeenCalled(); expect(em.persist).not.toHaveBeenCalled(); expect(em.flush).not.toHaveBeenCalled()
    const charge = { id: 'ch', code: 'fee', name: 'Fee', chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: '25', fixedPrice: null, quantityAttributeCode: null, applicabilityCondition: null, sortOrder: 0 }
    const pricingEm = { find: jest.fn(async (entity: unknown) => entity === CpqProductCharge ? [charge] : []), findOne: jest.fn() }
    const costPlus = { enabled: inputs.enabled, costs: [], overrides: new Map(), errors: [] as Array<{ chargeCode: string; code: string }> }
    const [priced] = await new DefaultCpqPricingService(pricingEm as never).resolveProductCharges({ offeringId: 'o', configuration: {}, currencyCode: 'USD', ...scope, costPlus: costPlus as never })
    expect(priced).toMatchObject({ pricingMethod: 'cost_plus', unitPrice: null, totalPrice: null })
    expect(costPlus.errors).toEqual([{ chargeCode: 'fee', code: 'COST_PLUS_DISABLED' }])
    expect(stored[0]).toMatchObject({ valueStatus: 'confirmed', instanceAmount: '40.0000', deletedAt: null })
  })
})
