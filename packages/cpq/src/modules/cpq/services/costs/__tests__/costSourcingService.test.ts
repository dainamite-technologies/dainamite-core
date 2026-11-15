import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost,
} from '../../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

const writeCalls: Array<{ options: Record<string, any> }> = []
jest.mock('../../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: async (em: any, quoteId: string, _scope: unknown, execute: any, makeError: any, options: any) => {
    writeCalls.push({ options })
    const quote = em.__quotes?.[quoteId] ?? em.__quote
    if (!quote || quote.id !== quoteId) throw makeError(404, 'Quote not found')
    if (options.expectedRevision !== undefined && options.expectedRevision !== (quote.pricingRevision ?? 0)) throw makeError(409, 'STALE_REVISION')
    const before = quote.pricingRevision
    // Refusals and idempotent no-ops short-circuit BEFORE the revision bump.
    const early = options.shortCircuit ? await options.shortCircuit(em, quote) : undefined
    if (early !== undefined) return early
    quote.pricingRevision = (quote.pricingRevision ?? 0) + 1
    try {
      const result = await execute(em, quote)
      await options.afterCommit?.(result, quote)
      return result
    } catch (error) {
      quote.pricingRevision = before
      throw error
    }
  },
}))
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown>) => { for (const phase of phases) await phase() },
}))
jest.mock('../costResolution', () => ({
  isQuoteCostLocked: async (_em: unknown, quote: { cpqStatus: string }) => !['new', 'incomplete', 'ready'].includes(quote.cpqStatus),
}))
import { CpqCostSourcingService } from '../costSourcingService'
import type { SourcingSignal } from '../sourcingSignals'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const ids = { quote: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', cost: '33333333-3333-4333-8333-333333333333', req: '55555555-5555-4555-8555-555555555555' }
const ACTOR = '44444444-4444-4444-8444-444444444444'
type Row = Record<string, any>

function setup(opts: { status?: string; orders?: Row[]; costs?: Row[]; line?: Row; quoteType?: string; sales?: boolean; element?: Row | null; enabled?: boolean; fx?: jest.Mock } = {}) {
  const quote = { id: ids.quote, quoteId: 'sales-1', cpqStatus: opts.status ?? 'ready', quoteType: opts.quoteType ?? 'new', currencyCode: 'EUR', pricingRevision: 4 }
  const line = { quoteLineId: ids.line, ...SCOPE, quoteConfigurationId: ids.quote, action: null, configuration: {}, deletedAt: null, ...opts.line }
  const costs: Row[] = opts.costs ?? [cost()]
  const element = opts.element === undefined ? { id: 'el', defaultSupplierId: 'sup-default', defaultSupplierName: 'Default Carrier' } : opts.element
  const em: Row = {
    __quote: quote,
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === SalesQuote) return opts.sales === false ? null : { id: 'sales-1' }
      if (entity === CpqOrderConfiguration) return (opts.orders ?? [])[0] ?? null
      if (entity === CpqQuoteLineConfiguration) return where.quoteLineId === ids.line ? line : null
      if (entity === CpqQuoteLineCost) return costs.find((row) => row.id === where.id && !row.deletedAt) ?? null
      if (entity === CpqChargeCostElement) return element
      if (entity === CpqQuoteConfiguration) return quote
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteConfiguration) return []
      if (entity !== CpqQuoteLineCost) return []
      return costs.filter((row) => !row.deletedAt && row.sourcingStatus === where.sourcingStatus
        && (!where.quoteConfigurationId || row.quoteConfigurationId === where.quoteConfigurationId)
        && (!where.costElementId || where.costElementId.$in.includes(row.costElementId))
        && (!where.id?.$in || where.id.$in.includes(row.id)) && (!where.id?.$gt || row.id > where.id.$gt) && (!where.quoteLineId || where.quoteLineId.$in.includes(row.quoteLineId)))
    }),
    count: jest.fn(async (entity: unknown, where: Row) => (entity !== CpqQuoteLineCost ? 0
      : costs.filter((row) => !row.deletedAt && row.sourcingStatus === where.sourcingStatus
        && (!where.quoteConfigurationId || row.quoteConfigurationId === where.quoteConfigurationId)
        && (!where.id?.$in || where.id.$in.includes(row.id))).length)),
  }
  const publisher = jest.fn()
  const recalculate = jest.fn(async () => ({ id: ids.quote, cpqStatus: quote.cpqStatus, lines: [] }))
  const service = new CpqCostSourcingService({ em: em as never, costService: { enabled: jest.fn(async () => opts.enabled ?? true) }, quotingService: { recalculateLockedQuote: recalculate } as never, publisher, fxRateResolver: opts.fx ? { resolve: opts.fx } as never : undefined })
  return { service, em, quote, costs, publisher, recalculate }
}

function cost(over: Row = {}): Row {
  return {
    id: ids.cost, ...SCOPE, quoteConfigurationId: ids.quote, quoteId: 'sales-1', quoteLineId: ids.line, costKey: 'tail', chargeCode: 'tail', origin: 'catalog',
    costElementId: 'el', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'on_request', costModel: 'flat', valueStatus: 'estimated',
    valueOrigin: 'catalog', unitAmount: '7777.7700', currencyCode: 'EUR', sourcingStatus: 'not_requested', costRequestId: null, requestSeq: null,
    requestedAt: null, requestedByUserId: null, requestHistory: [], proposedAmount: null, deletedAt: null, ...over,
  }
}
const open = (over: Row = {}) => cost({ sourcingStatus: 'requested', costRequestId: ids.req, requestSeq: 2, requestedAt: new Date('2026-01-01'), requestedByUserId: 'u0',
  requestSupplierId: 'sup-1', proposedAmount: '9.0000', proposedAnswer: { unitAmount: '9' }, lastAnswerHash: 'h', ...over })

describe('request', () => {
  it('opens request seq 1 with a new id, the actor as requester and the element default supplier', async () => {
    const { service, costs } = setup()
    const result = await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 1, requestedByUserId: ACTOR, requestSupplierId: 'sup-default', requestSupplierName: 'Default Carrier', cancelReason: null })
    expect(costs[0].costRequestId).toEqual(expect.any(String))
    expect(costs[0].requestedAt).toBeInstanceOf(Date)
    expect(result.response).toEqual({ costId: ids.cost, sourcingStatus: 'requested', costRequestId: costs[0].costRequestId, requestSeq: 1, pricingRevision: 5 })
  })

  it('an explicit supplier overrides the default; a supplier name alone does not inherit the default id', async () => {
    const a = setup()
    await a.service.request(ids.quote, ids.cost, { supplierId: '66666666-6666-4666-8666-666666666666', supplierName: ' Carrier X ' }, ACTOR, SCOPE)
    expect(a.costs[0]).toMatchObject({ requestSupplierId: '66666666-6666-4666-8666-666666666666', requestSupplierName: 'Carrier X' })
    const b = setup()
    await b.service.request(ids.quote, ids.cost, { supplierName: 'Carrier Y' }, ACTOR, SCOPE)
    expect(b.costs[0]).toMatchObject({ requestSupplierId: null, requestSupplierName: 'Carrier Y' })
  })

  it('re-request closes the open one as cancelled (re_requested), opens seq + 1 and clears the proposal and idempotency key', async () => {
    const { service, costs } = setup({ costs: [open()] })
    const result = await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 3, proposedAmount: null, proposedAnswer: null, lastAnswerHash: null })
    expect(costs[0].costRequestId).not.toBe(ids.req)
    expect(costs[0].requestHistory).toEqual([{
      costRequestId: ids.req, requestSeq: 2, requestedAt: '2026-01-01T00:00:00.000Z', requestedByUserId: 'u0', closedAt: expect.any(String),
      closedByUserId: ACTOR, outcome: 'cancelled', reason: 're_requested', supplierId: 'sup-1',
    }])
    // Exactly one cancellation and one request signal (the events of step 12).
    expect(result.signals.map((signal) => signal.kind)).toEqual(['request_cancelled', 'requested'])
    expect(result.signals[0]).toMatchObject({ reason: 're_requested', costRequestId: ids.req, requestSeq: 2 })
    expect(result.signals[1]).toMatchObject({ requestSeq: 3, auto: false, requestedByUserId: ACTOR })
  })

  it('may request again after an answered / declined / cancelled request, and on a locked quote', async () => {
    for (const status of ['answered', 'declined', 'cancelled']) {
      const { service, costs } = setup({ costs: [open({ sourcingStatus: status })], status: 'with_customer' })
      const result = await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
      expect(costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 3 })
      expect(result.signals.map((signal) => signal.kind)).toEqual(['requested'])
    }
  })

  it('refuses a request on a catalog line whose element is inactive or deleted (409 COST_REQUEST_SUPERSEDED) and writes nothing', async () => {
    const { service, costs, publisher, quote } = setup({ element: null })
    await expect(service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    expect(costs[0]).toMatchObject({ sourcingStatus: 'not_requested', costRequestId: null, requestSeq: null })
    expect(publisher).not.toHaveBeenCalled()
    expect(quote.pricingRevision).toBe(4)
  })

  it('a manual line (no catalog element) can still be requested', async () => {
    const { service, costs } = setup({ costs: [cost({ origin: 'manual', costElementId: null })], element: null })
    await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSeq: 1 })
  })

  it('a carried cost line on a Renew mirror is eligible (R13)', async () => {
    const { service, costs } = setup({ quoteType: 'renew', line: { configuration: { _arcMirroredFromItemId: 'item-1', _arcCostPlusFrozen: true } }, costs: [cost({ origin: 'carried', costElementId: null })], element: null })
    await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'requested', requestSupplierId: null })
  })

  it('refuses a Cancel line and a frozen-unpriceable price-basis cost: 422 LINE_NOT_ELIGIBLE, nothing written', async () => {
    const cancelLine = setup({ quoteType: 'amend', line: { action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } } })
    await expect(cancelLine.service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE', details: { reason: 'CANCEL_LINE' } })
    expect(cancelLine.costs[0].sourcingStatus).toBe('not_requested')
    const frozen = setup({ quoteType: 'renew', line: { configuration: { _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostPlusFrozen: true } }, costs: [cost({ origin: 'catalog' })] })
    await expect(frozen.service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE', details: { reason: 'FROZEN_UNPRICEABLE' } })
  })

  it('checks quote state in order: closed / deleted sales quote -> QUOTE_CLOSED, order -> QUOTE_CONVERTED with the order id', async () => {
    for (const status of ['rejected', 'cancelled']) {
      await expect(setup({ status }).service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
    }
    await expect(setup({ sales: false }).service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
    await expect(setup({ orders: [{ id: 'order-1' }] }).service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE))
      .rejects.toMatchObject({ status: 409, message: 'QUOTE_CONVERTED', details: { orderId: 'order-1' } })
  })

  it('404s an unknown quote or cost line, honours expectedRevision, and 404s with the toggle off before touching anything', async () => {
    const { service, quote } = setup()
    await expect(service.request('99999999-9999-4999-8999-999999999999', ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    await expect(service.request(ids.quote, '99999999-9999-4999-8999-999999999999', {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    await expect(service.request(ids.quote, ids.cost, { expectedRevision: 1 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
    await service.request(ids.quote, ids.cost, { expectedRevision: 4 }, ACTOR, SCOPE)
    expect(quote.pricingRevision).toBe(5)
    const off = setup({ enabled: false })
    await expect(off.service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    expect(writeCalls.length).toBeGreaterThan(0)
    expect(off.em.findOne).not.toHaveBeenCalled()
  })

  it('goes through withQuotePricingWrite (lock + revision) with the actor and the cost pricing cause, and publishes the signals after commit', async () => {
    writeCalls.length = 0
    const { service, publisher } = setup()
    await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(writeCalls[0].options.events).toEqual({ pricingCause: 'cost', actorUserId: ACTOR })
    expect(writeCalls[0].options.marginTracker).toBeUndefined()
    expect(publisher).toHaveBeenCalledTimes(1)
    const [signals] = publisher.mock.calls[0] as [SourcingSignal[]]
    expect(signals).toEqual([expect.objectContaining({ kind: 'requested', costLineId: ids.cost, quoteConfigurationId: ids.quote, costKey: 'tail', auto: false })])
  })

  it('a refused write publishes nothing', async () => {
    const { service, publisher } = setup({ status: 'rejected' })
    await expect(service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toBeDefined()
    expect(publisher).not.toHaveBeenCalled()
  })

  it('the result carries no amount, supplier or note: ids, statuses and the sequence only', async () => {
    const { service } = setup({ costs: [cost({ supplierName: 'SecretSupplier', note: 'secret note' })] })
    const result = await service.request(ids.quote, ids.cost, { note: 'please hurry' }, ACTOR, SCOPE)
    const json = JSON.stringify({ response: result.response, audit: result.audit })
    for (const leak of ['7777', 'SecretSupplier', 'secret note', 'please hurry', 'Default Carrier', 'sup-default']) expect(json).not.toContain(leak)
    expect(result.audit.after).toMatchObject({ id: ids.cost, costKey: 'tail', sourcingStatus: 'requested', requestSeq: 1 })
  })

  it('rejects an unknown body key and an over-long note', async () => {
    const { service } = setup()
    await expect(service.request(ids.quote, ids.cost, { unitAmount: 1 } as never, ACTOR, SCOPE)).rejects.toThrow()
    await expect(service.request(ids.quote, ids.cost, { note: 'x'.repeat(501) }, ACTOR, SCOPE)).rejects.toThrow()
  })
})

describe('cancelRequest', () => {
  const body = { costRequestId: ids.req }

  it('cancels the current open request as cancelled_by_user, keeps the request id and the cost value, appends the history', async () => {
    const { service, costs } = setup({ costs: [open()] })
    const result = await service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'cancelled_by_user', costRequestId: ids.req, requestSeq: 2, proposedAmount: null, proposedAnswer: null, lastAnswerHash: null, unitAmount: '7777.7700', valueStatus: 'estimated' })
    expect(costs[0].requestHistory).toEqual([expect.objectContaining({ outcome: 'cancelled', reason: 'cancelled_by_user', closedByUserId: ACTOR })])
    expect(result.response).toEqual({ costId: ids.cost, sourcingStatus: 'cancelled', costRequestId: ids.req, requestSeq: 2, pricingRevision: 5 })
    expect(result.signals).toEqual([expect.objectContaining({ kind: 'request_cancelled', reason: 'cancelled_by_user', costRequestId: ids.req })])
  })

  it('works on a locked quote (status only)', async () => {
    const { service, costs } = setup({ costs: [open()], status: 'with_customer' })
    await service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)
    expect(costs[0].sourcingStatus).toBe('cancelled')
  })

  it('a stale request id is COST_REQUEST_SUPERSEDED, a closed request is REQUEST_NOT_OPEN, nothing written either way', async () => {
    const stale = setup({ costs: [open()] })
    await expect(stale.service.cancelRequest(ids.quote, ids.cost, { costRequestId: '66666666-6666-4666-8666-666666666666' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    expect(stale.costs[0].sourcingStatus).toBe('requested')
    const closed = setup({ costs: [open({ sourcingStatus: 'answered' })] })
    await expect(closed.service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'REQUEST_NOT_OPEN' })
    const never = setup()
    await expect(never.service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
  })

  it('QUOTE_CLOSED / QUOTE_CONVERTED apply, the toggle off is a 404, a missing id is a validation error', async () => {
    await expect(setup({ costs: [open()], status: 'cancelled' }).service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)).rejects.toMatchObject({ message: 'QUOTE_CLOSED' })
    await expect(setup({ costs: [open()], orders: [{ id: 'o' }] }).service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)).rejects.toMatchObject({ message: 'QUOTE_CONVERTED', details: { orderId: 'o' } })
    await expect(setup({ costs: [open()], enabled: false }).service.cancelRequest(ids.quote, ids.cost, body, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    await expect(setup().service.cancelRequest(ids.quote, ids.cost, {} as never, ACTOR, SCOPE)).rejects.toThrow()
  })
})

describe('cancelOpenRequests (the single cancellation helper)', () => {
  const other = (over: Row = {}) => open({ id: '77777777-7777-4777-8777-777777777777', quoteLineId: 'line-2', ...over })

  it('cancels every open request of the quote with the reason, history and signals; closed ones stay', async () => {
    const { service, costs, em, quote } = setup({ costs: [open(), other(), cost({ id: 'plain' }), open({ id: 'answered-1', sourcingStatus: 'answered' })] })
    const signals: SourcingSignal[] = []
    const out = await service.cancelOpenRequests(em as never, quote, SCOPE, 'quote_closed', { actorUserId: ACTOR, signals })
    expect(out).toHaveLength(2)
    expect(signals).toHaveLength(2)
    expect(costs.map((row) => row.sourcingStatus)).toEqual(['cancelled', 'cancelled', 'not_requested', 'answered'])
    expect(costs[0]).toMatchObject({ cancelReason: 'quote_closed', proposedAmount: null })
    expect(costs[0].requestHistory[0]).toMatchObject({ outcome: 'cancelled', reason: 'quote_closed' })
    expect(out[0]).toMatchObject({ kind: 'request_cancelled', reason: 'quote_closed' })
  })

  it('can be limited to cost lines or quote lines, and runs with the toggle off (stored state is always cleaned)', async () => {
    const byCost = setup({ costs: [open(), other()], enabled: false })
    await byCost.service.cancelOpenRequests(byCost.em as never, byCost.quote, SCOPE, 'line_removed', { costIds: [ids.cost] })
    expect(byCost.costs.map((row) => row.sourcingStatus)).toEqual(['cancelled', 'requested'])
    const byLine = setup({ costs: [open(), other()] })
    await byLine.service.cancelOpenRequests(byLine.em as never, byLine.quote, SCOPE, 'line_removed', { quoteLineIds: ['line-2'] })
    expect(byLine.costs.map((row) => row.sourcingStatus)).toEqual(['requested', 'cancelled'])
  })
})

// ─── Answer / decline / apply-answer (steps 7-8) ─────────────────

const REF = 'CARR-889'
const answerInput = (over: Row = {}) => ({ costRequestId: ids.req, unitAmount: 280, currencyCode: 'EUR', supplierQuoteRef: REF, ...over })
const requested = (over: Row = {}) => cost({
  sourcingStatus: 'requested', costRequestId: ids.req, requestSeq: 1, requestedAt: new Date('2026-01-01T00:00:00Z'), requestedByUserId: 'u0',
  requestSupplierId: 'sup-1', lastAnswerHash: null, supplierQuoteRef: null, ...over,
})

describe('answer: unlocked quote', () => {
  it('applies the value (origin supplier), closes the request into history, re-prices and signals `valued` without an amount', async () => {
    const { service, costs, recalculate, quote } = setup({ costs: [requested()] })
    const result = await service.answer(ids.quote, ids.cost, answerInput({ supplierName: 'Carrier', validUntil: '2999-01-01' }), ACTOR, SCOPE)
    expect(result.response).toMatchObject({ outcome: 'applied', lineReady: true, pricingRevision: 5, cost: { unitAmount: '280', valueStatus: 'confirmed', valueOrigin: 'supplier' } })
    expect(costs[0]).toMatchObject({
      sourcingStatus: 'answered', valueStatus: 'confirmed', valueOrigin: 'supplier', unitAmount: '280', instanceAmount: '280', currencyCode: 'EUR',
      supplierQuoteRef: REF, supplierName: 'Carrier', supplierId: 'sup-1', validUntil: '2999-01-01', answeredByUserId: ACTOR, proposedAmount: null, errorCode: null,
    })
    expect(costs[0].lastAnswerHash).toMatch(/^[0-9a-f]{64}$/)
    expect(costs[0].requestHistory).toEqual([expect.objectContaining({ costRequestId: ids.req, outcome: 'answered', supplierQuoteRef: REF, closedByUserId: ACTOR })])
    expect(recalculate).toHaveBeenCalledTimes(1)
    expect(quote.pricingRevision).toBe(5)
    const valued = result.signals.find((signal) => signal.kind === 'valued')
    expect(valued).toMatchObject({ cause: 'answer', valueStatus: 'confirmed', previousValueStatus: 'estimated', valueChanged: true, answerPending: false, lineReady: true, requestedByUserId: 'u0' })
    expect(JSON.stringify(result.signals)).not.toMatch(/280|7777/)
  })

  it('[FX step 7: foreign leg without a rate is unchanged] an estimated answer applies as estimated; a non-quote currency with no rate is stored and resolves to none + CURRENCY_NO_RATE', async () => {
    const a = setup({ costs: [requested()] })
    await a.service.answer(ids.quote, ids.cost, answerInput({ valueStatus: 'estimated' }), ACTOR, SCOPE)
    expect(a.costs[0].valueStatus).toBe('estimated')
    const b = setup({ costs: [requested()] })
    await b.service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'USD' }), ACTOR, SCOPE)
    // The supplier's amount is kept in its own currency (for the FX feature); no instance amount, so nothing prices from it.
    expect(b.costs[0]).toMatchObject({ valueStatus: 'none', instanceAmount: null, currencyCode: 'USD', errorCode: 'CURRENCY_NO_RATE', sourcingStatus: 'answered' })
    expect(Number(b.costs[0].unitAmount)).toBe(280)
    expect(b.costs[0]).toMatchObject({ fxRate: null, fxRateSource: null })
  })

  it('FX step 7: a foreign answer resolves its rate in the same write, like a manual value, and keeps the answered status', async () => {
    const fx = jest.fn(async () => ({ ok: true, rate: '0.92000000', rateDate: '2026-11-11', source: 'ECB', derivation: 'direct' }))
    const a = setup({ costs: [requested()], fx })
    await a.service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'USD', valueStatus: 'confirmed' }), ACTOR, SCOPE)
    expect(fx).toHaveBeenCalledWith({ from: 'USD', to: 'EUR', scope: SCOPE })
    expect(a.costs[0]).toMatchObject({
      valueStatus: 'confirmed', valueOrigin: 'supplier', currencyCode: 'USD', unitAmount: '280', instanceAmount: '280', errorCode: null,
      fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'direct',
    })
    // A quote-currency answer never reads a rate and clears a snapshot left by an earlier foreign value.
    const b = setup({ costs: [requested({ currencyCode: 'USD', fxRate: '0.9', fxRateDate: '2026-10-01', fxRateSource: 'ECB', fxRateDerivation: 'direct' })], fx })
    fx.mockClear()
    await b.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    expect(fx).not.toHaveBeenCalled()
    expect(b.costs[0]).toMatchObject({ currencyCode: 'EUR', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null })
  })

  it('review1-a: confirmed_unchanged never promotes a foreign row that has no rate snapshot (it would read 1:1)', async () => {
    const noSnapshot = { currencyCode: 'USD', unitAmount: '280.0000', instanceAmount: null, valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null }
    const b = setup({ costs: [requested({ ...noSnapshot })], status: 'with_customer' })
    const result = await b.service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'USD', unitAmount: 280 }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('confirmed_unchanged')
    expect(b.costs[0]).toMatchObject({ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', fxRate: null, instanceAmount: null })
  })

  it('FX step 7: locked quote, price-basis: a foreign answer is a proposal (compared in the cost currency + code), same amount and currency confirms and keeps the snapshot', async () => {
    const fx = jest.fn(async () => ({ ok: true, rate: '0.95000000', rateDate: '2026-11-14', source: 'Manual', derivation: 'direct' }))
    const frozen = { currencyCode: 'USD', unitAmount: '280.0000', instanceAmount: '280.0000', fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'direct' }
    const proposal = setup({ costs: [requested({ ...frozen })], status: 'with_customer', fx })
    const result = await proposal.service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'USD', unitAmount: 300 }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('proposed')
    expect(fx).not.toHaveBeenCalled()
    expect(proposal.costs[0]).toMatchObject({ fxRate: '0.92000000', unitAmount: '280.0000', proposedAmount: '300.0000' })
    const same = setup({ costs: [requested({ ...frozen })], status: 'with_customer', fx })
    const confirmed = await same.service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'USD', unitAmount: 280 }), ACTOR, SCOPE)
    expect(confirmed.response.outcome).toBe('confirmed_unchanged')
    expect(fx).not.toHaveBeenCalled()
    expect(same.costs[0]).toMatchObject({ fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB' })
    // A different currency is a different value, even with the same number.
    const other = setup({ costs: [requested({ ...frozen })], status: 'with_customer', fx })
    expect((await other.service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'GBP', unitAmount: 280 }), ACTOR, SCOPE)).response.outcome).toBe('proposed')
  })

  it('FX step 7: a locked margin-only foreign answer takes the rate at the write date, without re-pricing', async () => {
    const fx = jest.fn(async () => ({ ok: true, rate: '0.95000000', rateDate: '2026-11-14', source: 'Manual', derivation: 'direct' }))
    const { service, costs, recalculate } = setup({ costs: [requested({ role: 'margin_only' })], status: 'with_customer', fx })
    const result = await service.answer(ids.quote, ids.cost, answerInput({ currencyCode: 'USD', unitAmount: 100 }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('applied')
    expect(costs[0]).toMatchObject({ currencyCode: 'USD', fxRate: '0.95000000', valueStatus: 'confirmed' })
    expect(recalculate).not.toHaveBeenCalled()
  })

  it('a carried line is accepted; a confirming answer clears renegotiationDue only where the column exists', async () => {
    const withColumn = setup({ costs: [requested({ origin: 'carried', costElementId: null, renegotiationDue: true })] })
    await withColumn.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    expect(withColumn.costs[0]).toMatchObject({ sourcingStatus: 'answered', renegotiationDue: false })
    const without = setup({ costs: [requested({ origin: 'carried', costElementId: null })] })
    await without.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    expect(without.costs[0]).not.toHaveProperty('renegotiationDue')
    expect(without.costs[0].sourcingStatus).toBe('answered')
  })

  it('a margin-only cost applies even on a locked quote, without re-pricing', async () => {
    const { service, costs, recalculate } = setup({ costs: [requested({ role: 'margin_only' })], status: 'with_customer' })
    const result = await service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 999 }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('applied')
    expect(costs[0]).toMatchObject({ unitAmount: '999', proposedAmount: null })
    expect(recalculate).not.toHaveBeenCalled()
  })
})

describe('answer: refusals and idempotency (I-13) write nothing', () => {
  const attempt = async (setupOpts: Parameters<typeof setup>[0], input: Row = answerInput()) => {
    const ctx = setup(setupOpts)
    const snapshot = JSON.stringify(ctx.costs)
    const outcome: { value?: unknown; error?: any } = await ctx.service.answer(ids.quote, ids.cost, input as never, ACTOR, SCOPE).then((value) => ({ value }), (error) => ({ error }))
    expect(JSON.stringify(ctx.costs)).toBe(snapshot)
    expect(ctx.recalculate).not.toHaveBeenCalled()
    return { ...ctx, ...outcome }
  }

  it('stale request id is 409 COST_REQUEST_SUPERSEDED, also with the same ref as an applied answer (never 200)', async () => {
    const first = setup({ costs: [requested()] })
    await first.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    const applied = first.costs[0]
    const reRequested = { ...applied, costRequestId: '77777777-7777-4777-8777-777777777777', sourcingStatus: 'requested', lastAnswerHash: null }
    const stale = await attempt({ costs: [reRequested] })
    expect(stale.error).toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    const sameRef = await attempt({ costs: [{ ...applied, costRequestId: '77777777-7777-4777-8777-777777777777' }] })
    expect(sameRef.error).toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    expect((await attempt({ costs: [cost()] })).error).toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
  })

  it('retry with the same ref and payload is a 200 noop: no revision bump, no write, no signal', async () => {
    const first = setup({ costs: [requested()] })
    await first.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    const second = setup({ costs: [first.costs[0]] })
    const revision = second.quote.pricingRevision
    const result = await second.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    expect(result.response).toMatchObject({ outcome: 'noop', pricingRevision: revision })
    expect(second.quote.pricingRevision).toBe(revision)
    expect(result.signals).toEqual([])
    expect(second.recalculate).not.toHaveBeenCalled()
    expect(second.publisher).not.toHaveBeenCalled()
  })

  it('same ref with a different payload is 409 SUPPLIER_QUOTE_REF_CONFLICT', async () => {
    const first = setup({ costs: [requested()] })
    await first.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    const outcome = await attempt({ costs: [first.costs[0]] }, answerInput({ unitAmount: 295 }))
    expect(outcome.error).toMatchObject({ status: 409, message: 'SUPPLIER_QUOTE_REF_CONFLICT' })
  })

  it('a closed request (declined / cancelled / answered under another ref) is 409 REQUEST_NOT_OPEN', async () => {
    for (const sourcingStatus of ['declined', 'cancelled', 'answered']) {
      const outcome = await attempt({ costs: [requested({ sourcingStatus })] }, answerInput({ supplierQuoteRef: 'OTHER' }))
      expect(outcome.error).toMatchObject({ status: 409, message: 'REQUEST_NOT_OPEN' })
    }
  })

  it('an inactive cost element is 409 COST_REQUEST_SUPERSEDED and the request is NOT cancelled by the refusal (Q4)', async () => {
    const outcome = await attempt({ costs: [requested()], element: null })
    expect(outcome.error).toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    expect(outcome.costs[0].sourcingStatus).toBe('requested')
  })

  it('a Cancel line is 422 LINE_NOT_ELIGIBLE (checked before the request id)', async () => {
    const outcome = await attempt({ costs: [requested()], quoteType: 'amend', line: { action: 'cancel' } }, answerInput({ costRequestId: '88888888-8888-4888-8888-888888888888' }))
    expect(outcome.error).toMatchObject({ status: 422, message: 'LINE_NOT_ELIGIBLE' })
  })

  it('closed quote, converted quote (with orderId) and toggle off (409 COST_PLUS_DISABLED, after the closed checks)', async () => {
    expect((await attempt({ costs: [requested()], status: 'rejected' })).error).toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
    expect((await attempt({ costs: [requested()], sales: false })).error).toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
    expect((await attempt({ costs: [requested()], orders: [{ id: 'order-1' }] })).error).toMatchObject({ status: 409, message: 'QUOTE_CONVERTED', details: { orderId: 'order-1' } })
    expect((await attempt({ costs: [requested()], enabled: false })).error).toMatchObject({ status: 409, message: 'COST_PLUS_DISABLED' })
    expect((await attempt({ costs: [requested()], enabled: false, status: 'cancelled' })).error).toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
  })

  it('unknown cost line is 404; invalid currency format and a past validUntil are 422', async () => {
    const ctx = setup({ costs: [requested()] })
    await expect(ctx.service.answer(ids.quote, '99999999-9999-4999-8999-999999999999', answerInput() as never, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    expect((await attempt({ costs: [requested()] }, answerInput({ currencyCode: 'EU' }))).error).toMatchObject({ status: 422, message: 'INVALID_CURRENCY_CODE' })
    expect((await attempt({ costs: [requested()] }, answerInput({ currencyCode: 'E1R' }))).error).toMatchObject({ status: 422, message: 'INVALID_CURRENCY_CODE' })
    expect((await attempt({ costs: [requested()] }, answerInput({ currencyCode: 'EURO' }))).error).toMatchObject({ status: 422 })
    expect((await attempt({ costs: [requested()] }, answerInput({ validUntil: '2000-01-01' }))).error).toMatchObject({ status: 422, message: 'VALID_UNTIL_IN_PAST' })
  })

  it('a lower-case currency code is accepted and stored upper-case', async () => {
    const { service, costs } = setup({ costs: [requested()] })
    const result = await service.answer(ids.quote, ids.cost, answerInput({ currencyCode: ' eur ' }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('applied')
    expect(costs[0].currencyCode).toBe('EUR')
  })

  it('a retried answer whose validUntil has passed meanwhile is still a noop (the date is checked after idempotency)', async () => {
    const first = setup({ costs: [requested()] })
    await first.service.answer(ids.quote, ids.cost, answerInput({ validUntil: '2999-01-01' }), ACTOR, SCOPE)
    const retry = setup({ costs: [first.costs[0]] })
    const result = await retry.service.answer(ids.quote, ids.cost, answerInput({ validUntil: '2999-01-01' }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('noop')
  })
})

describe('answer: locked quote (R11)', () => {
  it('same amount and currency confirms: price untouched, no re-pricing, supplier and validity updated', async () => {
    const { service, costs, recalculate } = setup({ costs: [requested({ unitAmount: '276.0000', instanceAmount: '276.0000' })], status: 'with_customer' })
    const result = await service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 276, validUntil: '2999-01-01', supplierName: 'Carrier' }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('confirmed_unchanged')
    expect(costs[0]).toMatchObject({ valueStatus: 'confirmed', valueOrigin: 'supplier', unitAmount: '276.0000', instanceAmount: '276.0000', proposedAmount: null, sourcingStatus: 'answered', validUntil: '2999-01-01', supplierName: 'Carrier' })
    expect(recalculate).not.toHaveBeenCalled()
  })

  it('a different value is stored as a proposal only: amount, status and charges unchanged, answerPending signalled', async () => {
    const { service, costs, recalculate } = setup({ costs: [requested({ unitAmount: '276.0000', instanceAmount: '276.0000' })], status: 'with_customer' })
    const result = await service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 310 }), ACTOR, SCOPE)
    expect(result.response.outcome).toBe('proposed')
    expect(costs[0]).toMatchObject({ unitAmount: '276.0000', valueStatus: 'estimated', sourcingStatus: 'answered', proposedAmount: '310.0000' })
    expect(costs[0].proposedAnswer).toMatchObject({ unitAmount: '310.0000', currencyCode: 'EUR', supplierQuoteRef: REF, valueStatus: 'confirmed' })
    expect(costs[0].proposedAnswer).not.toHaveProperty('costRequestId')
    expect(recalculate).not.toHaveBeenCalled()
    expect(result.signals.find((signal) => signal.kind === 'valued')).toMatchObject({ answerPending: true, valueChanged: false })
  })

  it('a retried proposal is a noop and a changed payload under the same ref conflicts (the proposal ref is the idempotency ref)', async () => {
    const first = setup({ costs: [requested({ unitAmount: '276.0000' })], status: 'with_customer' })
    await first.service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 310 }), ACTOR, SCOPE)
    const again = setup({ costs: [first.costs[0]], status: 'with_customer' })
    expect((await again.service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 310 }), ACTOR, SCOPE)).response.outcome).toBe('noop')
    await expect(again.service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 320 }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: 'SUPPLIER_QUOTE_REF_CONFLICT' })
  })
})

describe('decline (Q3)', () => {
  const declineInput = { costRequestId: ids.req, reason: 'No coverage at site' }

  it('unlocked: value none, the estimate moves into the note, request closed as declined, quote re-priced', async () => {
    const { service, costs, recalculate } = setup({ costs: [requested({ unitAmount: '300.0000', instanceAmount: '300.0000' })] })
    const result = await service.decline(ids.quote, ids.cost, declineInput, ACTOR, SCOPE)
    expect(result.response).toMatchObject({ outcome: 'declined', pricingRevision: 5 })
    expect(costs[0]).toMatchObject({ sourcingStatus: 'declined', declineReason: 'No coverage at site', valueStatus: 'none', unitAmount: null, instanceAmount: null, valueOrigin: 'supplier', answeredByUserId: ACTOR })
    expect(costs[0].note).toBe('estimate 300 discarded: declined')
    expect(costs[0].requestHistory).toEqual([expect.objectContaining({ outcome: 'declined', declineReason: 'No coverage at site' })])
    expect(recalculate).toHaveBeenCalledTimes(1)
    expect(result.signals.find((signal) => signal.kind === 'valued')).toMatchObject({ cause: 'decline', valueStatus: 'none', previousValueStatus: 'estimated', valueChanged: true })
  })

  it('locked price-basis: the amount is kept and downgraded to estimated; no re-pricing', async () => {
    const { service, costs, recalculate } = setup({ costs: [requested({ unitAmount: '300.0000', valueStatus: 'confirmed' })], status: 'with_customer' })
    await service.decline(ids.quote, ids.cost, declineInput, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'declined', valueStatus: 'estimated', unitAmount: '300.0000' })
    expect(recalculate).not.toHaveBeenCalled()
  })

  it('locked margin-only follows the unlocked rule (lock-exempt)', async () => {
    const { service, costs } = setup({ costs: [requested({ role: 'margin_only', unitAmount: '50.0000' })], status: 'with_customer' })
    await service.decline(ids.quote, ids.cost, declineInput, ACTOR, SCOPE)
    expect(costs[0]).toMatchObject({ valueStatus: 'none', unitAmount: null })
  })

  it('refusals write nothing: answered / declined request is REQUEST_NOT_OPEN, stale id and inactive element are SUPERSEDED, closed / converted / disabled', async () => {
    const run = async (opts: Parameters<typeof setup>[0], input = declineInput) => {
      const ctx = setup(opts)
      const snapshot = JSON.stringify(ctx.costs)
      const error = await ctx.service.decline(ids.quote, ids.cost, input, ACTOR, SCOPE).then(() => null, (e) => e)
      expect(JSON.stringify(ctx.costs)).toBe(snapshot)
      return error
    }
    expect(await run({ costs: [requested({ sourcingStatus: 'answered' })] })).toMatchObject({ status: 409, message: 'REQUEST_NOT_OPEN' })
    expect(await run({ costs: [requested()] }, { ...declineInput, costRequestId: '88888888-8888-4888-8888-888888888888' })).toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    expect(await run({ costs: [requested()], element: null })).toMatchObject({ status: 409, message: 'COST_REQUEST_SUPERSEDED' })
    expect(await run({ costs: [requested()], status: 'cancelled' })).toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
    expect(await run({ costs: [requested()], orders: [{ id: 'o1' }] })).toMatchObject({ status: 409, message: 'QUOTE_CONVERTED' })
    expect(await run({ costs: [requested()], enabled: false })).toMatchObject({ status: 409, message: 'COST_PLUS_DISABLED' })
  })
})

describe('applyAnswer (#22a)', () => {
  const proposal = {
    unitAmount: '310.0000', currencyCode: 'EUR', valueStatus: 'confirmed', supplierId: null, supplierName: 'Carrier', supplierQuoteRef: REF,
    validUntil: '2999-01-01', supplierTermEnd: null, supplierMinTermMonths: null, note: null,
  }
  const pending = (over: Row = {}) => requested({
    sourcingStatus: 'answered', unitAmount: '276.0000', instanceAmount: '276.0000', proposedAmount: '310.0000', proposedAnswer: proposal,
    lastAnswerHash: 'h'.repeat(64), answeredAt: new Date(), ...over,
  })

  it('moves the quote to ready, applies the proposal under the same request id, clears it and re-prices in ONE write', async () => {
    const { service, quote, costs, recalculate } = setup({ costs: [pending()], status: 'with_customer' })
    const order: string[] = []
    recalculate.mockImplementation(async () => { order.push(`recalc:${quote.cpqStatus}`); return { id: ids.quote, cpqStatus: 'ready', lines: [] } as never })
    const result = await service.applyAnswer(ids.quote, ids.cost, { expectedRevision: 4 }, ACTOR, SCOPE)
    expect(order).toEqual(['recalc:ready'])
    expect(quote.cpqStatus).toBe('ready')
    expect(costs[0]).toMatchObject({
      unitAmount: '310', instanceAmount: '310', valueStatus: 'confirmed', valueOrigin: 'supplier', proposedAmount: null, proposedAnswer: null,
      costRequestId: ids.req, sourcingStatus: 'answered', supplierQuoteRef: REF, validUntil: '2999-01-01', supplierName: 'Carrier',
    })
    expect(result.response).toMatchObject({ cpqStatus: 'ready', pricingRevision: 5, cost: { unitAmount: '310', hasAnswerPending: false } })
    expect(result.signals.find((signal) => signal.kind === 'valued')).toMatchObject({ cause: 'apply_answer', answerPending: false, valueChanged: true })
  })

  it('takes the status event cause manual and the cost pricing cause; the margin tracker is wired', async () => {
    const { service } = setup({ costs: [pending()], status: 'with_customer' })
    await service.applyAnswer(ids.quote, ids.cost, { expectedRevision: 4 }, ACTOR, SCOPE)
    const options = writeCalls[writeCalls.length - 1].options
    expect(options).toMatchObject({ expectedRevision: 4, events: { pricingCause: 'cost', statusCause: 'manual', actorUserId: ACTOR } })
    expect(options.marginTracker).toBeDefined()
  })

  it('a retried answer after apply is a noop (the hash and the applied ref are kept)', async () => {
    const first = setup({ costs: [requested({ unitAmount: '276.0000' })], status: 'with_customer' })
    await first.service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 310 }), ACTOR, SCOPE)
    const second = setup({ costs: [first.costs[0]], status: 'with_customer' })
    await second.service.applyAnswer(ids.quote, ids.cost, { expectedRevision: 4 }, ACTOR, SCOPE)
    const third = setup({ costs: [second.costs[0]], status: 'ready' })
    expect((await third.service.answer(ids.quote, ids.cost, answerInput({ unitAmount: 310 }), ACTOR, SCOPE)).response.outcome).toBe('noop')
  })

  it('refusals write nothing: STALE_REVISION, NO_PENDING_ANSWER, QUOTE_CLOSED, QUOTE_CONVERTED, unknown cost 404, toggle off 404', async () => {
    const run = async (opts: Parameters<typeof setup>[0], revision = 4, id = ids.cost) => {
      const ctx = setup(opts)
      const snapshot = JSON.stringify(ctx.costs)
      const error = await ctx.service.applyAnswer(ids.quote, id, { expectedRevision: revision }, ACTOR, SCOPE).then(() => null, (e) => e)
      expect(JSON.stringify(ctx.costs)).toBe(snapshot)
      expect(ctx.recalculate).not.toHaveBeenCalled()
      expect(ctx.quote.cpqStatus).toBe(opts?.status ?? 'ready')
      return error
    }
    expect(await run({ costs: [pending()], status: 'with_customer' }, 3)).toMatchObject({ status: 409, message: 'STALE_REVISION' })
    expect(await run({ costs: [requested()], status: 'with_customer' })).toMatchObject({ status: 409, message: 'NO_PENDING_ANSWER' })
    expect(await run({ costs: [pending({ proposedAmount: null })], status: 'with_customer' })).toMatchObject({ status: 409, message: 'NO_PENDING_ANSWER' })
    expect(await run({ costs: [pending()], status: 'rejected' })).toMatchObject({ status: 409, message: 'QUOTE_CLOSED' })
    expect(await run({ costs: [pending()], status: 'accepted', orders: [{ id: 'order-1' }] })).toMatchObject({ status: 409, message: 'QUOTE_CONVERTED', details: { orderId: 'order-1' } })
    expect(await run({ costs: [pending()], status: 'with_customer' }, 4, '99999999-9999-4999-8999-999999999999')).toMatchObject({ status: 404 })
    expect(await run({ costs: [pending()], status: 'with_customer', enabled: false })).toMatchObject({ status: 404 })
  })
})

describe('element deactivation fan-out (Q4)', () => {
  const quoteB = '66666666-6666-4666-8666-666666666666'
  const costB = '77777777-7777-4777-8777-777777777777'

  it('cancels the open requests on the element per quote in its own write; a failing quote is logged and does not stop the others', async () => {
    const quotes = { [ids.quote]: { id: ids.quote, quoteId: 'sales-1', cpqStatus: 'ready', pricingRevision: 4 }, [quoteB]: { id: quoteB, quoteId: 'sales-b', cpqStatus: 'ready', pricingRevision: 9 } }
    const a = open({ id: ids.cost, requestHistory: [] })
    const b = open({ id: costB, quoteConfigurationId: quoteB, requestHistory: [] })
    const other = open({ id: 'other-cost', costElementId: 'other-el', requestHistory: [] })
    const { service, em, publisher, costs } = setup({ costs: [a, b, other] })
    em.__quotes = quotes
    const find = em.find as jest.Mock
    const inner = find.getMockImplementation()!
    // quote B's per-quote cancel read fails (its own write): the fan-out query itself carries `costElementId`
    find.mockImplementation(async (entity: unknown, where: Row, ...rest: unknown[]) => {
      if (entity === CpqQuoteLineCost && where.quoteConfigurationId === quoteB && !where.costElementId) throw new Error('boom')
      return inner(entity, where, ...rest)
    })
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    writeCalls.length = 0
    const out = await service.cancelRequestsForElements(['el'], SCOPE, ACTOR)
    expect(out).toEqual({ quotes: 2, cancelled: 1, failed: 1 })
    expect(a).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'element_deactivated', costRequestId: ids.req, proposedAmount: null })
    expect(a.requestHistory).toEqual([expect.objectContaining({ outcome: 'cancelled', reason: 'element_deactivated', closedByUserId: ACTOR })])
    expect(b.sourcingStatus).toBe('requested')
    expect(costs.find((row) => row.id === 'other-cost')!.sourcingStatus).toBe('requested')
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(quoteB), expect.any(Error))
    expect(publisher).toHaveBeenCalledTimes(1)
    expect(publisher).toHaveBeenCalledWith([expect.objectContaining({ kind: 'request_cancelled', reason: 'element_deactivated', costLineId: ids.cost })], expect.objectContaining({ id: ids.quote }))
    // one write (own lock + revision) per quote
    expect(writeCalls).toHaveLength(2)
    expect(quotes[ids.quote].pricingRevision).toBe(5)
    errors.mockRestore()
  })

  it('does nothing without elements or open requests, and a request closed meanwhile is a no-op without a revision bump', async () => {
    const { service, quote, em } = setup({ costs: [cost()] })
    expect(await service.cancelRequestsForElements([], SCOPE)).toEqual({ quotes: 0, cancelled: 0, failed: 0 })
    expect(await service.cancelRequestsForElements(['el'], SCOPE)).toEqual({ quotes: 0, cancelled: 0, failed: 0 })
    // the quote's request is answered between the fan-out read and its write
    const racing = setup({ costs: [open()] })
    const count = racing.em.count as jest.Mock
    count.mockResolvedValue(0)
    expect(await racing.service.cancelRequestsForElements(['el'], SCOPE)).toEqual({ quotes: 1, cancelled: 0, failed: 0 })
    expect(racing.quote.pricingRevision).toBe(4)
    expect(quote.pricingRevision).toBe(4)
    expect(em.count).not.toHaveBeenCalled()
  })

  it('never throws when reading the open requests fails', async () => {
    const { service, em } = setup({ costs: [open()] })
    ;(em.find as jest.Mock).mockRejectedValue(new Error('db down'))
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(service.cancelRequestsForElements(['el'], SCOPE)).resolves.toEqual({ quotes: 0, cancelled: 0, failed: 1 })
    errors.mockRestore()
  })
})

describe('cancelRequestsForSalesQuote (Q7)', () => {
  it('cancels the open requests of the CPQ quote wrapping the sales quote (quote_closed)', async () => {
    const row = open({ requestHistory: [] })
    const { service, em, quote, publisher } = setup({ costs: [row] })
    ;(em.findOne as jest.Mock).mockImplementation(async (entity: unknown) => (entity === CpqQuoteConfiguration ? quote : null))
    expect(await service.cancelRequestsForSalesQuote('sales-1', SCOPE)).toBe(1)
    expect(row).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'quote_closed', proposedAmount: null })
    expect(publisher).toHaveBeenCalledWith([expect.objectContaining({ kind: 'request_cancelled', reason: 'quote_closed' })], expect.anything())
    expect(em.findOne).toHaveBeenCalledWith(CpqQuoteConfiguration, expect.objectContaining({ quoteId: 'sales-1', organizationId: 'org', tenantId: 'tenant', deletedAt: null }))
  })

  it('is idempotent: nothing open means no write and no revision bump; no CPQ quote means a no-op', async () => {
    const closed = setup({ costs: [cost({ sourcingStatus: 'cancelled' })] })
    ;(closed.em.findOne as jest.Mock).mockImplementation(async (entity: unknown) => (entity === CpqQuoteConfiguration ? closed.quote : null))
    expect(await closed.service.cancelRequestsForSalesQuote('sales-1', SCOPE)).toBe(0)
    expect(closed.quote.pricingRevision).toBe(4)
    const none = setup()
    expect(await none.service.cancelRequestsForSalesQuote('sales-x', SCOPE)).toBe(0)
  })
})
