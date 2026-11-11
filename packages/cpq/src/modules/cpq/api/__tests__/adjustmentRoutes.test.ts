const execute = jest.fn(), list = jest.fn(), preview = jest.fn(), guards = jest.fn(), after = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => name === 'commandBus' ? { execute } : { list, preview } } }
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({ runCpqMutationGuards: (...args: unknown[]) => guards(...args) }))
import { GET, POST, metadata } from '../quotes/[quoteId]/price-adjustments/route'
import { POST as PREVIEW } from '../quotes/[quoteId]/price-adjustments/preview/route'
import { PATCH, DELETE } from '../quotes/[quoteId]/price-adjustments/[adjustmentId]/route'
import { QuotingError } from '../../services/cpqQuotingService'
const quoteId = '11111111-1111-4111-8111-111111111111', adjustmentId = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ quoteId, adjustmentId }) }
const input = { level: 'charge', quoteLineId: quoteId, chargeCode: 'fee', adjustmentType: 'price_override', value: 80, currencyCode: 'USD', reasonCode: 'competitive_match' }
function request(method: string, body?: unknown, query = '') { return new Request(`http://localhost/api/cpq/quotes/${quoteId}/price-adjustments${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
beforeEach(() => {
  jest.clearAllMocks()
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: { adjustment: { id: adjustmentId }, quote: { id: quoteId } }, logEntry: null })
  preview.mockResolvedValue({ quote: { id: quoteId }, errors: [] })
  list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, pricingRevision: 1 })
})
it('requires view on GET and both immutable manage/adjust features on POST', () => {
  expect(metadata.GET.requireFeatures).toEqual(['cpq.quotes.view'])
  expect(metadata.POST.requireFeatures).toEqual(['cpq.quotes.manage', 'cpq.quotes.adjust_price'])
})
it('creates through the command bus with server scope and guard hooks', async () => {
  const response = await POST(request('POST', input), params)
  expect(response.status).toBe(201)
  expect(execute).toHaveBeenCalledWith('cpq.quote_price_adjustment.create', expect.objectContaining({ input: { quoteId, adjustment: input }, ctx: expect.objectContaining({ selectedOrganizationId: 'org', auth: ctx.auth }) }))
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({ resourceKind: 'cpq.quote_price_adjustment', operation: 'create', mutationPayload: { quoteId, ...input } }))
  expect(after).toHaveBeenCalledTimes(1)
  expect(execute.mock.invocationCallOrder[0]).toBeLessThan(after.mock.invocationCallOrder[0])
})
it('applies guard modifications but never replaces quote path identity', async () => {
  guards.mockResolvedValue({ ok: true, modifiedPayload: { quoteId: adjustmentId, value: 70 }, runAfterSuccess: after })
  await POST(request('POST', input), params)
  expect(execute.mock.calls[0][1].input).toEqual({ quoteId, adjustment: { ...input, value: 70 } })
})
it('refuses invalid guard modifications and guard rejections before the command', async () => {
  guards.mockResolvedValue({ ok: true, modifiedPayload: { value: -1 }, runAfterSuccess: after })
  expect((await POST(request('POST', input), params)).status).toBe(400)
  guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
  expect((await POST(request('POST', input), params)).status).toBe(423)
  expect(execute).not.toHaveBeenCalled()
  expect(after).not.toHaveBeenCalled()
})
it.each([403, 404, 409, 422])('preserves command error %s without after-success', async (status) => {
  execute.mockRejectedValue(new QuotingError(status, 'Rejected'))
  const response = await POST(request('POST', input), params)
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error: 'Rejected' })
  expect(after).not.toHaveBeenCalled()
})
it('updates immutable targets through PATCH and deletes with a revision token', async () => {
  expect((await PATCH(request('PATCH', { value: 70 }), params)).status).toBe(200)
  expect(execute.mock.calls[0][1].input).toEqual({ quoteId, adjustmentId, patch: { value: 70 } })
  expect((await DELETE(request('DELETE', undefined, '?expectedRevision=3'), params)).status).toBe(200)
  expect(execute.mock.calls[1][1].input).toEqual({ quoteId, adjustmentId, expectedRevision: 3 })
  expect((await PATCH(request('PATCH', { quoteLineId: adjustmentId }), params)).status).toBe(400)
})
it('lists with bounded pagination and rejects malformed bodies and identifiers', async () => {
  expect((await GET(request('GET', undefined, '?page=2&pageSize=10'), params)).status).toBe(200)
  expect(list).toHaveBeenCalledWith(quoteId, { tenantId: 'tenant', organizationId: 'org' }, 2, 10)
  expect((await GET(request('GET', undefined, '?pageSize=101'), params)).status).toBe(400)
  expect((await POST(request('POST', {}), params)).status).toBe(400)
  expect((await POST(request('POST', input), { params: Promise.resolve({ quoteId: 'bad' }) })).status).toBe(400)
})
it('returns the framework undo operation metadata for a logged command', async () => {
  execute.mockResolvedValue({ result: { adjustment: { id: adjustmentId }, quote: { id: quoteId } },
    logEntry: { id: 'log', commandId: 'cpq.quote_price_adjustment.create', undoToken: 'undo', createdAt: new Date() } })
  expect((await POST(request('POST', input), params)).headers.get('x-om-operation')).toBeTruthy()
})
it('previews through the read-only service without commands or mutation hooks', async () => {
  const response = await PREVIEW(request('POST', { draft: input }), params)
  expect(response.status).toBe(200)
  expect(preview).toHaveBeenCalledWith(quoteId, input, undefined, { tenantId: 'tenant', organizationId: 'org' })
  expect(execute).not.toHaveBeenCalled()
  expect(guards).not.toHaveBeenCalled()
  expect((await PREVIEW(request('POST', { draft: {} }), params)).status).toBe(400)
})
