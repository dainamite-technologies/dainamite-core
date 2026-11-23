const execute = jest.fn(), guards = jest.fn(), after = jest.fn(), enabled = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ commandBus: { execute }, cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
  CPQ_QUOTE_LINE_COST_RESOURCE_KIND: 'cpq.quote_line_cost',
}))
import { POST as answer, metadata as answerMeta, openApi as answerOpenApi } from '../quotes/[quoteId]/costs/[costId]/answer/route'
import { POST as decline, metadata as declineMeta, openApi as declineOpenApi } from '../quotes/[quoteId]/costs/[costId]/decline/route'
import { QuotingError } from '../../services/cpqQuotingService'

const quoteId = '11111111-1111-4111-8111-111111111111', costId = '22222222-2222-4222-8222-222222222222', requestId = '55555555-5555-4555-8555-555555555555'
const params = { params: Promise.resolve({ quoteId, costId }) }
const post = (payload?: unknown) => new Request('http://localhost/api/cpq/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) })
const answerBody = { costRequestId: requestId, unitAmount: 280, currencyCode: 'EUR', supplierQuoteRef: 'CARR-889' }
const answerResponse = { outcome: 'applied', cost: { id: costId, unitAmount: '280' }, lineReady: true, pricingRevision: 5 }
const declineResponse = { outcome: 'declined', cost: { id: costId }, pricingRevision: 5 }

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: { response: answerResponse, audit: {}, signals: [{ kind: 'valued' }] }, logEntry: null })
})

it('declares cpq.costs.view + cpq.costs.manage (Q13) and never requireRoles', () => {
  for (const meta of [answerMeta, declineMeta]) expect(meta.POST).toEqual({ requireAuth: true, requireFeatures: ['cpq.costs.view', 'cpq.costs.manage'] })
  expect(JSON.stringify([answerMeta, declineMeta])).not.toContain('requireRoles')
})

it('exports openApi docs naming the contract errors and the idempotency outcome', () => {
  for (const doc of [answerOpenApi, declineOpenApi]) {
    expect(doc.tag).toBe('CPQ Quotes')
    expect(doc.methods.POST?.requestBody).toBeDefined()
    expect((doc.methods.POST?.errors ?? []).map((error) => error.status)).toEqual(expect.arrayContaining([400, 403, 404, 409]))
  }
  const text = JSON.stringify(answerOpenApi.methods.POST)
  for (const code of ['COST_REQUEST_SUPERSEDED', 'SUPPLIER_QUOTE_REF_CONFLICT', 'REQUEST_NOT_OPEN', 'QUOTE_CONVERTED', 'COST_PLUS_DISABLED', 'LINE_NOT_ELIGIBLE', 'noop']) expect(text).toContain(code)
})

it('answer: guards (cpq.quote_line_cost, custom, action answer) -> command -> after-success; the response is the whitelisted result body', async () => {
  const res = await answer(post(answerBody), params)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(answerResponse)
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({
    resourceKind: 'cpq.quote_line_cost', resourceId: costId, operation: 'custom', mutationPayload: expect.objectContaining({ quoteId, action: 'answer', supplierQuoteRef: 'CARR-889' }),
  }))
  expect(execute).toHaveBeenCalledWith('cpq.quote_line_cost.answer', expect.objectContaining({ input: { quoteId, costId, answer: { ...answerBody, valueStatus: 'confirmed' } } }))
  expect(after).toHaveBeenCalledTimes(1)
})

it('decline: guard action decline, command input carries the request id and reason', async () => {
  execute.mockResolvedValue({ result: { response: declineResponse, audit: {}, signals: [] }, logEntry: null })
  const res = await decline(post({ costRequestId: requestId, reason: 'No coverage at site' }), params)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(declineResponse)
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({ mutationPayload: { quoteId, action: 'decline', costRequestId: requestId, reason: 'No coverage at site' } }))
  expect(execute).toHaveBeenCalledWith('cpq.quote_line_cost.decline', expect.objectContaining({ input: { quoteId, costId, decline: { costRequestId: requestId, reason: 'No coverage at site' } } }))
})

it('toggle off is NOT a 404 here: the route reaches the command, which answers 409 COST_PLUS_DISABLED (retryable)', async () => {
  enabled.mockResolvedValue(false)
  execute.mockRejectedValue(new QuotingError(409, 'COST_PLUS_DISABLED'))
  for (const [route, body] of [[answer, answerBody], [decline, { costRequestId: requestId, reason: 'x' }]] as const) {
    const res = await route(post(body), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'COST_PLUS_DISABLED' })
  }
  expect(enabled).not.toHaveBeenCalled()
})

it('a guard rejection stops before the command', async () => {
  guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
  expect((await answer(post(answerBody), params)).status).toBe(423)
  expect(execute).not.toHaveBeenCalled()
  expect(after).not.toHaveBeenCalled()
})

it('keeps the status and code of command failures, including QUOTE_CONVERTED with the orderId, and skips the hook', async () => {
  for (const [status, message] of [
    [409, 'QUOTE_CLOSED'], [409, 'COST_REQUEST_SUPERSEDED'], [409, 'SUPPLIER_QUOTE_REF_CONFLICT'], [409, 'REQUEST_NOT_OPEN'],
    [422, 'LINE_NOT_ELIGIBLE'], [422, 'VALID_UNTIL_IN_PAST'], [422, 'INVALID_CURRENCY_CODE'],
  ] as const) {
    execute.mockRejectedValue(new QuotingError(status, message))
    const res = await answer(post(answerBody), params)
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: message })
  }
  execute.mockRejectedValue(new QuotingError(409, 'QUOTE_CONVERTED', undefined, { orderId: 'order-1' }))
  expect(await (await answer(post(answerBody), params)).json()).toEqual({ error: 'QUOTE_CONVERTED', orderId: 'order-1' })
  expect(after).not.toHaveBeenCalled()
})

it('rejects malformed bodies before the guards: no expectedRevision, supplierQuoteRef 1-100 chars, amount >= 0, reason 1-500', async () => {
  for (const bad of [
    { ...answerBody, expectedRevision: 1 }, { ...answerBody, supplierQuoteRef: '' }, { ...answerBody, supplierQuoteRef: 'x'.repeat(101) },
    { ...answerBody, unitAmount: -1 }, { ...answerBody, costRequestId: 'nope' }, { ...answerBody, valueStatus: 'none' }, { ...answerBody, validUntil: 'soon' },
  ]) expect((await answer(post(bad), params)).status).toBe(400)
  for (const bad of [{ costRequestId: requestId }, { costRequestId: requestId, reason: '' }, { costRequestId: requestId, reason: 'x'.repeat(501) }]) {
    expect((await decline(post(bad), params)).status).toBe(400)
  }
  expect((await answer(post(answerBody), { params: Promise.resolve({ quoteId: 'bad', costId }) })).status).toBe(400)
  expect(guards).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})
