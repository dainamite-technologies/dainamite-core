/**
 * Route guards added after review:
 * - PUT /api/cpq/product-offerings re-checks V-OFF-7 when specId or
 *   offeringType changes (POST already did).
 * - GET /api/cpq/quotes/attributes answers 400 for malformed configuration
 *   JSON instead of 500.
 */
import { CpqProductOffering, CpqProductSpecification } from '../../data/entities'

const em = { findOne: jest.fn(), assign: jest.fn(), flush: jest.fn() }
const ctx = {
  auth: { sub: 'user', tenantId: 'tenant' },
  tenantId: 'tenant',
  organizationId: 'org',
  em,
  container: { resolve: () => ({}) },
}
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))

import { PUT } from '../product-offerings/route'
import { GET as getAttributes } from '../quotes/attributes/route'

const OFFERING_ID = '11111111-1111-4111-8111-111111111111'
const SPEC_ID = '22222222-2222-4222-8222-222222222222'
const put = (body: unknown) =>
  new Request('http://localhost/api/cpq/product-offerings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function mockLookups(offering: Record<string, unknown>, spec: Record<string, unknown> | null) {
  em.findOne.mockImplementation(async (entity: unknown) => {
    if (entity === CpqProductOffering) return offering
    if (entity === CpqProductSpecification) return spec
    return null
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('PUT /api/cpq/product-offerings V-OFF-7', () => {
  it('rejects an offeringType that does not match the specification', async () => {
    mockLookups({ id: OFFERING_ID, specId: SPEC_ID, offeringType: 'simple' }, { id: SPEC_ID, specType: 'simple' })
    const response = await PUT(put({ id: OFFERING_ID, offeringType: 'bundle' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^V-OFF-7/)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a spec change to a spec of another type', async () => {
    mockLookups({ id: OFFERING_ID, specId: SPEC_ID, offeringType: 'simple' }, { id: SPEC_ID, specType: 'bundle' })
    const response = await PUT(put({ id: OFFERING_ID, specId: SPEC_ID }))
    expect(response.status).toBe(400)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a spec change to a missing specification', async () => {
    mockLookups({ id: OFFERING_ID, specId: SPEC_ID, offeringType: 'simple' }, null)
    expect((await PUT(put({ id: OFFERING_ID, specId: SPEC_ID }))).status).toBe(400)
  })

  it('skips the check when neither specId nor offeringType changes', async () => {
    mockLookups({ id: OFFERING_ID, specId: SPEC_ID, offeringType: 'bundle' }, { id: SPEC_ID, specType: 'simple' })
    const response = await PUT(put({ id: OFFERING_ID, name: 'Renamed' }))
    expect(response.status).toBe(200)
    expect(em.findOne).not.toHaveBeenCalledWith(CpqProductSpecification, expect.anything())
    expect(em.flush).toHaveBeenCalled()
  })

  it('accepts a matching type change', async () => {
    mockLookups({ id: OFFERING_ID, specId: SPEC_ID, offeringType: 'simple' }, { id: SPEC_ID, specType: 'bundle' })
    expect((await PUT(put({ id: OFFERING_ID, offeringType: 'bundle' }))).status).toBe(200)
  })
})

describe('GET /api/cpq/quotes/attributes', () => {
  it('answers 400 for malformed configuration JSON', async () => {
    const response = await getAttributes(
      new Request(`http://localhost/api/cpq/quotes/attributes?offeringId=${OFFERING_ID}&configuration=%7Bnot-json`),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid configuration JSON' })
  })
})
