import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost,
} from '../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

// Same commit model as the real `withQuotePricingWrite`: no afterCommit on a short-circuit (no-op) or a thrown write.
jest.mock('../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: async (em: any, quoteId: string, _scope: unknown, execute: any, makeError: any, options: any) => {
    const quote = em.__quote
    if (!quote || quote.id !== quoteId) throw makeError(404, 'Quote not found')
    const before = quote.pricingRevision
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
jest.mock('../costs/costResolution', () => ({
  isQuoteCostLocked: async (_em: unknown, quote: { cpqStatus: string }) => !['new', 'incomplete', 'ready'].includes(quote.cpqStatus),
  driverAttributes: (element: { applicabilityCondition?: { attribute?: string } }) => (element.applicabilityCondition?.attribute ? [element.applicabilityCondition.attribute] : []),
}))
import { CpqCostSourcingService } from '../costs/costSourcingService'
import { createSourcingPublisher } from '../costs/sourcingPublisher'
import { buildSourcingEvents, SourcingEventBuffer } from '../costs/sourcingEventBuffer'
import type { SourcingSignal } from '../costs/sourcingSignals'
import { eventsConfig } from '../../events'

const SENTINEL = '7777.77'
const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const ids = { quote: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', cost: '33333333-3333-4333-8333-333333333333', req: '55555555-5555-4555-8555-555555555555' }
const ACTOR = '44444444-4444-4444-8444-444444444444'
type Row = Record<string, any>

const AMOUNT_KEY = /(amount|unitprice|markup|margin|instance|price)/i
/** Every key (at any depth) that could carry money. `valueStatus` / `valueChanged` are statuses, not amounts. */
function amountKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => amountKeys(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Row).flatMap(([key, entry]) => (AMOUNT_KEY.test(key) ? [`${path}.${key}`] : []).concat(amountKeys(entry, `${path}.${key}`)))
  }
  return []
}

function cost(over: Row = {}): Row {
  return {
    id: ids.cost, ...SCOPE, quoteConfigurationId: ids.quote, quoteId: 'sales-1', quoteLineId: ids.line, costKey: 'tail', chargeCode: 'tail', origin: 'catalog',
    costElementId: 'el', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'on_request', costModel: 'flat', valueStatus: 'estimated',
    valueOrigin: 'catalog', unitAmount: `${SENTINEL}00`.slice(0, 7) + '00', currencyCode: 'EUR', sourcingStatus: 'not_requested', costRequestId: null, requestSeq: null,
    requestedAt: null, requestedByUserId: null, requestHistory: [], proposedAmount: null, deletedAt: null, ...over,
  }
}
const requested = (over: Row = {}) => cost({
  sourcingStatus: 'requested', costRequestId: ids.req, requestSeq: 1, requestedAt: new Date('2026-01-01T00:00:00Z'), requestedByUserId: 'u0',
  requestSupplierId: 'sup-1', lastAnswerHash: null, supplierQuoteRef: null, ...over,
})
const answerInput = (over: Row = {}) => ({ costRequestId: ids.req, unitAmount: 280, currencyCode: 'EUR', supplierQuoteRef: 'CARR-889', ...over })

function setup(opts: { status?: string; costs?: Row[]; emit?: jest.Mock } = {}) {
  const quote = { id: ids.quote, quoteId: 'sales-1', cpqStatus: opts.status ?? 'ready', quoteType: 'new', currencyCode: 'EUR', pricingRevision: 4 }
  const line = { quoteLineId: ids.line, ...SCOPE, quoteConfigurationId: ids.quote, action: null, productId: 'prod-1', offeringId: 'off-1', configuration: { speed: '10G', secret: 'x' }, deletedAt: null }
  const element = { id: 'el', defaultSupplierId: 'sup-default', defaultSupplierName: 'Default Carrier', applicabilityCondition: { attribute: 'speed' }, costTableId: null }
  const costs: Row[] = opts.costs ?? [cost()]
  const em: Row = {
    __quote: quote,
    fork: jest.fn(() => em),
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === SalesQuote) return { id: 'sales-1' }
      if (entity === CpqOrderConfiguration) return null
      if (entity === CpqQuoteLineConfiguration) return where.quoteLineId === ids.line ? line : null
      if (entity === CpqQuoteLineCost) return costs.find((row) => row.id === where.id && !row.deletedAt) ?? null
      if (entity === CpqChargeCostElement) return element
      if (entity === CpqQuoteConfiguration) return quote
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteLineConfiguration) return [line]
      if (entity === CpqChargeCostElement) return [element]
      if (entity !== CpqQuoteLineCost) return []
      if (where.id?.$in) return costs.filter((row) => where.id.$in.includes(row.id))
      return costs.filter((row) => !row.deletedAt && row.sourcingStatus === where.sourcingStatus && (!where.quoteConfigurationId || row.quoteConfigurationId === where.quoteConfigurationId)
        && (!where.costElementId || where.costElementId.$in.includes(row.costElementId)))
    }),
    count: jest.fn(async (entity: unknown, where: Row) => (entity !== CpqQuoteLineCost ? 0
      : costs.filter((row) => !row.deletedAt && row.sourcingStatus === where.sourcingStatus
        && (!where.quoteConfigurationId || row.quoteConfigurationId === where.quoteConfigurationId) && (!where.id?.$in || where.id.$in.includes(row.id))).length)),
  }
  const emit = opts.emit ?? jest.fn(async () => undefined)
  const publisher = createSourcingPublisher({ em: em as never, emit })
  const recalculate = jest.fn(async () => ({ id: ids.quote, cpqStatus: quote.cpqStatus, lines: [] }))
  const service = new CpqCostSourcingService({ em: em as never, costService: { enabled: jest.fn(async () => true) }, quotingService: { recalculateLockedQuote: recalculate } as never, publisher })
  return { service, em, quote, costs, emit }
}
const emitted = (emit: jest.Mock) => emit.mock.calls.map(([id, payload]) => [id as string, payload as Row] as const)
const ids_of = (emit: jest.Mock) => emitted(emit).map(([id]) => id)

describe('declarations', () => {
  it('declares the three sourcing events, none broadcast, each with a payloadSchema and no amount field', () => {
    for (const id of ['cpq.quote.cost_requested', 'cpq.quote.cost_request_cancelled', 'cpq.quote.cost_valued']) {
      const event = eventsConfig.events.find((entry) => entry.id === id) as { clientBroadcast?: boolean; payloadSchema?: { fields: Array<{ path: string }> } } | undefined
      expect(event).toBeDefined()
      expect(event!.clientBroadcast).toBe(false)
      expect(event!.payloadSchema!.fields.length).toBeGreaterThan(5)
      expect(event!.payloadSchema!.fields.map((field) => field.path).filter((path) => AMOUNT_KEY.test(path))).toEqual([])
    }
  })
})

describe('SourcingEventBuffer / buildSourcingEvents', () => {
  const ref = { quoteConfigurationId: ids.quote, quoteId: 'sales-1', quoteLineId: ids.line, costLineId: ids.cost, costKey: 'tail', costName: 'Tail', chargeCode: 'tail' }
  const quote = { id: ids.quote, ...SCOPE }

  it('maps each signal to exactly one event and de-duplicates a request that is signalled twice', () => {
    const signals: SourcingSignal[] = [
      { ...ref, kind: 'requested', costRequestId: 'r1', requestSeq: 1, supplierId: null, requestedByUserId: ACTOR, auto: true },
      { ...ref, kind: 'requested', costRequestId: 'r1', requestSeq: 1, supplierId: null, requestedByUserId: ACTOR, auto: true },
      { ...ref, kind: 'request_cancelled', costRequestId: 'r0', requestSeq: 1, reason: 'reconfigured' },
      { ...ref, kind: 'request_cancelled', costRequestId: 'r0', requestSeq: 1, reason: 'reconfigured' },
    ]
    const buffer = buildSourcingEvents(signals, quote, new Map())
    expect(buffer.peek().map(([id]) => id)).toEqual(['cpq.quote.cost_requested', 'cpq.quote.cost_request_cancelled'])
  })

  it('flushes in order, swallows an emit failure and keeps emitting the rest, and empties the buffer', async () => {
    const buffer = new SourcingEventBuffer()
    buffer.add('a', {}); buffer.add('b', {}); buffer.add('c', {})
    const emit = jest.fn(async (id: string) => { if (id === 'b') throw new Error('bus down') })
    const failed: string[] = []
    await buffer.flush(emit, (id) => failed.push(id))
    expect(emit.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])
    expect(failed).toEqual(['b'])
    expect(buffer.size).toBe(0)
  })

  it('a valued signal keeps statuses and flags only (no amount keys)', () => {
    const valued: SourcingSignal = {
      ...ref, kind: 'valued', cause: 'answer', costRequestId: 'r1', requestSeq: 2, valueStatus: 'confirmed', previousValueStatus: 'estimated',
      sourcingStatus: 'answered', valueChanged: true, answerPending: false, errorCode: null, lineReady: true, leadTimeHours: 12.5, requestedByUserId: ACTOR,
    }
    const [[id, payload]] = buildSourcingEvents([valued], quote, new Map(), '2026-01-01T00:00:00.000Z').peek()
    expect(id).toBe('cpq.quote.cost_valued')
    expect(payload).toMatchObject({ tenantId: 'tenant', organizationId: 'org', quoteId: ids.quote, quoteConfigurationId: ids.quote, salesQuoteId: 'sales-1', cause: 'answer', leadTimeHours: 12.5, occurredAt: '2026-01-01T00:00:00.000Z' })
    expect(amountKeys(payload)).toEqual([])
  })
})

describe('producer paths publish through the real publisher, exactly once', () => {
  it('manual request: one cost_requested with the line product / offering and only the driver attributes', async () => {
    const { service, emit } = setup()
    await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(ids_of(emit)).toEqual(['cpq.quote.cost_requested'])
    const [[, payload]] = emitted(emit)
    expect(payload).toMatchObject({
      quoteId: ids.quote, quoteLineId: ids.line, costLineId: ids.cost, costKey: 'tail', costName: 'Tail', chargeCode: 'tail', requestSeq: 1, supplierId: 'sup-default',
      requestedByUserId: ACTOR, auto: false, productId: 'prod-1', offeringId: 'off-1', attributes: { speed: '10G' },
    })
    expect(JSON.stringify(payload)).not.toContain('secret')
    expect(amountKeys(payload)).toEqual([])
  })

  it('re-request: one cost_request_cancelled (re_requested) and one cost_requested', async () => {
    const { service, emit } = setup({ costs: [requested({ requestSeq: 2 })] })
    await service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)
    expect(ids_of(emit).sort()).toEqual(['cpq.quote.cost_request_cancelled', 'cpq.quote.cost_requested'])
    expect(emitted(emit).find(([id]) => id === 'cpq.quote.cost_request_cancelled')![1]).toMatchObject({ reason: 're_requested', costRequestId: ids.req, requestSeq: 2 })
  })

  it('cancel-request: one cost_request_cancelled (cancelled_by_user)', async () => {
    const { service, emit } = setup({ costs: [requested()] })
    await service.cancelRequest(ids.quote, ids.cost, { costRequestId: ids.req }, ACTOR, SCOPE)
    expect(emitted(emit).map(([id, payload]) => [id, payload.reason])).toEqual([['cpq.quote.cost_request_cancelled', 'cancelled_by_user']])
  })

  it('answer: one cost_valued with the resolved status and lead time and no amount; the sentinel never appears', async () => {
    const { service, emit } = setup({ costs: [requested()] })
    await service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    expect(ids_of(emit)).toEqual(['cpq.quote.cost_valued'])
    const [[, payload]] = emitted(emit)
    expect(payload).toMatchObject({ cause: 'answer', valueStatus: 'confirmed', previousValueStatus: 'estimated', sourcingStatus: 'answered', valueChanged: true, answerPending: false, costRequestId: ids.req, requestedByUserId: 'u0' })
    expect(typeof payload.leadTimeHours).toBe('number')
    expect(amountKeys(payload)).toEqual([])
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/7777|280/)
  })

  it('decline: one cost_valued (decline)', async () => {
    const { service, emit } = setup({ costs: [requested()] })
    await service.decline(ids.quote, ids.cost, { costRequestId: ids.req, reason: 'no capacity' }, ACTOR, SCOPE)
    expect(emitted(emit).map(([id, payload]) => [id, payload.cause])).toEqual([['cpq.quote.cost_valued', 'decline']])
    expect(JSON.stringify(emit.mock.calls)).not.toContain('no capacity')
  })

  it('a repeated identical answer is a no-op: nothing is emitted', async () => {
    const first = setup({ costs: [requested()] })
    await first.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    const second = setup({ costs: [first.costs[0]] })
    await second.service.answer(ids.quote, ids.cost, answerInput(), ACTOR, SCOPE)
    expect(second.emit).not.toHaveBeenCalled()
  })

  it('a refused or rolled-back write emits nothing (closed quote, superseded id)', async () => {
    const closed = setup({ status: 'rejected', costs: [requested()] })
    await expect(closed.service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).rejects.toBeDefined()
    const stale = setup({ costs: [requested()] })
    await expect(stale.service.answer(ids.quote, ids.cost, answerInput({ costRequestId: '99999999-9999-4999-8999-999999999999' }), ACTOR, SCOPE)).rejects.toMatchObject({ status: 409 })
    expect(closed.emit).not.toHaveBeenCalled()
    expect(stale.emit).not.toHaveBeenCalled()
  })

  it('element deactivation fan-out: one cost_request_cancelled (element_deactivated) per request', async () => {
    const { service, emit } = setup({ costs: [requested()] })
    await service.cancelRequestsForElements(['el'], SCOPE, ACTOR)
    expect(emitted(emit).map(([id, payload]) => [id, payload.reason])).toEqual([['cpq.quote.cost_request_cancelled', 'element_deactivated']])
  })

  it('a deleted sales quote: one cost_request_cancelled (quote_closed); nothing open: nothing emitted', async () => {
    const open = setup({ costs: [requested()] })
    await open.service.cancelRequestsForSalesQuote('sales-1', SCOPE)
    expect(emitted(open.emit).map(([id, payload]) => [id, payload.reason])).toEqual([['cpq.quote.cost_request_cancelled', 'quote_closed']])
    const none = setup({ costs: [cost()] })
    await none.service.cancelRequestsForSalesQuote('sales-1', SCOPE)
    expect(none.emit).not.toHaveBeenCalled()
  })

  it('an event bus failure never fails the write', async () => {
    const emit = jest.fn(async () => { throw new Error('bus down') })
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service, costs } = setup({ emit })
    await expect(service.request(ids.quote, ids.cost, {}, ACTOR, SCOPE)).resolves.toBeDefined()
    expect(costs[0].sourcingStatus).toBe('requested')
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})
