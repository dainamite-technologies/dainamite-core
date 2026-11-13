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
import { QuotingError } from '../../services/cpqQuotingService'
import { PUT, DELETE as CLEAR, metadata as markupMeta } from '../quotes/[quoteId]/markup-overrides/route'

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

const override = { quoteLineId: lineId, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: 30, note: 'deal' }

it('declares the immutable manage features and never requireRoles', () => {
  for (const meta of [markupMeta.PUT, markupMeta.DELETE]) expect(meta.requireFeatures).toEqual(['cpq.quotes.manage', 'cpq.costs.manage'])
  expect(JSON.stringify(markupMeta)).not.toContain('requireRoles')
})

it('toggle off: 404, no command and no guard', async () => {
  enabled.mockResolvedValue(false)
  expect((await PUT(request('PUT', override), params)).status).toBe(404)
  expect((await CLEAR(request('DELETE', undefined, `?quoteLineId=${lineId}&chargeCode=tail`), params)).status).toBe(404)
  expect(execute).not.toHaveBeenCalled()
  expect(guards).not.toHaveBeenCalled()
})

it('PUT / DELETE build the command inputs; without costs.view the response hides the markup and margin', async () => {
  execute.mockResolvedValue({ result: { override: { id: 'o', ...override }, margin: { marginHash: 'h' }, pricingRevision: 6, audit: {} }, logEntry: null })
  expect(await (await PUT(request('PUT', override), params)).json()).toEqual({ override: { id: 'o', ...override }, margin: { marginHash: 'h' }, pricingRevision: 6 })
  expect(execute).toHaveBeenLastCalledWith('cpq.quote_markup_override.set', expect.objectContaining({ input: { quoteId, override } }))
  viewCosts.mockResolvedValue(false)
  const hidden = await (await PUT(request('PUT', override), params)).json()
  expect(hidden).toEqual({ override: { id: 'o', quoteLineId: lineId, chargeCode: 'tail' }, pricingRevision: 6 })
  await CLEAR(request('DELETE', undefined, `?quoteLineId=${lineId}&chargeCode=tail&expectedRevision=2`), params)
  expect(execute).toHaveBeenLastCalledWith('cpq.quote_markup_override.clear', expect.objectContaining({ input: { quoteId, override: { quoteLineId: lineId, chargeCode: 'tail', expectedRevision: 2 } } }))
})

it('command errors keep their status; a target margin of 100 and negative markups are 400', async () => {
  execute.mockRejectedValue(new QuotingError(409, 'COST_LOCKED'))
  expect((await PUT(request('PUT', override), params)).status).toBe(409)
  execute.mockClear()
  expect((await PUT(request('PUT', { ...override, markupRule: 'target_margin_percent', markupValue: 100 }), params)).status).toBe(400)
  expect((await PUT(request('PUT', { ...override, markupValue: -1 }), params)).status).toBe(400)
  expect(execute).not.toHaveBeenCalled()
})
