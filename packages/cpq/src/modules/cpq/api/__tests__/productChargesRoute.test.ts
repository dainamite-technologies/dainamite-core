const userHasAllFeatures = jest.fn()
const assertCostPlusChargeWritable = jest.fn()
const assertCostPlusChargeHasPriceBasis = jest.fn()
const deactivatePriceBasisElements = jest.fn()
const deleteChargeElements = jest.fn()
const inChargeLock = jest.fn()
const costService = { assertCostPlusChargeWritable, assertCostPlusChargeHasPriceBasis, deactivatePriceBasisElements, deleteChargeElements, inChargeLock }
const em = { findAndCount: jest.fn(), find: jest.fn(), findOne: jest.fn(), create: jest.fn(), assign: jest.fn(), flush: jest.fn() }
/** The locked transaction's EM handed to the PUT body by `inChargeLock`. */
const tx = { findOne: jest.fn(), assign: jest.fn(), flush: jest.fn() }
const ctx = {
  auth: { sub: 'user-1', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
  container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : costService },
}
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))

import { DELETE, GET, POST, PUT, openApi } from '../product-charges/route'
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
  tx.flush.mockResolvedValue(undefined)
  tx.assign.mockImplementation((entity: Record<string, unknown>, data: Record<string, unknown>) => Object.assign(entity, data))
  // The real lock re-reads the charge under PESSIMISTIC_WRITE; here it hands over the same row.
  inChargeLock.mockImplementation(async (_id: string, _scope: unknown, run: (lockTx: unknown, charge: unknown) => Promise<unknown>) => run(tx, await em.findOne()))
  assertCostPlusChargeWritable.mockResolvedValue(undefined)
  assertCostPlusChargeHasPriceBasis.mockResolvedValue(undefined)
  userHasAllFeatures.mockResolvedValue(true)
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

  it('answers 403 before validating a malformed cost-plus payload', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await POST(request('POST', { ...body, markupRule: 'target_margin_percent', markupValue: 150 }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'COSTS_VIEW_REQUIRED' })
  })

  it('returns the markup of a created cost-plus charge from the RBAC answer (one lookup)', async () => {
    const response = await POST(request('POST', { ...body, isActive: false }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: '25' })
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
  })
})

describe('PUT /api/cpq/product-charges cost-plus gate', () => {
  it('refuses switching a fixed charge to cost-plus while pricing is unavailable', async () => {
    em.findOne.mockResolvedValue(charge({ pricingMethod: 'fixed', fixedPrice: '10', markupRule: null, markupValue: null }))
    assertCostPlusChargeWritable.mockRejectedValue(new QuotingError(422, 'COST_PLUS_NOT_AVAILABLE'))
    const response = await PUT(request('PUT', { id: chargeId, pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25 }))
    expect(response.status).toBe(422)
    expect(tx.flush).not.toHaveBeenCalled()
  })

  it('validates a markup-only patch against the merged charge', async () => {
    em.findOne.mockResolvedValue(charge({ pricingMethod: 'fixed', fixedPrice: '10', markupRule: null, markupValue: null }))
    const response = await PUT(request('PUT', { id: chargeId, markupValue: 30 }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Validation error' })
    expect(tx.flush).not.toHaveBeenCalled()
  })

  // I-4 / R15: the merged-charge validation would answer questions about the
  // stored markup, so authorization must come first.
  it.each([
    ['markupValue 150 on a target-margin charge', { markupRule: 'target_margin_percent', markupValue: '20.0000' }, { markupValue: 150 }],
    ['currencyCode null on an absolute-markup charge', { markupRule: 'markup_absolute', markupValue: '50.0000' }, { currencyCode: null }],
  ])('answers 403 before the 400 a costs viewer would get (%s)', async (_label, stored, patch) => {
    em.findOne.mockResolvedValue(charge(stored))
    const viewer = await PUT(request('PUT', { id: chargeId, ...patch }))
    expect(viewer.status).toBe(400)

    userHasAllFeatures.mockResolvedValue(false)
    const response = await PUT(request('PUT', { id: chargeId, ...patch }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'COSTS_VIEW_REQUIRED' })
    expect(tx.flush).not.toHaveBeenCalled()
  })

  it('refuses to switch a cost-plus charge away without cpq.costs.view', async () => {
    const entity = charge()
    em.findOne.mockResolvedValue(entity)
    userHasAllFeatures.mockResolvedValue(false)
    const response = await PUT(request('PUT', { id: chargeId, pricingMethod: 'fixed', fixedPrice: '99', currencyCode: 'EUR' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'COSTS_VIEW_REQUIRED' })
    expect(deactivatePriceBasisElements).not.toHaveBeenCalled()
    expect(inChargeLock).not.toHaveBeenCalled()
    expect(entity).toMatchObject({ pricingMethod: 'cost_plus', markupRule: 'markup_percent' })
  })

  it('clears markup and deactivates price-basis elements when a charge leaves cost-plus', async () => {
    const entity = charge()
    em.findOne.mockResolvedValue(entity)
    const response = await PUT(request('PUT', { id: chargeId, pricingMethod: 'fixed', fixedPrice: '99', currencyCode: 'EUR' }))
    expect(response.status).toBe(200)
    expect(entity).toMatchObject({ pricingMethod: 'fixed', markupRule: null, markupValue: null, fixedPrice: '99' })
    expect(assertCostPlusChargeWritable).not.toHaveBeenCalled()
    expect(deactivatePriceBasisElements).toHaveBeenCalledWith(tx, chargeId, expect.objectContaining({ organizationId: 'org', tenantId: 'tenant' }))
    expect(tx.flush).toHaveBeenCalled()
  })

  it('checks the price basis of an activated cost-plus charge under the charge-row lock', async () => {
    em.findOne.mockResolvedValue(charge({ isActive: false }))
    assertCostPlusChargeHasPriceBasis.mockImplementation(async (lockTx: unknown) => {
      // The count must run on the locked transaction, not on the request EM.
      expect(lockTx).toBe(tx)
      expect(inChargeLock).toHaveBeenCalledWith(chargeId, expect.objectContaining({ organizationId: 'org', tenantId: 'tenant' }), expect.any(Function))
      throw new QuotingError(422, 'NO_PRICE_BASIS_ELEMENT')
    })
    const response = await PUT(request('PUT', { id: chargeId, isActive: true }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'NO_PRICE_BASIS_ELEMENT' })
    expect(assertCostPlusChargeHasPriceBasis).toHaveBeenCalledWith(tx, { id: chargeId, pricingMethod: 'cost_plus', isActive: true }, expect.anything())
    expect(tx.flush).not.toHaveBeenCalled()
  })

  it('serializes markup from the RBAC answer after a cost-plus write', async () => {
    em.findOne.mockResolvedValue(charge())
    const response = await PUT(request('PUT', { id: chargeId, markupValue: 30 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ markupRule: 'markup_percent', markupValue: '30' })
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/cpq/product-charges', () => {
  it('soft-deletes the charge and cascades to its cost elements in the same flush', async () => {
    const entity: Record<string, unknown> = charge({ pricingMethod: 'fixed', fixedPrice: '10', markupRule: null, markupValue: null })
    em.findOne.mockResolvedValue(entity)
    const response = await DELETE(request('DELETE', { id: chargeId }))
    expect(response.status).toBe(200)
    expect(entity.deletedAt).toBeInstanceOf(Date)
    expect(deleteChargeElements).toHaveBeenCalledWith(em, chargeId, { organizationId: 'org', tenantId: 'tenant', deletedAt: null })
    expect(em.flush).toHaveBeenCalled()
  })

  it('refuses to delete a cost-plus charge without cpq.costs.view', async () => {
    const entity = charge()
    em.findOne.mockResolvedValue(entity)
    userHasAllFeatures.mockResolvedValue(false)
    const response = await DELETE(request('DELETE', { id: chargeId }))
    expect(response.status).toBe(403)
    expect(entity).not.toHaveProperty('deletedAt')
    expect(deleteChargeElements).not.toHaveBeenCalled()
  })
})

it('documents every method in openApi', () => {
  expect(Object.keys(openApi.methods).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT'])
})
