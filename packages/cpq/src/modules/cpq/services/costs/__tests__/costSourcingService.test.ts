import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost,
} from '../../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

const writeCalls: Array<{ options: Record<string, any> }> = []
jest.mock('../../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: async (em: any, quoteId: string, _scope: unknown, execute: any, makeError: any, options: any) => {
    writeCalls.push({ options })
    const quote = em.__quote
    if (!quote || quote.id !== quoteId) throw makeError(404, 'Quote not found')
    if (options.expectedRevision !== undefined && options.expectedRevision !== (quote.pricingRevision ?? 0)) throw makeError(409, 'STALE_REVISION')
    const before = quote.pricingRevision
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
import { CpqCostSourcingService } from '../costSourcingService'
import type { SourcingSignal } from '../sourcingSignals'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const ids = { quote: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', cost: '33333333-3333-4333-8333-333333333333', req: '55555555-5555-4555-8555-555555555555' }
const ACTOR = '44444444-4444-4444-8444-444444444444'
type Row = Record<string, any>

function setup(opts: { status?: string; orders?: Row[]; costs?: Row[]; line?: Row; quoteType?: string; sales?: boolean; element?: Row | null; enabled?: boolean } = {}) {
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
      if (entity !== CpqQuoteLineCost) return []
      return costs.filter((row) => !row.deletedAt && row.sourcingStatus === where.sourcingStatus
        && (!where.id || where.id.$in.includes(row.id)) && (!where.quoteLineId || where.quoteLineId.$in.includes(row.quoteLineId)))
    }),
  }
  const publisher = jest.fn()
  const service = new CpqCostSourcingService({ em: em as never, costService: { enabled: jest.fn(async () => opts.enabled ?? true) }, publisher })
  return { service, em, quote, costs, publisher }
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
