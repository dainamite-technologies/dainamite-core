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
import { GET, metadata as costsMeta } from '../quotes/[quoteId]/costs/route'
import { POST as PREVIEW, metadata as previewMeta } from '../cost-preview/route'
import { GET as USAGE, metadata as usageMeta } from '../cost-plus/usage/route'
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

it('declares the immutable read features and never requireRoles', () => {
  expect(costsMeta.GET.requireFeatures).toEqual(['cpq.quotes.view'])
  expect(previewMeta.POST.requireFeatures).toEqual(['cpq.pricing.view', 'cpq.costs.view'])
  expect(usageMeta.GET.requireFeatures).toEqual(['cpq.costs.view'])
  for (const meta of [costsMeta, previewMeta, usageMeta]) expect(JSON.stringify(meta)).not.toContain('requireRoles')
})

it('GET passes the costs.view decision to the service', async () => {
  viewCosts.mockResolvedValue(false)
  expect((await GET(request('GET'), params)).status).toBe(200)
  expect(read).toHaveBeenCalledWith(quoteId, { organizationId: 'org', tenantId: 'tenant' }, false)
  viewCosts.mockResolvedValue(true)
  await GET(request('GET'), params)
  expect(read).toHaveBeenLastCalledWith(quoteId, { organizationId: 'org', tenantId: 'tenant' }, true)
})

it('toggle off: GET answers 404 without reading', async () => {
  enabled.mockResolvedValue(false)
  expect((await GET(request('GET'), params)).status).toBe(404)
  expect(read).not.toHaveBeenCalled()
})

it('preview maps a toggle-off service 404; usage stays available with the toggle off', async () => {
  preview.mockRejectedValue(new QuotingError(404, 'Not found'))
  expect((await PREVIEW(request('POST', { productId: costId, configuration: {} }))).status).toBe(404)
  enabled.mockResolvedValue(false)
  usage.mockResolvedValue({ enabled: false, costPlusCharges: 2, openQuotes: 1, openRequests: 0, liveSubscriptions: 0 })
  const response = await USAGE(request('GET'))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ enabled: false, costPlusCharges: 2, openQuotes: 1, openRequests: 0, liveSubscriptions: 0 })
  expect((await PREVIEW(request('POST', {}))).status).toBe(400)
})
