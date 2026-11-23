const execute = jest.fn(), guards = jest.fn(), after = jest.fn(), enabled = jest.fn(), viewCosts = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ commandBus: { execute }, cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
  CPQ_QUOTE_RESOURCE_KIND: 'cpq.quote',
}))
jest.mock('../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { POST as apply, metadata, openApi } from '../quotes/[quoteId]/costs/[costId]/apply-answer/route'
import { QuotingError } from '../../services/cpqQuotingService'

const quoteId = '11111111-1111-4111-8111-111111111111', costId = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ quoteId, costId }) }
const post = (payload?: unknown) => new Request('http://localhost/api/cpq/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) })
const full = { id: costId, costKey: 'tail', name: 'Tail', role: 'price_basis', valueStatus: 'confirmed', expired: false, unitAmount: '7777.77', supplierName: 'SecretSupplier', note: 'secret note', proposedAnswer: null }
const commandResult = { response: { id: quoteId, cpqStatus: 'ready', pricingRevision: 6, lines: [], cost: full }, audit: {}, signals: [] }

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: commandResult, logEntry: null })
})

it('declares cpq.quotes.manage + cpq.costs.manage and never requireRoles; openApi names the contract errors', () => {
  expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.costs.manage'] })
  const text = JSON.stringify(openApi.methods.POST)
  for (const code of ['STALE_REVISION', 'NO_PENDING_ANSWER', 'QUOTE_CLOSED', 'QUOTE_CONVERTED', 'cpq.quote']) expect(text).toContain(code)
  expect(JSON.stringify(metadata)).not.toContain('requireRoles')
})

it('runs the cpq.quote mutation guard (custom, action apply_answer) before the command, then the after-success hook', async () => {
  const res = await apply(post({ expectedRevision: 5 }), params)
  expect(res.status).toBe(200)
  expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), {
    resourceKind: 'cpq.quote', resourceId: quoteId, operation: 'custom', mutationPayload: { quoteId, action: 'apply_answer', expectedRevision: 5 },
  })
  expect(execute).toHaveBeenCalledWith('cpq.quote_line_cost.apply_answer', expect.objectContaining({ input: { quoteId, costId, apply: { expectedRevision: 5 } } }))
  expect(guards.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0])
  expect(execute.mock.invocationCallOrder[0]).toBeLessThan(after.mock.invocationCallOrder[0])
})

it('requires expectedRevision and rejects malformed input before the guard', async () => {
  for (const bad of [{}, { expectedRevision: -1 }, { expectedRevision: '3' }, { expectedRevision: 1, extra: true }]) expect((await apply(post(bad), params)).status).toBe(400)
  expect((await apply(post({ expectedRevision: 1 }), { params: Promise.resolve({ quoteId: 'bad', costId }) })).status).toBe(400)
  expect(guards).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('a guard may not replace expectedRevision', async () => {
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after, modifiedPayload: { expectedRevision: 99 } })
  await apply(post({ expectedRevision: 5 }), params)
  expect(execute.mock.calls[0][1].input.apply).toEqual({ expectedRevision: 5 })
})

it('returns the quote result with the full cost for cpq.costs.view holders and the status-only cost projection otherwise', async () => {
  expect(await (await apply(post({ expectedRevision: 5 }), params)).json()).toEqual(commandResult.response)
  viewCosts.mockResolvedValue(false)
  const json = await (await apply(post({ expectedRevision: 5 }), params)).json()
  expect(json.cost).toEqual({ id: costId, costKey: 'tail', name: 'Tail', role: 'price_basis', valueStatus: 'confirmed', expired: false })
  expect(JSON.stringify(json)).not.toMatch(/7777|SecretSupplier|secret note/)
  expect(json).toMatchObject({ cpqStatus: 'ready', pricingRevision: 6 })
})

it('toggle off is 404 without guard or command; guard rejection stops before the command; errors keep status and code', async () => {
  enabled.mockResolvedValue(false)
  expect((await apply(post({ expectedRevision: 5 }), params)).status).toBe(404)
  expect(guards).not.toHaveBeenCalled()
  enabled.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
  expect((await apply(post({ expectedRevision: 5 }), params)).status).toBe(423)
  expect(execute).not.toHaveBeenCalled()
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  for (const [status, message] of [[409, 'STALE_REVISION'], [409, 'NO_PENDING_ANSWER'], [409, 'QUOTE_CLOSED']] as const) {
    execute.mockRejectedValue(new QuotingError(status, message))
    const res = await apply(post({ expectedRevision: 5 }), params)
    expect([res.status, await res.json()]).toEqual([status, { error: message }])
  }
  execute.mockRejectedValue(new QuotingError(409, 'QUOTE_CONVERTED', undefined, { orderId: 'order-1' }))
  expect(await (await apply(post({ expectedRevision: 5 }), params)).json()).toEqual({ error: 'QUOTE_CONVERTED', orderId: 'order-1' })
  expect(after).not.toHaveBeenCalled()
})
