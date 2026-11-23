const list = jest.fn(), detail = jest.fn(), enabled = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ cpqCostService: { enabled }, cpqCostRequestQueueService: { list, detail } } as Record<string, unknown>)[name] } }
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
import { GET as LIST, metadata as listMeta, openApi as listOpenApi } from '../cost-requests/route'
import { GET as DETAIL, metadata as detailMeta, openApi as detailOpenApi } from '../cost-requests/[costId]/route'

const costId = '22222222-2222-4222-8222-222222222222'
const get = (query = '') => new Request(`http://localhost/api/cpq/cost-requests${query}`)
const scope = { organizationId: 'org', tenantId: 'tenant' }

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0, overdueThresholdWorkingDays: 5 })
  detail.mockResolvedValue({ costId })
})

describe('feature matrix (Q13)', () => {
  it('list and detail need the quotes view AND the costs view, never requireRoles', () => {
    expect(listMeta.GET).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.view', 'cpq.costs.view'] })
    expect(detailMeta.GET).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.view', 'cpq.costs.view'] })
    expect(JSON.stringify([listMeta, detailMeta])).not.toContain('requireRoles')
  })
  it('both are declared by acl.ts features', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const declared = (require('../../acl') as { features: Array<{ id: string }> }).features.map((feature) => feature.id)
    for (const feature of [...listMeta.GET.requireFeatures, ...detailMeta.GET.requireFeatures]) expect(declared).toContain(feature)
  })
  it('exports openApi docs', () => {
    expect(listOpenApi.methods.GET?.query).toBeDefined()
    expect((listOpenApi.methods.GET?.errors ?? []).map((error) => error.status)).toEqual(expect.arrayContaining([400, 403, 404]))
    expect(detailOpenApi.pathParams).toBeDefined()
    expect((detailOpenApi.methods.GET?.errors ?? []).map((error) => error.status)).toEqual(expect.arrayContaining([403, 404]))
  })
})

describe('GET /cost-requests', () => {
  it('passes the tenant scope and the parsed query to the queue', async () => {
    const response = await LIST(get('?status=cancelled&cancelReason=quote_closed&overdue=false&page=2&pageSize=50&sortDir=desc&search=abc'))
    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith(scope, expect.objectContaining({ status: 'cancelled', cancelReason: 'quote_closed', overdue: false, page: 2, pageSize: 50, sortDir: 'desc', search: 'abc' }))
  })
  it('defaults to the open queue, 25 per page', async () => {
    await LIST(get())
    expect(list).toHaveBeenCalledWith(scope, expect.objectContaining({ status: 'requested', overdue: false, page: 1, pageSize: 25, sortDir: 'asc' }))
  })
  it('overdue=true is parsed to a boolean', async () => {
    await LIST(get('?overdue=true'))
    expect(list).toHaveBeenCalledWith(scope, expect.objectContaining({ overdue: true }))
  })
  it.each(['?pageSize=101', '?pageSize=0', '?page=0', '?status=bogus', '?supplierId=not-a-uuid', '?overdue=maybe'])('rejects %s with 400 before querying', async (query) => {
    expect((await LIST(get(query))).status).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })
  it('toggle off: 404 without reading', async () => {
    enabled.mockResolvedValue(false)
    expect((await LIST(get())).status).toBe(404)
    expect(list).not.toHaveBeenCalled()
  })
  it('401 without a session', async () => {
    const original = ctx.auth
    ;(ctx as { auth: unknown }).auth = null
    expect((await LIST(get())).status).toBe(401)
    ;(ctx as { auth: unknown }).auth = original
  })
})

describe('GET /cost-requests/{costId}', () => {
  const params = (id: string) => ({ params: Promise.resolve({ costId: id }) })
  it('returns the detail', async () => {
    const response = await DETAIL(get(), params(costId))
    expect(response.status).toBe(200)
    expect(detail).toHaveBeenCalledWith(costId, scope)
  })
  it('404 for an unknown cost line or a deleted quote', async () => {
    detail.mockResolvedValue(null)
    expect((await DETAIL(get(), params(costId))).status).toBe(404)
  })
  it('400 for a malformed id; 404 with the toggle off, without reading', async () => {
    expect((await DETAIL(get(), params('nope'))).status).toBe(400)
    enabled.mockResolvedValue(false)
    expect((await DETAIL(get(), params(costId))).status).toBe(404)
    expect(detail).not.toHaveBeenCalled()
  })
})
