import { CpqChargeCostElement, CpqPricingTable, CpqProductCharge } from '../../data/entities'
import { CpqCostService } from '../../services/costs/costService'

const getBoolConfig = jest.fn()
const guards = jest.fn()
const after = jest.fn()
const em: Record<string, jest.Mock> = {
  fork: jest.fn(), transactional: jest.fn(), findAndCount: jest.fn(), find: jest.fn(), findOne: jest.fn(),
  count: jest.fn(), create: jest.fn(), persist: jest.fn(), flush: jest.fn(),
}
const service = new CpqCostService({ em: em as never, featureTogglesService: { getBoolConfig } as never })
const ctx = {
  auth: { sub: 'user-1', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: () => service },
}
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../_helpers/quoteMutationGuard', () => ({
  CPQ_CHARGE_COST_ELEMENT_RESOURCE_KIND: 'cpq.charge_cost_element',
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
}))

import { GET, POST, PUT, DELETE, metadata, openApi } from '../charge-cost-elements/route'

const chargeId = '33333333-3333-4333-8333-333333333333'
const siblingChargeId = '77777777-7777-4777-8777-777777777777'
const tableId = '44444444-4444-4444-8444-444444444444'
const elementId = '66666666-6666-4666-8666-666666666666'
const scope = { organizationId: 'org', tenantId: 'tenant', deletedAt: null }

let charge: Record<string, unknown>
let table: Record<string, unknown> | null
let element: Record<string, unknown> | null
let duplicates = 0
let otherPriceBasis = 0

const fixedBody = {
  productChargeId: chargeId, code: 'cross_connect', name: 'Cross-connect', role: 'price_basis', costType: 'mrc',
  source: 'fixed', costModel: 'flat', amount: 10, currencyCode: 'EUR',
}
const request = (method: string, body?: unknown, query = '') => new Request(`http://localhost/api/cpq/charge-cost-elements${query}`, {
  method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(() => {
  jest.clearAllMocks()
  charge = { id: chargeId, pricingMethod: 'cost_plus', chargeType: 'mrc', isActive: true, quantityAttributeCode: null, deletedAt: null }
  table = { id: tableId, purpose: 'cost', priceColumns: [{ key: 'mrc' }] }
  element = { id: elementId, productChargeId: chargeId, code: 'cross_connect', name: 'X', role: 'price_basis', costType: 'mrc',
    source: 'fixed', costModel: 'flat', amount: '10', currencyCode: 'EUR', costTableId: null, costColumnKey: null,
    estimateAmount: null, isActive: true, deletedAt: null }
  duplicates = 0
  otherPriceBasis = 0
  getBoolConfig.mockResolvedValue({ ok: true, value: true })
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after, modifiedPayload: undefined })
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(em))
  em.flush.mockResolvedValue(undefined)
  em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: elementId, createdAt: new Date(0), updatedAt: new Date(0), ...data }))
  em.findOne.mockImplementation(async (entity: unknown) => {
    if (entity === CpqProductCharge) return charge
    if (entity === CpqPricingTable) return table
    if (entity === CpqChargeCostElement) return element
    return null
  })
  em.count.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => (where.code ? duplicates : otherPriceBasis))
  em.find.mockImplementation(async (entity: unknown) => (entity === CpqProductCharge ? [{ id: chargeId }, { id: siblingChargeId }] : []))
})

describe('charge-cost-elements metadata', () => {
  it('uses requireFeatures per the spec table and never requireRoles', () => {
    expect(metadata.GET.requireFeatures).toEqual(['cpq.products.view', 'cpq.costs.view'])
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      expect(metadata[method].requireFeatures).toEqual(['cpq.products.manage', 'cpq.pricing.manage', 'cpq.costs.view'])
    }
    expect(JSON.stringify(metadata)).not.toContain('requireRoles')
  })

  it('documents every method in openApi', () => {
    expect(Object.keys(openApi.methods).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT'])
  })
})

describe('toggle off', () => {
  it('answers 404 for every method and touches nothing', async () => {
    getBoolConfig.mockResolvedValue({ ok: true, value: false })
    const responses = [
      await GET(request('GET', undefined, `?productChargeId=${chargeId}`)),
      await POST(request('POST', fixedBody)),
      await PUT(request('PUT', { id: elementId, name: 'n' })),
      await DELETE(request('DELETE', undefined, `?id=${elementId}`)),
    ]
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404])
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.findAndCount).not.toHaveBeenCalled()
    expect(guards).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('lists tenant-scoped, non-deleted rows with pagination', async () => {
    em.findAndCount.mockResolvedValue([[element], 120])
    const response = await GET(request('GET', undefined, `?productChargeId=${chargeId}&page=2&pageSize=50`))
    expect(response.status).toBe(200)
    expect(em.findAndCount).toHaveBeenCalledWith(CpqChargeCostElement, { ...scope, productChargeId: chargeId },
      expect.objectContaining({ limit: 50, offset: 50 }))
    expect(await response.json()).toMatchObject({ total: 120, page: 2, pageSize: 50, totalPages: 3 })
  })

  it('rejects pageSize above 100 and a missing productChargeId with 400', async () => {
    expect((await GET(request('GET', undefined, `?productChargeId=${chargeId}&pageSize=101`))).status).toBe(400)
    expect((await GET(request('GET'))).status).toBe(400)
  })
})

describe('POST', () => {
  it('creates an element and runs the guard before and after-success after the write', async () => {
    const response = await POST(request('POST', fixedBody))
    expect(response.status).toBe(201)
    expect((await response.json()).item).toMatchObject({ code: 'cross_connect', role: 'price_basis', amount: '10' })
    expect(em.create).toHaveBeenCalledWith(CpqChargeCostElement, expect.objectContaining({ organizationId: 'org', tenantId: 'tenant', productChargeId: chargeId }))
    expect(guards).toHaveBeenCalledWith(expect.anything(), expect.any(Request),
      expect.objectContaining({ resourceKind: 'cpq.charge_cost_element', operation: 'create' }))
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for an unknown charge', async () => {
    charge = null as never
    expect((await POST(request('POST', fixedBody))).status).toBe(404)
  })

  it('422 PRICE_BASIS_REQUIRES_COST_PLUS on a non-cost-plus charge', async () => {
    charge.pricingMethod = 'fixed'
    const response = await POST(request('POST', fixedBody))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'PRICE_BASIS_REQUIRES_COST_PLUS' })
  })

  it('422 COST_TYPE_MISMATCH when the price-basis cost type differs from the charge type', async () => {
    const response = await POST(request('POST', { ...fixedBody, costType: 'nrc' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'COST_TYPE_MISMATCH' })
  })

  const tableBody = { ...fixedBody, role: 'margin_only', source: 'table', amount: undefined, currencyCode: undefined, costTableId: tableId, costColumnKey: 'mrc' }

  it('422 WRONG_TABLE_PURPOSE when the table is a price table', async () => {
    table!.purpose = 'price'
    const response = await POST(request('POST', tableBody))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'WRONG_TABLE_PURPOSE' })
  })

  it('looks the cost table up inside the tenant scope', async () => {
    await POST(request('POST', tableBody))
    expect(em.findOne).toHaveBeenCalledWith(CpqPricingTable, { ...scope, id: tableId })
  })

  it('422 DUPLICATE_CODE when a charge priced on the same line already has the code', async () => {
    duplicates = 1
    const response = await POST(request('POST', fixedBody))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'DUPLICATE_CODE' })
    expect(em.count).toHaveBeenCalledWith(CpqChargeCostElement, { ...scope, productChargeId: { $in: [chargeId, siblingChargeId] }, code: 'cross_connect' })
  })

  it('422 MODEL_REQUIRES_TABLE for a tiered fixed element', async () => {
    const response = await POST(request('POST', { ...fixedBody, costModel: 'tiered' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'MODEL_REQUIRES_TABLE' })
  })

  it('400 on an unknown field', async () => {
    expect((await POST(request('POST', { ...fixedBody, bogus: 1 }))).status).toBe(400)
  })

  it('returns the guard response and writes nothing when a mutation guard rejects', async () => {
    guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Blocked' }, { status: 423 }) })
    const response = await POST(request('POST', fixedBody))
    expect(response.status).toBe(423)
    expect(em.create).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
})

describe('PUT', () => {
  it('refuses a code change (immutable)', async () => {
    const response = await PUT(request('PUT', { id: elementId, code: 'renamed' }))
    expect(response.status).toBe(400)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses a productChargeId change', async () => {
    expect((await PUT(request('PUT', { id: elementId, productChargeId: chargeId }))).status).toBe(400)
  })

  it('updates a field and runs the guard', async () => {
    const response = await PUT(request('PUT', { id: elementId, name: 'Renamed' }))
    expect(response.status).toBe(200)
    expect((await response.json()).item.name).toBe('Renamed')
    expect(guards).toHaveBeenCalledWith(expect.anything(), expect.any(Request),
      expect.objectContaining({ operation: 'update', resourceId: elementId }))
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('422 NO_PRICE_BASIS_ELEMENT when deactivating the last active price-basis element of an active cost-plus charge', async () => {
    const response = await PUT(request('PUT', { id: elementId, isActive: false }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'NO_PRICE_BASIS_ELEMENT' })
    expect(em.count).toHaveBeenCalledWith(CpqChargeCostElement,
      expect.objectContaining({ ...scope, productChargeId: chargeId, role: 'price_basis', isActive: true, id: { $ne: elementId } }))
  })

  it('422 NO_PRICE_BASIS_ELEMENT when re-roling the last price-basis element', async () => {
    const response = await PUT(request('PUT', { id: elementId, role: 'margin_only' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'NO_PRICE_BASIS_ELEMENT' })
  })

  it('allows deactivating a price-basis element when another one stays active', async () => {
    otherPriceBasis = 1
    expect((await PUT(request('PUT', { id: elementId, isActive: false }))).status).toBe(200)
  })

  it('allows deactivating the last price-basis element of an inactive charge', async () => {
    charge.isActive = false
    expect((await PUT(request('PUT', { id: elementId, isActive: false }))).status).toBe(200)
  })

  it('404 for an unknown element', async () => {
    element = null
    expect((await PUT(request('PUT', { id: elementId, name: 'n' }))).status).toBe(404)
  })
})

describe('DELETE', () => {
  it('soft-deletes an element behind the guard', async () => {
    (element as Record<string, unknown>).role = 'margin_only'
    const response = await DELETE(request('DELETE', undefined, `?id=${elementId}`))
    expect(response.status).toBe(200)
    expect(element!.deletedAt).toBeInstanceOf(Date)
    expect(guards).toHaveBeenCalledWith(expect.anything(), expect.any(Request),
      expect.objectContaining({ operation: 'delete', resourceId: elementId }))
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('422 NO_PRICE_BASIS_ELEMENT for the last active price-basis element of an active cost-plus charge', async () => {
    const response = await DELETE(request('DELETE', undefined, `?id=${elementId}`))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'NO_PRICE_BASIS_ELEMENT' })
    expect(element!.deletedAt).toBeNull()
  })

  it('refuses when the guard rejects', async () => {
    guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Blocked' }, { status: 423 }) })
    expect((await DELETE(request('DELETE', undefined, `?id=${elementId}`))).status).toBe(423)
    expect(element!.deletedAt).toBeNull()
  })

  it('400 without id', async () => {
    expect((await DELETE(request('DELETE'))).status).toBe(400)
  })
})
