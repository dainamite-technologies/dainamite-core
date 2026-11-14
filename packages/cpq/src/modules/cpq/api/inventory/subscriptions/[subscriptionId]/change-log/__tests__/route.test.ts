type Row = Record<string, any>
const enabled = jest.fn(), viewCosts = jest.fn(), listChangeLog = jest.fn()
const ctx = { auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ cpqCostService: { enabled }, cpqInventoryService: { listChangeLog } } as Record<string, unknown>)[name] } }
jest.mock('../../../../../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../../../../../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
import { GET, metadata } from '../route'

const params = { params: Promise.resolve({ subscriptionId: '11111111-1111-4111-8111-111111111111' }) }
const request = () => new Request('http://localhost/api/cpq/inventory/subscriptions/x/change-log')
const SENTINEL = '7777.7700'
const snapshot = (): Row => ({
  id: 'sub', status: 'active',
  items: [{ id: 'i1', name: 'Item', costs: [{ id: 'c1', costKey: 'tail', totalAmount: SENTINEL, supplierName: 'ZXQ-Sentinel-Supplier' }] }, { id: 'i2', name: 'Bare' }],
  assets: [{ id: 'a1', name: 'Box', costs: [{ id: 'c2', costKey: 'box', totalAmount: SENTINEL }] }],
})
const page = () => ({ items: [{ id: 'log', changeType: 'amend', beforeSnapshot: snapshot(), afterSnapshot: snapshot() }, { id: 'log0', changeType: 'create', beforeSnapshot: null, afterSnapshot: snapshot() }], total: 2, page: 1, pageSize: 50, totalPages: 1 })

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  listChangeLog.mockResolvedValue(page())
})

it('keeps the cpq.arc.changelog.view guard (no costs feature needed to read the log)', () => {
  expect(metadata.GET.requireFeatures).toEqual(['cpq.arc.changelog.view'])
  expect(JSON.stringify(metadata)).not.toContain('requireRoles')
})

it('cpq.costs.view holder with the toggle on: snapshots keep items[].costs and assets[].costs', async () => {
  const body = await (await GET(request(), params)).json()
  expect(body.items[0].afterSnapshot.items[0].costs[0].totalAmount).toBe(SENTINEL)
  expect(body.items[0].beforeSnapshot.assets[0].costs).toHaveLength(1)
})

it('without cpq.costs.view: no snapshot item or asset has a costs key; the rest of the page is unchanged (200, not 403)', async () => {
  viewCosts.mockResolvedValue(false)
  const response = await GET(request(), params)
  expect(response.status).toBe(200)
  const body = await response.json()
  for (const entry of body.items) for (const snap of [entry.beforeSnapshot, entry.afterSnapshot].filter(Boolean)) {
    for (const owner of [...snap.items, ...snap.assets]) expect(owner).not.toHaveProperty('costs')
  }
  const json = JSON.stringify(body)
  for (const leak of [SENTINEL, 'ZXQ-Sentinel-Supplier', 'totalAmount', 'supplier']) expect(json).not.toContain(leak)
  expect(body).toMatchObject({ total: 2, page: 1, totalPages: 1 })
  expect(body.items[1].beforeSnapshot).toBeNull()
  expect(body.items[0].afterSnapshot.items.map((i: Row) => i.name)).toEqual(['Item', 'Bare'])
})

it('toggle off: stripped even for a cpq.costs.view holder', async () => {
  enabled.mockResolvedValue(false)
  const json = JSON.stringify(await (await GET(request(), params)).json())
  expect(json).not.toContain(SENTINEL)
  expect(json).not.toContain('"costs"')
})
