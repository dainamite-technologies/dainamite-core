const execute = jest.fn(), read = jest.fn(), preview = jest.fn(), usage = jest.fn(), guards = jest.fn(), after = jest.fn()
const enabled = jest.fn(), viewCosts = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ commandBus: { execute }, cpqCostService: { enabled }, cpqQuoteCostService: { read, preview, usage } } as Record<string, unknown>)[name] } }
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
  CPQ_QUOTE_LINE_COST_RESOURCE_KIND: 'cpq.quote_line_cost', CPQ_QUOTE_MARKUP_OVERRIDE_RESOURCE_KIND: 'cpq.quote_markup_override',
}))
jest.mock('../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { POST, metadata as costsMeta } from '../quotes/[quoteId]/costs/route'
import { PATCH, DELETE, metadata as costMeta } from '../quotes/[quoteId]/costs/[costId]/route'
import { QuotingError } from '../../services/cpqQuotingService'

const quoteId = '11111111-1111-4111-8111-111111111111', costId = '22222222-2222-4222-8222-222222222222', lineId = '66666666-6666-4666-8666-666666666666'
const params = { params: Promise.resolve({ quoteId, costId }) }
const body = { quoteLineId: lineId, name: 'Fee', role: 'margin_only', costType: 'nrc', source: 'fixed', costModel: 'flat', unitAmount: 1500 }
const request = (method: string, payload?: unknown, query = '') => new Request(`http://localhost/api/cpq/x${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
const fullCost = { id: costId, costKey: 'manual:abcd1234', name: 'Fee', role: 'margin_only', valueStatus: 'confirmed', expired: false, unitAmount: '1500', supplierName: 'Acme', note: 'n' }


beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: { cost: fullCost, margin: { marginHash: 'h' }, pricingRevision: 5, audit: {} }, logEntry: null })
  read.mockResolvedValue({ lines: [], pricingRevision: 1 })
})

it('declares the immutable manage features and never requireRoles', () => {
  for (const meta of [costsMeta.POST, costMeta.PATCH, costMeta.DELETE]) expect(meta.requireFeatures).toEqual(['cpq.quotes.manage', 'cpq.costs.manage'])
  for (const meta of [costsMeta, costMeta]) expect(JSON.stringify(meta)).not.toContain('requireRoles')
})

it('toggle off: 404 on every cost write route, no command and no guard', async () => {
  enabled.mockResolvedValue(false)
  const responses = await Promise.all([POST(request('POST', body), params), PATCH(request('PATCH', { note: 'x' }), params), DELETE(request('DELETE'), params)])
  expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
  expect(execute).not.toHaveBeenCalled()
  expect(guards).not.toHaveBeenCalled()
})

it('POST creates through the command bus behind the guard hooks and returns cost, margin and revision', async () => {
  const response = await POST(request('POST', body), params)
  expect(response.status).toBe(201)
  expect(execute).toHaveBeenCalledWith('cpq.quote_line_cost.create', expect.objectContaining({ input: { quoteId, cost: body } }))
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({ resourceKind: 'cpq.quote_line_cost', operation: 'create' }))
  expect(after).toHaveBeenCalledTimes(1)
  expect(await response.json()).toEqual({ cost: fullCost, margin: { marginHash: 'h' }, pricingRevision: 5 })
})

it('without costs.view the write response carries no amount, supplier, note or margin', async () => {
  viewCosts.mockResolvedValue(false)
  const json = await (await POST(request('POST', body), params)).json()
  expect(json).toEqual({ cost: { id: costId, costKey: 'manual:abcd1234', name: 'Fee', role: 'margin_only', valueStatus: 'confirmed', expired: false }, pricingRevision: 5 })
  expect(JSON.stringify(json)).not.toMatch(/"(unitAmount|instanceAmount|currencyCode|supplier\w*|note|margin|markup\w*)":/)
})

it('guard rejection stops before the command; command errors keep their status and skip after-success', async () => {
  guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
  expect((await POST(request('POST', body), params)).status).toBe(423)
  expect(execute).not.toHaveBeenCalled()
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  for (const [status, message] of [[409, 'COST_LOCKED'], [409, 'STALE_REVISION'], [422, 'NOTE_REQUIRED']] as const) {
    execute.mockRejectedValue(new QuotingError(status, message))
    const response = await PATCH(request('PATCH', { unitAmount: 1 }), params)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: message })
  }
  expect(after).not.toHaveBeenCalled()
})

it('PATCH / DELETE build the command inputs, with the revision from the query on deletes', async () => {
  await PATCH(request('PATCH', { note: 'x' }), params)
  expect(execute.mock.calls[0][1].input).toEqual({ quoteId, costId, patch: { note: 'x' } })
  await DELETE(request('DELETE', undefined, '?expectedRevision=3'), params)
  expect(execute.mock.calls[1][1].input).toEqual({ quoteId, costId, expectedRevision: 3 })
})

it('rejects malformed bodies and identifiers', async () => {
  expect((await POST(request('POST', {}), params)).status).toBe(400)
  expect((await POST(request('POST', { ...body, source: 'table' }), params)).status).toBe(400)
  expect((await POST(request('POST', body), { params: Promise.resolve({ quoteId: 'bad' }) })).status).toBe(400)
  expect((await PATCH(request('PATCH', { quoteLineId: lineId }), params)).status).toBe(400)
  expect(execute).not.toHaveBeenCalled()
})
