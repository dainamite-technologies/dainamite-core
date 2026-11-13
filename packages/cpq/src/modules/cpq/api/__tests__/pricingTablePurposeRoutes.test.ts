const userHasAllFeatures = jest.fn()
const em = { findAndCount: jest.fn(), find: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), assign: jest.fn(), flush: jest.fn() }
const ctx = {
  auth: { sub: 'user-1', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: () => ({ userHasAllFeatures }) },
}
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))

import * as tables from '../pricing-tables/route'
import * as entries from '../pricing-table-entries/route'
import * as charges from '../product-charges/route'

const tableId = '44444444-4444-4444-8444-444444444444'
const entryId = '55555555-5555-4555-8555-555555555555'
const productId = '11111111-1111-4111-8111-111111111111'
const table = (purpose: string) => ({ id: tableId, code: 'xconnect', name: 'Cross-connect', purpose, dimensions: [], priceColumns: [{ key: 'mrc', label: 'MRC' }], currencyCodeList: ['EUR'], isActive: true })
const entry = { id: entryId, pricingTableId: tableId, dimensionValues: {}, prices: { mrc: 7777.77 }, currencyCode: 'EUR', isActive: true }
const req = (path: string, method = 'GET', body?: unknown) => new Request(`http://localhost/api/cpq/${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const tableBody = { code: 'xconnect', name: 'Cross-connect', dimensions: [], priceColumns: [{ key: 'mrc', label: 'MRC' }], currencyCodeList: ['EUR'] }

beforeEach(() => {
  jest.clearAllMocks()
  em.flush.mockResolvedValue(undefined)
  em.count.mockResolvedValue(0)
  em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: tableId, ...data }))
  em.assign.mockImplementation((entity: Record<string, unknown>, data: Record<string, unknown>) => Object.assign(entity, data))
})

describe('pricing-tables by feature set', () => {
  it('lists only price tables without cpq.costs.view', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    em.findAndCount.mockResolvedValue([[table('price')], 1])
    const body = await (await tables.GET(req('pricing-tables'))).json()
    expect(em.findAndCount.mock.calls[0][1]).toMatchObject({ purpose: 'price', organizationId: 'org', tenantId: 'tenant' })
    expect(body.items[0].purpose).toBe('price')
  })

  it('answers an empty page when a user without cpq.costs.view filters for cost tables', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const body = await (await tables.GET(req('pricing-tables?purpose=cost'))).json()
    expect(body).toMatchObject({ items: [], total: 0 })
    expect(em.findAndCount).not.toHaveBeenCalled()
  })

  it('lists every table, filterable by purpose, with cpq.costs.view', async () => {
    userHasAllFeatures.mockResolvedValue(true)
    em.findAndCount.mockResolvedValue([[table('price'), table('cost')], 2])
    await tables.GET(req('pricing-tables'))
    expect(em.findAndCount.mock.calls[0][1]).not.toHaveProperty('purpose')
    await tables.GET(req('pricing-tables?purpose=cost'))
    expect(em.findAndCount.mock.calls[1][1]).toMatchObject({ purpose: 'cost' })
  })

  it('returns 404 for a cost table read by id without cpq.costs.view, and the table with it', async () => {
    em.findOne.mockResolvedValue(table('cost'))
    em.find.mockResolvedValue([entry])
    userHasAllFeatures.mockResolvedValue(false)
    expect((await tables.GET(req(`pricing-tables?id=${tableId}`))).status).toBe(404)
    expect(em.find).not.toHaveBeenCalled()
    userHasAllFeatures.mockResolvedValue(true)
    const response = await tables.GET(req(`pricing-tables?id=${tableId}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ purpose: 'cost', entries: [{ id: entryId }] })
  })

  it('reads a price table by id without an RBAC lookup', async () => {
    em.findOne.mockResolvedValue(table('price'))
    em.find.mockResolvedValue([])
    expect((await tables.GET(req(`pricing-tables?id=${tableId}`))).status).toBe(200)
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('refuses creating a cost table without cpq.costs.view and defaults purpose to price', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const refused = await tables.POST(req('pricing-tables', 'POST', { ...tableBody, purpose: 'cost' }))
    expect(refused.status).toBe(403)
    expect(em.create).not.toHaveBeenCalled()
    const created = await tables.POST(req('pricing-tables', 'POST', tableBody))
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ purpose: 'price' })
  })

  it('hides cost tables from PUT and DELETE without cpq.costs.view', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    em.findOne.mockResolvedValue(table('cost'))
    expect((await tables.PUT(req('pricing-tables', 'PUT', { id: tableId, name: 'X' }))).status).toBe(404)
    expect((await tables.DELETE(req('pricing-tables', 'DELETE', { id: tableId }))).status).toBe(404)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses turning a price table into a cost table without cpq.costs.view', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    em.findOne.mockResolvedValue(table('price'))
    expect((await tables.PUT(req('pricing-tables', 'PUT', { id: tableId, purpose: 'cost' }))).status).toBe(403)
  })

  it('locks purpose while a charge references the table (422 PURPOSE_LOCKED)', async () => {
    userHasAllFeatures.mockResolvedValue(true)
    const entity = table('price')
    em.findOne.mockResolvedValue(entity)
    em.count.mockResolvedValue(1)
    const response = await tables.PUT(req('pricing-tables', 'PUT', { id: tableId, purpose: 'cost' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'PURPOSE_LOCKED' })
    expect(entity.purpose).toBe('price')
    expect(em.count.mock.calls[0][1]).toMatchObject({ pricingTableId: tableId, organizationId: 'org', tenantId: 'tenant', deletedAt: null })
  })

  it('changes purpose of an unreferenced table, and edits other fields of a referenced one', async () => {
    userHasAllFeatures.mockResolvedValue(true)
    const entity = table('price')
    em.findOne.mockResolvedValue(entity)
    expect((await tables.PUT(req('pricing-tables', 'PUT', { id: tableId, purpose: 'cost' }))).status).toBe(200)
    expect(entity.purpose).toBe('cost')
    em.count.mockResolvedValue(3)
    expect((await tables.PUT(req('pricing-tables', 'PUT', { id: tableId, name: 'Renamed', purpose: 'cost' }))).status).toBe(200)
  })
})

describe('pricing-table-entries by feature set', () => {
  it('returns 404 for a cost table entry list without cpq.costs.view', async () => {
    em.count.mockResolvedValue(1)
    userHasAllFeatures.mockResolvedValue(false)
    const response = await entries.GET(req(`pricing-table-entries?pricingTableId=${tableId}`))
    expect(response.status).toBe(404)
    expect(em.findAndCount).not.toHaveBeenCalled()
    expect(em.count.mock.calls[0][1]).toMatchObject({ id: { $in: [tableId] }, purpose: 'cost', organizationId: 'org', tenantId: 'tenant' })
  })

  it('lists cost table entries with cpq.costs.view and price table entries without an RBAC lookup', async () => {
    em.findAndCount.mockResolvedValue([[entry], 1])
    em.count.mockResolvedValue(1)
    userHasAllFeatures.mockResolvedValue(true)
    expect((await entries.GET(req(`pricing-table-entries?pricingTableId=${tableId}`))).status).toBe(200)
    em.count.mockResolvedValue(0)
    userHasAllFeatures.mockClear()
    expect((await entries.GET(req(`pricing-table-entries?pricingTableId=${tableId}`))).status).toBe(200)
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('refuses writes to cost table entries without cpq.costs.view', async () => {
    em.count.mockResolvedValue(1)
    userHasAllFeatures.mockResolvedValue(false)
    em.findOne.mockResolvedValue({ ...entry })
    const payload = { pricingTableId: tableId, dimensionValues: {}, prices: { mrc: 1 } }
    expect((await entries.POST(req('pricing-table-entries', 'POST', [payload, payload]))).status).toBe(404)
    expect((await entries.POST(req('pricing-table-entries', 'POST', payload))).status).toBe(404)
    expect((await entries.PUT(req('pricing-table-entries', 'PUT', { id: entryId, prices: { mrc: 2 } }))).status).toBe(404)
    expect((await entries.DELETE(req('pricing-table-entries', 'DELETE', { id: entryId }))).status).toBe(404)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('product-charges table purpose', () => {
  it('refuses a table-priced charge that references a cost table (422 WRONG_TABLE_PURPOSE)', async () => {
    em.count.mockResolvedValue(1)
    const response = await charges.POST(req('product-charges', 'POST', {
      productId, code: 'xc', name: 'XC', chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'table', pricingTableId: tableId, priceColumnKey: 'mrc',
    }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'WRONG_TABLE_PURPOSE' })
    expect(em.create).not.toHaveBeenCalled()
  })
})

it('documents every method of both routes in openApi', () => {
  expect(Object.keys(tables.openApi.methods).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT'])
  expect(Object.keys(entries.openApi.methods).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT'])
})
