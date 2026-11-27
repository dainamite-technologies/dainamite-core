import { CpqAdjustmentService, adjustmentInput } from '../priceAdjustments/adjustmentService'
import { CpqTargetPriceService } from '../priceAdjustments/targetPriceService'
import { CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveManualAdjustments } from '../priceAdjustments/resolveManualAdjustments'
import type { PriceAdjustment, TargetPriceInput } from '../../data/price-adjustments'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const quoteId = '33333333-3333-4333-8333-333333333333', lineId = '44444444-4444-4444-8444-444444444444'
const actor = '55555555-5555-4555-8555-555555555555', otherActor = '66666666-6666-4666-8666-666666666666'
const recurring = { level: 'line' as const, quoteLineId: lineId, chargeTypeFilter: 'mrc' as const }
const phases: TargetPriceInput = {
  target: recurring, currencyCode: 'USD', reasonCode: 'promotion', then: null,
  phases: [{ months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' }, { months: 3, adjustmentType: 'discount_percent', value: 50, name: '50% off' }],
}

type Row = CpqQuotePriceAdjustment
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const op = expected as { $in?: unknown[]; $gt?: string }
      if (op.$in) return op.$in.includes(actual)
      if (op.$gt) return String(actual) > op.$gt
    }
    return actual === (expected ?? null)
  })
}

function setup() {
  const quote = { id: quoteId, quoteId, ...scope, cpqStatus: 'ready', pricingRevision: 0, quoteType: 'new' }
  const rows: Row[] = []
  const state = { enabled: true, order: false, reasons: ['promotion', 'loyalty', 'other'], target: true, term: 12 as number | null }
  const em = {
    fork: jest.fn(), transactional: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
    assign: jest.fn((entity: object, values: object) => Object.assign(entity, values)),
    create: jest.fn((_entity: unknown, values: object) => ({ fromMonth: 1, toMonth: null, windowKind: 'relative', isActive: true, deletedAt: null, createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-01T00:00:00Z'), ...values })),
    persist: jest.fn((row: Row) => { if (!rows.includes(row)) rows.push(row) }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CpqQuotePriceAdjustment) return rows.filter((row) => matches(row as unknown as Record<string, unknown>, where)).sort((a, b) => a.id.localeCompare(b.id))
      return []
    }),
    count: jest.fn(async () => 0),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CpqQuoteConfiguration) return quote
      if (entity === CpqOrderConfiguration) return state.order ? { id: 'order' } : null
      if (entity === CpqQuoteLineConfiguration) return state.target ? { offeringId: 'offer', configuration: {}, termMonths: state.term, charges: [{ chargeCode: 'fee' }, { chargeCode: 'setup' }] } : null
      if (entity === Dictionary) return { id: 'dictionary' }
      if (entity === DictionaryEntry) return state.reasons.includes(String(where.value)) ? { value: where.value } : null
      return null
    }),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (execute: (tx: typeof em) => Promise<unknown>) => execute(em))
  const recalculateLockedQuote = jest.fn(async (_em?: unknown, _quote?: unknown, _scope?: unknown, _save?: boolean, draft?: PriceAdjustment[]) => {
    const resolved = resolveManualAdjustments([{ lineId, parentLineId: null, enginePriced: true, mirrored: false, termMonths: state.term,
      charges: [
        { chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'flat', currencyCode: 'USD', unitPrice: 90, totalPrice: 90, standardUnitPrice: 90, standardTotalPrice: 90, quantity: 1 },
        { chargeCode: 'setup', chargeName: 'Setup', chargeType: 'nrc', pricingMethod: 'flat', currencyCode: 'USD', unitPrice: 100, totalPrice: 100, standardUnitPrice: 100, standardTotalPrice: 100, quantity: 1 },
      ] }],
    draft ?? rows.filter((row) => !row.deletedAt).map((row) => ({ ...adjustmentInput(row), id: row.id })), 'USD')
    return { id: quoteId, adjustmentErrors: resolved.errors, lines: resolved.lines }
  })
  const deps = { em: em as never, quotingService: { recalculateLockedQuote } as never }
  const adjustmentService = new CpqAdjustmentService({ ...deps, featureTogglesService: { getBoolConfig: async () => ({ ok: true, value: state.enabled }) } as never })
  const service = new CpqTargetPriceService({ ...deps, adjustmentService })
  const active = () => rows.filter((row) => !row.deletedAt && row.isActive)
  return { service, adjustmentService, em, quote, rows, state, active, recalculateLockedQuote }
}

describe('replaceTarget', () => {
  it('writes the phases in one quote write and one reprice, then undoes them all', async () => {
    const { service, active, quote, recalculateLockedQuote, em } = setup()
    const result = await service.replaceTarget(quoteId, { ...phases, expectedRevision: 0 }, actor, scope)
    expect(result.before).toEqual([])
    expect(result.after.map((row) => [row.fromMonth ?? 1, row.toMonth, row.phaseName])).toEqual([[1, 1, 'Free trial'], [2, 4, '50% off']])
    expect(active()).toHaveLength(2)
    expect(quote.pricingRevision).toBe(1)
    expect(recalculateLockedQuote).toHaveBeenCalledTimes(1)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    await service.undoTarget(quoteId, recurring, result.before, result.after, actor, scope)
    expect(active()).toHaveLength(0)
    expect(quote.pricingRevision).toBe(2)
  })

  it('keeps unchanged rows (id, author, date), updates a row in place and undoes back to the old set', async () => {
    const { service, rows, active } = setup()
    const first = await service.replaceTarget(quoteId, phases, otherActor, scope)
    const [trial, half] = first.after
    const second = await service.replaceTarget(quoteId, { ...phases, phases: [phases.phases[0], { months: 3, adjustmentType: 'discount_percent', value: 40, name: '40% off' }, { months: 2, adjustmentType: 'discount_percent', value: 10 }] }, actor, scope)
    const kept = rows.find((row) => row.id === trial.id)!
    expect(kept.createdByUserId).toBe(otherActor)
    expect(kept.updatedAt.toISOString()).toBe(trial.updatedAt)
    const updated = rows.find((row) => row.id === half.id)!
    expect(updated).toMatchObject({ value: '40', phaseName: '40% off', createdByUserId: actor })
    expect(second.after.map((row) => row.id).slice(0, 2)).toEqual([trial.id, half.id])
    expect(active()).toHaveLength(3)
    await service.undoTarget(quoteId, recurring, second.before, second.after, actor, scope)
    expect(active().map((row) => [row.id, row.value, row.createdByUserId])).toEqual(expect.arrayContaining([[trial.id, '0', otherActor], [half.id, '50', otherActor]]))
    expect(active()).toHaveLength(2)
  })

  it('removes everything on the target with phases [] and then null, without a reason', async () => {
    const { service, active } = setup()
    await service.replaceTarget(quoteId, phases, actor, scope)
    const removed = await service.replaceTarget(quoteId, { target: recurring, phases: [], then: null }, actor, scope)
    expect(removed.after).toEqual([])
    expect(removed.before).toHaveLength(2)
    expect(active()).toHaveLength(0)
  })

  it('refuses locked, converted, disabled and stale quotes before writing', async () => {
    const locked = setup(); locked.quote.cpqStatus = 'in_approval'
    await expect(locked.service.replaceTarget(quoteId, phases, actor, scope)).rejects.toMatchObject({ status: 409, message: 'ADJUSTMENT_LOCKED' })
    const converted = setup(); converted.state.order = true
    await expect(converted.service.replaceTarget(quoteId, phases, actor, scope)).rejects.toMatchObject({ status: 409, message: 'ADJUSTMENT_LOCKED' })
    const disabled = setup(); disabled.state.enabled = false
    await expect(disabled.service.replaceTarget(quoteId, phases, actor, scope)).rejects.toMatchObject({ status: 403 })
    expect(disabled.em.transactional).not.toHaveBeenCalled()
    const stale = setup()
    await expect(stale.service.replaceTarget(quoteId, { ...phases, expectedRevision: 3 }, actor, scope)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
    for (const run of [locked, converted, stale]) expect(run.em.persist).not.toHaveBeenCalled()
  })

  it('throws an overlap with another target on save, with the other row id', async () => {
    const { service, active } = setup()
    const recurringSet = await service.replaceTarget(quoteId, phases, actor, scope)
    const allCharges = { target: { level: 'line' as const, quoteLineId: lineId, chargeTypeFilter: null }, phases: [], then: { adjustmentType: 'discount_percent' as const, value: 10 }, reasonCode: 'promotion' }
    await expect(service.replaceTarget(quoteId, allCharges, actor, scope))
      .rejects.toMatchObject({ status: 422, message: 'ADJUSTMENT_OVERLAP', details: { adjustmentId: recurringSet.after[0].id } })
    expect(active()).toHaveLength(2)
    // A one-time target on the same line does not overlap the recurring phases.
    await service.replaceTarget(quoteId, { ...allCharges, target: { ...allCharges.target, chargeTypeFilter: 'nrc' } }, actor, scope)
    expect(active()).toHaveLength(3)
  })

  it('applies the reason rules and the structural rules as 422 codes', async () => {
    const { service, state } = setup()
    await expect(service.replaceTarget(quoteId, { ...phases, reasonCode: 'nope' }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'REASON_NOT_FOUND' })
    await expect(service.replaceTarget(quoteId, { ...phases, reasonCode: null }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'REASON_NOT_FOUND' })
    await expect(service.replaceTarget(quoteId, { ...phases, reasonCode: 'other' }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'REASON_NOTE_REQUIRED' })
    await expect(service.replaceTarget(quoteId, { ...phases, phases: [{ months: 13, adjustmentType: 'discount_percent', value: 5 }] }, actor, scope))
      .rejects.toMatchObject({ status: 422, message: 'PHASE_PAST_TERM', details: { stepIndex: 0 } })
    await expect(service.replaceTarget(quoteId, { ...phases, target: { ...recurring, chargeTypeFilter: 'nrc' } }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'PHASE_RECURRING_ONLY' })
    // A reason no longer offered stays on a set that already uses it.
    await service.replaceTarget(quoteId, phases, actor, scope)
    state.reasons = []
    await expect(service.replaceTarget(quoteId, { ...phases, phases: [...phases.phases, { months: 1, adjustmentType: 'discount_percent', value: 5 }] }, actor, scope)).resolves.toBeTruthy()
  })

  it('refuses a missing line or charge and a pricing error of a written row', async () => {
    const missing = setup(); missing.state.target = false
    await expect(missing.service.replaceTarget(quoteId, phases, actor, scope)).rejects.toMatchObject({ status: 404 })
    const { service, active } = setup()
    await expect(service.replaceTarget(quoteId, { ...phases, target: { level: 'charge', quoteLineId: lineId, chargeCode: 'nope' } }, actor, scope)).rejects.toMatchObject({ status: 404, message: 'Charge not found' })
    // Phases on a one-time charge: the resolver rejects them, the save rolls back.
    await expect(service.replaceTarget(quoteId, { ...phases, target: { level: 'charge', quoteLineId: lineId, chargeCode: 'setup' } }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'PHASE_RECURRING_ONLY' })
    await expect(service.replaceTarget(quoteId, { ...phases, currencyCode: 'EUR' }, actor, scope)).rejects.toMatchObject({ status: 422, message: 'CURRENCY_MISMATCH' })
  })
})

describe('previewTarget', () => {
  it('prices the draft without a write and reports an overlap instead of throwing', async () => {
    const { service, em, active, recalculateLockedQuote } = setup()
    await service.replaceTarget(quoteId, phases, actor, scope)
    em.persist.mockClear()
    const recurringIds = active().map((row) => row.id)
    const preview = await service.previewTarget(quoteId, { target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: null }, phases: [], then: { adjustmentType: 'discount_percent', value: 10 }, reasonCode: 'promotion' }, scope)
    expect(preview.errors).toEqual([expect.objectContaining({ code: 'ADJUSTMENT_OVERLAP', conflictsWith: recurringIds[0] })])
    expect(em.persist).not.toHaveBeenCalled()
    expect(recalculateLockedQuote).toHaveBeenLastCalledWith(em, expect.anything(), scope, false, expect.any(Array))
  })

  it('reuses the ids of unchanged rows and prices the new schedule', async () => {
    const { service, active } = setup()
    await service.replaceTarget(quoteId, phases, actor, scope)
    const ids = active().map((row) => row.id)
    const preview = await service.previewTarget(quoteId, { ...phases, then: { adjustmentType: 'price_override', value: 120 } }, scope)
    expect(preview.errors).toEqual([])
    const fee = (preview.quote as unknown as { lines: Array<{ charges: Array<{ chargeCode: string; schedule?: Array<{ adjustmentId?: string; unitPrice: number }> }> }> }).lines[0].charges.find((charge) => charge.chargeCode === 'fee')!
    expect(fee.schedule?.map((segment) => segment.unitPrice)).toEqual([0, 45, 120])
    expect(fee.schedule?.slice(0, 2).map((segment) => segment.adjustmentId)).toEqual(expect.arrayContaining(ids))
    expect(active()).toHaveLength(2)
  })

  it('refuses locked and stale quotes', async () => {
    const { service, quote } = setup()
    await expect(service.previewTarget(quoteId, { ...phases, expectedRevision: 9 }, scope)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
    quote.cpqStatus = 'accepted'
    await expect(service.previewTarget(quoteId, phases, scope)).rejects.toMatchObject({ status: 409, message: 'ADJUSTMENT_LOCKED' })
  })
})

describe('undoTarget', () => {
  it('answers 409 when a written row changed since the save', async () => {
    const { service, rows, active } = setup()
    const result = await service.replaceTarget(quoteId, phases, actor, scope)
    rows.find((row) => row.id === result.after[1].id)!.value = '30'
    await expect(service.undoTarget(quoteId, recurring, result.before, result.after, actor, scope)).rejects.toMatchObject({ status: 409 })
    expect(active()).toHaveLength(2)
  })

  it('refuses snapshots of another tenant or target, and a restore that would overlap a newer target', async () => {
    const { service, active } = setup()
    await service.replaceTarget(quoteId, phases, actor, scope)
    const removal = await service.replaceTarget(quoteId, { target: recurring, phases: [], then: null }, actor, scope)
    await expect(service.undoTarget(quoteId, recurring, removal.before.map((row) => ({ ...row, tenantId: actor })), [], actor, scope)).rejects.toMatchObject({ status: 403 })
    await expect(service.undoTarget(quoteId, { ...recurring, chargeTypeFilter: 'nrc' }, removal.before, [], actor, scope)).rejects.toMatchObject({ status: 403 })
    await service.replaceTarget(quoteId, { target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: null }, phases: [], then: { adjustmentType: 'discount_percent', value: 10 }, reasonCode: 'promotion' }, actor, scope)
    await expect(service.undoTarget(quoteId, recurring, removal.before, removal.after, actor, scope)).rejects.toMatchObject({ status: 422, message: 'ADJUSTMENT_OVERLAP' })
    expect(active()).toHaveLength(1)
  })

  it('refuses to undo on a locked quote', async () => {
    const { service, quote } = setup()
    const result = await service.replaceTarget(quoteId, phases, actor, scope)
    quote.cpqStatus = 'in_approval'
    await expect(service.undoTarget(quoteId, recurring, result.before, result.after, actor, scope)).rejects.toMatchObject({ status: 409, message: 'ADJUSTMENT_LOCKED' })
  })
})
