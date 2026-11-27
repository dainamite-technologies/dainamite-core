const execute = jest.fn(), previewTarget = jest.fn(), guards = jest.fn(), after = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => name === 'commandBus' ? { execute } : { previewTarget } } }
jest.mock('../context', () => ({
  cpqContextError: jest.requireActual('../context').cpqContextError, resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({ runCpqMutationGuards: (...args: unknown[]) => guards(...args) }))
import { PUT, metadata } from '../quotes/[quoteId]/price-adjustments/target/route'
import { POST as PREVIEW, metadata as previewMetadata } from '../quotes/[quoteId]/price-adjustments/target/preview/route'
import { QuotingError } from '../../services/cpqQuotingService'

const quoteId = '11111111-1111-4111-8111-111111111111', lineId = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ quoteId }) }
const body = { target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc' }, currencyCode: 'USD', reasonCode: 'promotion', then: null,
  phases: [{ months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' }, { months: 3, adjustmentType: 'discount_percent', value: 50 }], expectedRevision: 7 }
function request(method: string, payload: unknown, path = '') {
  return new Request(`http://localhost/api/cpq/quotes/${quoteId}/price-adjustments/target${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}
beforeEach(() => {
  jest.clearAllMocks()
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: { quoteId, target: body.target, before: [], after: [{ id: 'row' }], quote: { id: quoteId } }, logEntry: null })
  previewTarget.mockResolvedValue({ quote: { id: quoteId }, errors: [] })
})

it('guards both routes with the immutable manage + adjust_price features, never roles', () => {
  for (const meta of [metadata.PUT, previewMetadata.POST]) {
    expect(meta.requireFeatures).toEqual(['cpq.quotes.manage', 'cpq.quotes.adjust_price'])
    expect(meta).not.toHaveProperty('requireRoles')
  }
})

it('replaces the target through one command with guard hooks and returns the target rows', async () => {
  const response = await PUT(request('PUT', body), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ adjustments: [{ id: 'row' }], quote: { id: quoteId } })
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledWith('cpq.quote_price_adjustment.replace_target', expect.objectContaining({ input: { quoteId, body }, ctx: expect.objectContaining({ selectedOrganizationId: 'org' }) }))
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({ resourceKind: 'cpq.quote_price_adjustment', operation: 'update', mutationPayload: { quoteId, ...body } }))
  expect(execute.mock.invocationCallOrder[0]).toBeLessThan(after.mock.invocationCallOrder[0])
})

it('keeps the path quote id over a guard modification and re-validates the result', async () => {
  guards.mockResolvedValue({ ok: true, modifiedPayload: { quoteId: lineId, reasonCode: 'loyalty' }, runAfterSuccess: after })
  await PUT(request('PUT', body), params)
  expect(execute.mock.calls[0][1].input).toEqual({ quoteId, body: { ...body, reasonCode: 'loyalty' } })
  guards.mockResolvedValue({ ok: true, modifiedPayload: { phases: 'x' }, runAfterSuccess: after })
  expect((await PUT(request('PUT', body), params)).status).toBe(400)
  guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
  expect((await PUT(request('PUT', body), params)).status).toBe(423)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('rejects malformed bodies with 400 and keeps service errors and their details', async () => {
  expect((await PUT(request('PUT', { ...body, extra: true }), params)).status).toBe(400)
  expect((await PUT(request('PUT', { ...body, target: { level: 'line', quoteLineId: 'bad', chargeTypeFilter: 'mrc' } }), params)).status).toBe(400)
  expect((await PUT(request('PUT', { ...body, phases: [{ months: 0, adjustmentType: 'regular' }] }), params)).status).toBe(400)
  execute.mockRejectedValue(new QuotingError(422, 'ADJUSTMENT_OVERLAP', undefined, { code: 'ADJUSTMENT_OVERLAP', adjustmentId: 'other' }))
  const overlap = await PUT(request('PUT', body), params)
  expect(overlap.status).toBe(422)
  expect(await overlap.json()).toEqual({ error: 'ADJUSTMENT_OVERLAP', code: 'ADJUSTMENT_OVERLAP', adjustmentId: 'other' })
  execute.mockRejectedValue(new QuotingError(409, 'STALE_REVISION'))
  expect((await PUT(request('PUT', body), params)).status).toBe(409)
  expect(after).not.toHaveBeenCalled()
})

it('returns the undo operation metadata of the logged command', async () => {
  execute.mockResolvedValue({ result: { quoteId, target: body.target, before: [], after: [{ id: 'row' }], quote: { id: quoteId } },
    logEntry: { id: 'log', commandId: 'cpq.quote_price_adjustment.replace_target', undoToken: 'undo', createdAt: new Date() } })
  expect((await PUT(request('PUT', body), params)).headers.get('x-om-operation')).toBeTruthy()
})

it('previews through the service without commands or mutation guards', async () => {
  const response = await PREVIEW(request('POST', body, '/preview'), params)
  expect(response.status).toBe(200)
  expect(previewTarget).toHaveBeenCalledWith(quoteId, body, { tenantId: 'tenant', organizationId: 'org' })
  expect(execute).not.toHaveBeenCalled()
  expect(guards).not.toHaveBeenCalled()
  expect((await PREVIEW(request('POST', { target: body.target }, '/preview'), params)).status).toBe(400)
})
