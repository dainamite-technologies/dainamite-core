import { CpqAdjustmentService } from '../priceAdjustments/adjustmentService'
import { CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { adjustmentInput } from '../priceAdjustments/adjustmentService'
import { resolveManualAdjustments } from '../priceAdjustments/resolveManualAdjustments'
import type { PriceAdjustmentInput, PriceAdjustment } from '../../data/price-adjustments'
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const quoteId = '33333333-3333-4333-8333-333333333333', lineId = '44444444-4444-4444-8444-444444444444', actor = '55555555-5555-4555-8555-555555555555'
const input: PriceAdjustmentInput = { level: 'charge', quoteLineId: lineId, chargeCode: 'fee', adjustmentType: 'price_override', value: 80, currencyCode: 'USD', reasonCode: 'competitive_match' }
function setup() {
  const quote = { id: quoteId, quoteId, ...scope, cpqStatus: 'ready', pricingRevision: 0, quoteType: 'new' }
  const rows: CpqQuotePriceAdjustment[] = []
  const state = { enabled: true, order: false, reason: true, target: true, mirrored: false }
  const em = {
    fork: jest.fn(), transactional: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
    assign: jest.fn((entity: object, values: object) => Object.assign(entity, values)),
    create: jest.fn((_entity: unknown, values: object) => ({ fromMonth: 1, toMonth: null, windowKind: 'relative', isActive: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...values })),
    persist: jest.fn((row: CpqQuotePriceAdjustment) => { if (!rows.includes(row)) rows.push(row) }),
    find: jest.fn(async (entity: unknown) => entity === DictionaryEntry ? [{ value: 'competitive_match', label: 'Competitive match' }] : rows.filter((row) => !row.deletedAt)),
    count: jest.fn(async () => rows.filter((row) => !row.deletedAt).length),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CpqQuoteConfiguration) return quote
      if (entity === CpqOrderConfiguration) return state.order ? { id: 'order' } : null
      if (entity === CpqQuoteLineConfiguration) return state.target ? { offeringId: 'offer', configuration: state.mirrored ? { _arcMirroredFromItemId: 'item' } : {} } : null
      if (entity === Dictionary) return { id: 'dictionary' }
      if (entity === DictionaryEntry) return state.reason ? { value: where.value } : null
      if (entity === CpqQuotePriceAdjustment) return rows.find((row) => row.id === where.id && (where.deletedAt === undefined || row.deletedAt === null)) ?? null
      return null
    }),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (execute: (tx: typeof em) => Promise<unknown>) => execute(em))
  const recalculateLockedQuote = jest.fn(async (_em?: unknown, _quote?: unknown, _scope?: unknown, _save?: boolean, draft?: PriceAdjustment[]) => {
    const resolved = resolveManualAdjustments([{ lineId, parentLineId: null, enginePriced: true, mirrored: false,
      charges: [{ chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', currencyCode: 'USD', unitPrice: 100, totalPrice: 100, quantity: 1 }] }],
      draft ?? rows.filter((row) => !row.deletedAt).map((row) => ({ ...adjustmentInput(row), id: row.id })), 'USD')
    return { id: quoteId, adjustmentErrors: resolved.errors, lines: resolved.lines }
  })
  const service = new CpqAdjustmentService({ em: em as never, quotingService: { recalculateLockedQuote } as never,
    featureTogglesService: { getBoolConfig: async () => ({ ok: true, value: state.enabled }) } as never })
  return { service, em, quote, rows, state, recalculateLockedQuote }
}
it('creates a negotiated price and undoes it under the same pricing lock', async () => {
  const { service, rows, quote, em } = setup()
  const created = await service.create(quoteId, { ...input, expectedRevision: 0 }, actor, scope)
  expect(created.before).toBe(null)
  expect(created.adjustment).toMatchObject({ value: 80, quoteConfigurationId: quoteId, createdByUserId: actor, ...scope })
  expect(quote.pricingRevision).toBe(1)
  await service.undo(quoteId, created.adjustment.id, null, created.adjustment, actor, scope)
  expect(rows[0].deletedAt).toBeInstanceOf(Date)
  expect(quote.pricingRevision).toBe(2)
  expect(em.fork).toHaveBeenCalledWith({ clear: true, useContext: false })
})
it('updates and restores previous values, accepting reordered JSON undo keys', async () => {
  const { service, rows } = setup()
  const created = await service.create(quoteId, input, actor, scope)
  const updated = await service.update(quoteId, created.adjustment.id, { value: 70 }, actor, scope)
  const reordered = Object.fromEntries(Object.entries(updated.adjustment).reverse()) as typeof updated.adjustment
  await service.undo(quoteId, updated.adjustment.id, updated.before, reordered, actor, scope)
  expect(rows[0].value).toBe('80')
})
it('deletes and restores a row, preserving its original reason even if no longer selectable', async () => {
  const { service, rows, state } = setup()
  const created = await service.create(quoteId, input, actor, scope)
  state.reason = false
  const removed = await service.remove(quoteId, created.adjustment.id, actor, scope)
  expect(rows[0].isActive).toBe(false)
  await service.undo(quoteId, removed.adjustment.id, removed.before, removed.adjustment, actor, scope)
  expect(rows[0].isActive).toBe(true)
  expect(rows[0].deletedAt).toBe(null)
})
it.each(['in_approval', 'accepted', 'cancelled', 'with_customer'])('refuses create and undo in locked status %s', async (status) => {
  const { service, quote } = setup()
  const created = await service.create(quoteId, input, actor, scope)
  quote.cpqStatus = status
  await expect(service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 409, message: 'ADJUSTMENT_LOCKED' })
  await expect(service.undo(quoteId, created.adjustment.id, null, created.adjustment, actor, scope)).rejects.toMatchObject({ status: 409 })
})
it('refuses writes when converted or disabled', async () => {
  const { service, state, em } = setup()
  state.enabled = false
  await expect(service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 403 })
  expect(em.transactional).not.toHaveBeenCalled()
  state.enabled = true; state.order = true
  await expect(service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 409 })
})
it('rejects invalid prices, missing reasons, overlaps and stale revisions', async () => {
  const { service, state } = setup()
  await expect(service.create(quoteId, { ...input, value: 120 }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'ABOVE_STANDARD' })
  state.reason = false
  await expect(service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 422, message: 'REASON_NOT_FOUND' })
  const clean = setup()
  await clean.service.create(quoteId, input, actor, scope)
  await expect(clean.service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 422, message: 'ADJUSTMENT_OVERLAP' })
  await expect(clean.service.create(quoteId, { ...input, expectedRevision: 0 }, actor, scope)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
})
it('allows deleting an invalid adjustment while submitted', async () => {
  const { service, rows, quote } = setup()
  const created = await service.create(quoteId, input, actor, scope)
  rows[0].value = '120'; quote.cpqStatus = 'in_approval'
  await service.remove(quoteId, created.adjustment.id, actor, scope)
  expect(rows[0].deletedAt).toBeInstanceOf(Date)
})
it('refuses undo if the row changed afterward or the stored tenant is wrong', async () => {
  const { service, rows } = setup()
  const created = await service.create(quoteId, input, actor, scope)
  rows[0].value = '70'
  await expect(service.undo(quoteId, created.adjustment.id, null, created.adjustment, actor, scope)).rejects.toMatchObject({ status: 409 })
  await expect(service.undo(quoteId, created.adjustment.id, null, { ...created.adjustment, tenantId: actor }, actor, scope)).rejects.toMatchObject({ status: 403 })
})
it('rejects missing/out-of-scope and ARC mirror targets before persisting', async () => {
  const { service, state, quote, em } = setup()
  quote.quoteType = 'amend'
  state.target = false
  await expect(service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 404 })
  state.target = true; state.mirrored = true
  await expect(service.create(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
  expect(em.persist).not.toHaveBeenCalled()
})
it('scopes and paginates reads while reporting the revision and toggle state', async () => {
  const { service, em } = setup()
  await service.create(quoteId, input, actor, scope)
  const listed = await service.list(quoteId, scope, 1, 25)
  expect(listed).toMatchObject({ total: 1, page: 1, pageSize: 25, pricingRevision: 1, enabled: true })
  expect(listed.reasons).toEqual([{ value: 'competitive_match', label: 'Competitive match' }])
  expect(em.find).toHaveBeenCalledWith(CpqQuotePriceAdjustment, expect.objectContaining({ quoteConfigurationId: quoteId, ...scope, deletedAt: null, isActive: true }), { limit: 25, offset: 0, orderBy: { createdAt: 'asc', id: 'asc' } })
})
it('previews a draft without persisting rows, revision, or any flush', async () => {
  const { service, em, quote, rows, recalculateLockedQuote } = setup()
  const preview = await service.preview(quoteId, input, undefined, scope)
  expect(preview.errors).toEqual([])
  expect(preview.quote.lines[0].charges[0].totalPrice).toBe(80)
  expect(rows).toEqual([])
  expect(quote.pricingRevision).toBe(0)
  expect(em.flush).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
  expect(em.transactional).not.toHaveBeenCalled()
  expect(recalculateLockedQuote).toHaveBeenCalledWith(em, quote, scope, false, expect.any(Array))
})
it('returns invalid draft errors without saving and refuses a nonexistent replacement', async () => {
  const { service, em } = setup()
  const preview = await service.preview(quoteId, { ...input, value: 120 }, undefined, scope)
  expect(preview.errors).toEqual([expect.objectContaining({ code: 'ABOVE_STANDARD' })])
  await expect(service.preview(quoteId, input, actor, scope)).rejects.toMatchObject({ status: 404 })
  expect(em.flush).not.toHaveBeenCalled()
})
it('allows a new quote cloned from an ARC mirror to negotiate its engine price', async () => {
  const { service, state } = setup()
  state.mirrored = true
  const result = await service.create(quoteId, input, actor, scope)
  expect(result.adjustment.value).toBe(80)
})
