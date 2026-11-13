const userHasAllFeatures = jest.fn()
const assertCostPlusChargeWritable = jest.fn()
const em = { findAndCount: jest.fn(), find: jest.fn(), findOne: jest.fn(), create: jest.fn(), assign: jest.fn(), flush: jest.fn() }
const ctx = {
  auth: { sub: 'user-1', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : { assertCostPlusChargeWritable } },
}
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))

import { GET, POST, PUT, openApi } from '../product-charges/route'
import { GET as GET_OFFERINGS } from '../product-offerings/route'
import { QuotingError } from '../../services/cpqQuotingService'

const chargeId = '33333333-3333-4333-8333-333333333333'
const productId = '11111111-1111-4111-8111-111111111111'

function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: chargeId, productId, offeringId: null, code: 'tail_mrc', name: 'Tail', description: null,
    chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus', pricingTableId: null, priceColumnKey: null,
    fixedPrice: null, currencyCode: 'EUR', quantityAttributeCode: null, markupRule: 'markup_percent', markupValue: '25.0000',
    applicabilityCondition: null, sortOrder: 0, isActive: true, createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
  }
}
const request = (method: string, body?: unknown, query = '') => new Request(`http://localhost/api/cpq/product-charges${query}`, {
  method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(() => {
  jest.clearAllMocks()
  em.flush.mockResolvedValue(undefined)
  em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: chargeId, createdAt: new Date(0), updatedAt: new Date(0), ...data }))
  em.assign.mockImplementation((entity: Record<string, unknown>, data: Record<string, unknown>) => Object.assign(entity, data))
  assertCostPlusChargeWritable.mockResolvedValue(undefined)
})

describe('GET /api/cpq/product-charges markup redaction', () => {
  it('keeps pricingMethod but strips markup without cpq.costs.view', async () => {
    em.findAndCount.mockResolvedValue([[charge()], 1])
    userHasAllFeatures.mockResolvedValue(false)
    const body = await (await GET(request('GET'))).json()
    expect(body.items[0].pricingMethod).toBe('cost_plus')
    expect(body.items[0]).not.toHaveProperty('markupRule')
    expect(body.items[0]).not.toHaveProperty('markupValue')
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['cpq.costs.view'], { tenantId: 'tenant', organizationId: 'org' })
  })

  it('returns markup to cpq.costs.view holders', async () => {
    em.findAndCount.mockResolvedValue([[charge()], 1])
    userHasAllFeatures.mockResolvedValue(true)
    const body = await (await GET(request('GET'))).json()
    expect(body.items[0]).toMatchObject({ markupRule: 'markup_percent', markupValue: '25.0000' })
  })

  it('skips the RBAC lookup when no charge carries markup', async () => {
    em.findAndCount.mockResolvedValue([[charge({ pricingMethod: 'fixed', markupRule: null, markupValue: null })], 1])
    const body = await (await GET(request('GET'))).json()
    expect(body.items[0]).not.toHaveProperty('markupRule')
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })
})

describe('GET /api/cpq/product-offerings markup redaction', () => {
  it('strips charge markup on the offering detail without cpq.costs.view', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'off-1', specId: 'spec-1', offeringType: 'simple' }).mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([charge()])
    userHasAllFeatures.mockResolvedValue(false)
    const body = await (await GET_OFFERINGS(new Request('http://localhost/api/cpq/product-offerings?id=off-1'))).json()
    expect(body.charges[0].pricingMethod).toBe('cost_plus')
    expect(body.charges[0]).not.toHaveProperty('markupValue')
  })

  it('returns charge markup on the offering list to cpq.costs.view holders', async () => {
    em.findAndCount.mockResolvedValueOnce([[{ id: 'off-1', specId: 'spec-1' }], 1])
    em.find.mockResolvedValueOnce([charge({ offeringId: 'off-1' })])
    userHasAllFeatures.mockResolvedValue(true)
    const body = await (await GET_OFFERINGS(new Request('http://localhost/api/cpq/product-offerings'))).json()
    expect(body.items[0].charges[0]).toMatchObject({ pricingMethod: 'cost_plus', markupValue: '25.0000' })
  })
})

describe('POST /api/cpq/product-charges cost-plus gate', () => {
  const body = { productId, code: 'tail_mrc', name: 'Tail', chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25 }

  it('refuses cost-plus without cpq.costs.view (403) and stores nothing', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await POST(request('POST', body))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'COSTS_VIEW_REQUIRED' })
    expect(em.create).not.toHaveBeenCalled()
  })

  it.each(['COST_PLUS_DISABLED', 'COST_PLUS_NOT_AVAILABLE'])('returns 422 %s from the cost service gate', async (code) => {
    userHasAllFeatures.mockResolvedValue(true)
    assertCostPlusChargeWritable.mockRejectedValue(new QuotingError(422, code))
    const response = await POST(request('POST', body))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: code })
    expect(assertCostPlusChargeWritable).toHaveBeenCalledWith('tenant')
    expect(em.create).not.toHaveBeenCalled()
  })

  it('creates a fixed charge without touching the cost gate', async () => {
    const response = await POST(request('POST', { productId, code: 'fee', name: 'Fee', chargeType: 'nrc', pricingMethod: 'fixed', fixedPrice: '10', currencyCode: 'EUR' }))
    expect(response.status).toBe(201)
    expect(assertCostPlusChargeWritable).not.toHaveBeenCalled()
    expect(userHasAllFeatures).not.toHaveBeenCalled()
    expect(await response.json()).not.toHaveProperty('markupRule')
  })

  it('rejects markup on a fixed charge with a validation error', async () => {
    const response = await POST(request('POST', { productId, code: 'fee', name: 'Fee', chargeType: 'nrc', pricingMethod: 'fixed', fixedPrice: '10', currencyCode: 'EUR', markupValue: 5 }))
    expect(response.status).toBe(400)
  })
})

describe('PUT /api/cpq/product-charges cost-plus gate', () => {
  it('refuses switching a fixed charge to cost-plus while pricing is unavailable', async () => {
    em.findOne.mockResolvedValue(charge({ pricingMethod: 'fixed', fixedPrice: '10', markupRule: null, markupValue: null }))
    userHasAllFeatures.mockResolvedValue(true)
    assertCostPlusChargeWritable.mockRejectedValue(new QuotingError(422, 'COST_PLUS_NOT_AVAILABLE'))
    const response = await PUT(request('PUT', { id: chargeId, pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25 }))
    expect(response.status).toBe(422)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('validates a markup-only patch against the merged charge', async () => {
    em.findOne.mockResolvedValue(charge({ pricingMethod: 'fixed', fixedPrice: '10', markupRule: null, markupValue: null }))
    const response = await PUT(request('PUT', { id: chargeId, markupValue: 30 }))
    expect(response.status).toBe(400)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('clears markup when a charge leaves cost-plus', async () => {
    const entity = charge()
    em.findOne.mockResolvedValue(entity)
    const response = await PUT(request('PUT', { id: chargeId, pricingMethod: 'fixed', fixedPrice: '99', currencyCode: 'EUR' }))
    expect(response.status).toBe(200)
    expect(entity).toMatchObject({ pricingMethod: 'fixed', markupRule: null, markupValue: null, fixedPrice: '99' })
    expect(assertCostPlusChargeWritable).not.toHaveBeenCalled()
  })
})

it('documents every method in openApi', () => {
  expect(Object.keys(openApi.methods).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT'])
})
