import { cloneQuoteAdjustments, removeQuoteLineTree } from '../priceAdjustments/quoteAdjustmentLifecycle'
import { CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
const scope = { tenantId: 'tenant', organizationId: 'org' }
it('clones rows with new ids and remapped lines without changing reasons or the source', async () => {
  const source = { id: 'adjustment', quoteLineId: 'old-line', level: 'charge', chargeCode: 'fee', adjustmentType: 'price_override', value: '80', currencyCode: 'USD', reasonCode: 'inactive_reason', createdByUserId: 'author', windowKind: 'relative', fromMonth: 1, toMonth: null, isActive: true }
  const created: Array<Record<string, unknown>> = []
  const em = { find: jest.fn().mockResolvedValue([source]), create: jest.fn((_entity: unknown, values: Record<string, unknown>) => { created.push(values); return values }), persist: jest.fn() }
  await cloneQuoteAdjustments(em as never, 'source', { id: 'target', quoteId: 'new-sales' }, new Map([['old-line', 'new-line']]), scope)
  expect(created[0]).toMatchObject({ quoteLineId: 'new-line', quoteConfigurationId: 'target', quoteId: 'new-sales', reasonCode: 'inactive_reason', createdByUserId: 'author', ...scope })
  expect(created[0].id).not.toBe(source.id)
  expect(source.quoteLineId).toBe('old-line')
  expect(em.find).toHaveBeenCalledWith(CpqQuotePriceAdjustment, expect.objectContaining({ quoteConfigurationId: 'source', ...scope, deletedAt: null }), expect.objectContaining({ limit: 500 }))
})
it('keeps missing targets invalid with a fresh orphan id rather than a source-quote pointer', async () => {
  const source = { id: 'adjustment', quoteLineId: 'missing', reasonCode: 'promotion' }
  const create = jest.fn((_entity: unknown, values: Record<string, unknown>) => values)
  await cloneQuoteAdjustments({ find: jest.fn().mockResolvedValue([source]), create, persist: jest.fn() } as never, 'source', { id: 'target', quoteId: 'sales' }, new Map(), scope)
  expect(create.mock.calls[0][1].quoteLineId).not.toBe('missing')
})
it('soft-deletes the whole nested bundle subtree and its adjustments before returning', async () => {
  const root = { id: 'root-config', quoteLineId: 'root', parentLineId: null, deletedAt: null }
  const child = { id: 'child-config', quoteLineId: 'child', parentLineId: 'root', deletedAt: null }
  const grandchild = { id: 'grandchild-config', quoteLineId: 'grandchild', parentLineId: 'child', deletedAt: null }
  const unrelated = { id: 'other-config', quoteLineId: 'other', parentLineId: null, deletedAt: null }
  const sales = [{ id: 'root', deletedAt: null }, { id: 'child', deletedAt: null }, { id: 'grandchild', deletedAt: null }]
  const adjustments = [{ id: 'adjustment', quoteLineId: 'grandchild', deletedAt: null, isActive: true }]
  const em = { find: jest.fn(async (entity: unknown) => entity === CpqQuoteLineConfiguration ? [root, child, grandchild, unrelated] : entity === SalesQuoteLine ? sales : adjustments), flush: jest.fn().mockResolvedValue(undefined) }
  await removeQuoteLineTree(em as never, 'quote', root as never, scope)
  for (const row of [root, child, grandchild, ...sales, ...adjustments]) expect(row.deletedAt).toBeInstanceOf(Date)
  expect(unrelated.deletedAt).toBe(null)
  expect(adjustments[0].isActive).toBe(false)
  expect(em.flush).toHaveBeenCalled()
  expect(em.find).toHaveBeenCalledWith(CpqQuotePriceAdjustment, expect.objectContaining({ quoteConfigurationId: 'quote', quoteLineId: { $in: ['root', 'child', 'grandchild'] }, ...scope }), expect.anything())
})
