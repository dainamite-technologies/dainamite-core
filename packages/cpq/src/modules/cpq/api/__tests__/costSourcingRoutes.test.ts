const execute = jest.fn(), guards = jest.fn(), after = jest.fn(), enabled = jest.fn(), viewCosts = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ commandBus: { execute }, cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
  CPQ_QUOTE_LINE_COST_RESOURCE_KIND: 'cpq.quote_line_cost',
}))
jest.mock('../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { POST as request, metadata as requestMeta, openApi as requestOpenApi } from '../quotes/[quoteId]/costs/[costId]/request/route'
import { POST as cancel, metadata as cancelMeta, openApi as cancelOpenApi } from '../quotes/[quoteId]/costs/[costId]/cancel-request/route'
import { QuotingError } from '../../services/cpqQuotingService'

const quoteId = '11111111-1111-4111-8111-111111111111', costId = '22222222-2222-4222-8222-222222222222', requestId = '55555555-5555-4555-8555-555555555555'
const params = { params: Promise.resolve({ quoteId, costId }) }
const post = (payload?: unknown) => new Request('http://localhost/api/cpq/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) })
const response = { costId, sourcingStatus: 'requested', costRequestId: requestId, requestSeq: 2, pricingRevision: 5 }
// The command result also carries amounts-adjacent data a sloppy route could echo: the routes must pick fields.
const commandResult = {
  response, audit: { before: { id: costId }, after: { id: costId } }, signals: [{ kind: 'requested', costKey: 'tail' }],
  cost: { unitAmount: '7777.77', supplierName: 'SecretSupplier', note: 'secret note' }, margin: { marginHash: 'h' },
}

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: commandResult, logEntry: null })
})

it('declares the immutable quote-manage feature (a request prices nothing) and never requireRoles', () => {
  expect(requestMeta.POST).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.manage'] })
  expect(cancelMeta.POST).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.manage'] })
  expect(JSON.stringify([requestMeta, cancelMeta])).not.toContain('requireRoles')
})

it('exports an openApi doc with the contract errors for both routes', () => {
  for (const doc of [requestOpenApi, cancelOpenApi]) {
    expect(doc.tag).toBe('CPQ Quotes')
    expect(doc.methods.POST?.requestBody).toBeDefined()
    expect((doc.methods.POST?.errors ?? []).map((error) => error.status)).toEqual(expect.arrayContaining([400, 403, 404, 409]))
  }
  expect(JSON.stringify(requestOpenApi.methods.POST?.errors)).toContain('LINE_NOT_ELIGIBLE')
  expect(JSON.stringify(cancelOpenApi.methods.POST?.errors)).toContain('COST_REQUEST_SUPERSEDED')
})

it('toggle off: 404 on both routes, no guard and no command', async () => {
  enabled.mockResolvedValue(false)
  const responses = await Promise.all([request(post({}), params), cancel(post({ costRequestId: requestId }), params)])
  expect(responses.map((res) => res.status)).toEqual([404, 404])
  expect(execute).not.toHaveBeenCalled()
  expect(guards).not.toHaveBeenCalled()
})

it('request: runs the mutation guards (cpq.quote_line_cost, custom, action request), then the command, then the after-success hook', async () => {
  const res = await request(post({ supplierName: 'Carrier', expectedRevision: 4 }), params)
  expect(res.status).toBe(200)
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), {
    resourceKind: 'cpq.quote_line_cost', resourceId: costId, operation: 'custom',
    mutationPayload: { quoteId, action: 'request', supplierName: 'Carrier', expectedRevision: 4 },
  })
  expect(execute).toHaveBeenCalledWith('cpq.quote_line_cost.request', expect.objectContaining({ input: { quoteId, costId, request: { supplierName: 'Carrier', expectedRevision: 4 } } }))
  expect(after).toHaveBeenCalledTimes(1)
  expect(guards.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0])
  expect(execute.mock.invocationCallOrder[0]).toBeLessThan(after.mock.invocationCallOrder[0])
})

it('cancel-request: guard action cancel_request, command input carries the request id', async () => {
  const res = await cancel(post({ costRequestId: requestId, note: 'not needed' }), params)
  expect(res.status).toBe(200)
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({
    resourceKind: 'cpq.quote_line_cost', operation: 'custom', mutationPayload: { quoteId, action: 'cancel_request', costRequestId: requestId, note: 'not needed' },
  }))
  expect(execute).toHaveBeenCalledWith('cpq.quote_line_cost.cancel_request', expect.objectContaining({ input: { quoteId, costId, cancel: { costRequestId: requestId, note: 'not needed' } } }))
})

it.each([true, false])('the response is the whitelisted ids-and-status body whether or not the caller holds cpq.costs.view (%s): no amount, supplier, note or margin', async (view) => {
  viewCosts.mockResolvedValue(view)
  for (const res of [await request(post({}), params), await cancel(post({ costRequestId: requestId }), params)]) {
    const json = await res.json()
    expect(json).toEqual(response)
    expect(JSON.stringify(json)).not.toMatch(/7777|SecretSupplier|secret note|marginHash|unitAmount|supplier|note|margin/)
  }
})

it('a guard rejection returns the guard response and stops before the command', async () => {
  guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
  expect((await request(post({}), params)).status).toBe(423)
  expect((await cancel(post({ costRequestId: requestId }), params)).status).toBe(423)
  expect(execute).not.toHaveBeenCalled()
  expect(after).not.toHaveBeenCalled()
})

it('a guard may modify the body fields but never the path-owned ids; the modified payload is re-validated', async () => {
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after, modifiedPayload: { quoteId: 'other', action: 'x', note: 'guarded' } })
  await request(post({}), params)
  expect(execute.mock.calls[0][1].input).toEqual({ quoteId, costId, request: { note: 'guarded' } })
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after, modifiedPayload: { note: 'x'.repeat(501) } })
  expect((await request(post({}), params)).status).toBe(400)
})

it('keeps the error status and code of command failures and skips the after-success hook', async () => {
  for (const [status, message, route] of [
    [409, 'QUOTE_CLOSED', request], [409, 'STALE_REVISION', request], [422, 'LINE_NOT_ELIGIBLE', request],
    [409, 'COST_REQUEST_SUPERSEDED', cancel], [409, 'REQUEST_NOT_OPEN', cancel],
  ] as const) {
    execute.mockRejectedValue(new QuotingError(status, message))
    const res = await route(post(route === cancel ? { costRequestId: requestId } : {}), params)
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: message })
  }
  execute.mockRejectedValue(new QuotingError(409, 'QUOTE_CONVERTED', undefined, { orderId: 'order-1' }))
  const converted = await request(post({}), params)
  expect(await converted.json()).toEqual({ error: 'QUOTE_CONVERTED', orderId: 'order-1' })
  expect(after).not.toHaveBeenCalled()
})

it('rejects malformed bodies and identifiers before the guards', async () => {
  expect((await request(post({ unitAmount: 5 }), params)).status).toBe(400)
  expect((await request(post({ note: 'x'.repeat(501) }), params)).status).toBe(400)
  expect((await request(post({}), { params: Promise.resolve({ quoteId: 'bad', costId }) })).status).toBe(400)
  expect((await cancel(post({}), params)).status).toBe(400)
  expect((await cancel(post({ costRequestId: 'not-a-uuid' }), params)).status).toBe(400)
  expect(guards).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})
