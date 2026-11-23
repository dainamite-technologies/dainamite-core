/**
 * #122 — POST /api/cpq/product-offerings takes the offering type from the
 * specification when the caller omits it, and still enforces V-OFF-7 when
 * the caller sends a type that does not match.
 */
import { CpqProductSpecification } from '../../data/entities'

const em = {
  findOne: jest.fn(),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'new-offering', ...data })),
  flush: jest.fn(),
}
const ctx = {
  auth: { sub: 'user', tenantId: 'tenant' },
  tenantId: 'tenant',
  organizationId: 'org',
  em,
  container: { resolve: () => ({}) },
}
jest.mock('../context', () => ({
  cpqContextError: jest.requireActual('../context').cpqContextError,
  resolveCpqRouteContext: jest.fn(async () => ctx),
}))

import { POST } from '../product-offerings/route'

const SPEC_ID = '22222222-2222-4222-8222-222222222222'
const post = (body: unknown) =>
  new Request('http://localhost/api/cpq/product-offerings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function mockSpec(specType: string) {
  em.findOne.mockImplementation(async (entity: unknown) =>
    entity === CpqProductSpecification ? { id: SPEC_ID, specType } : null,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/cpq/product-offerings offering type', () => {
  it('creates a bundle offering when the type is omitted and the spec is a bundle', async () => {
    mockSpec('bundle')
    const response = await POST(post({ specId: SPEC_ID, code: 'B', name: 'Bundle' }))
    expect(response.status).toBe(201)
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ offeringType: 'bundle' }))
    expect((await response.json()).offeringType).toBe('bundle')
  })

  it('creates a simple offering when the type is omitted and the spec is simple', async () => {
    mockSpec('simple')
    const response = await POST(post({ specId: SPEC_ID, code: 'S', name: 'Simple' }))
    expect(response.status).toBe(201)
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ offeringType: 'simple' }))
  })

  it('accepts an explicit type that matches the spec', async () => {
    mockSpec('bundle')
    const response = await POST(post({ specId: SPEC_ID, code: 'B', name: 'Bundle', offeringType: 'bundle' }))
    expect(response.status).toBe(201)
  })

  it('rejects an explicit type that does not match the spec (V-OFF-7)', async () => {
    mockSpec('bundle')
    const response = await POST(post({ specId: SPEC_ID, code: 'B', name: 'Bundle', offeringType: 'simple' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^V-OFF-7/)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('answers 400 when the specification does not exist', async () => {
    em.findOne.mockResolvedValue(null)
    const response = await POST(post({ specId: SPEC_ID, code: 'B', name: 'Bundle' }))
    expect(response.status).toBe(400)
    expect(em.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/cpq/product-offerings isSellable (#133)', () => {
  function mockSpecDefault(defaultOfferingSellable: boolean) {
    em.findOne.mockImplementation(async (entity: unknown) =>
      entity === CpqProductSpecification ? { id: SPEC_ID, specType: 'simple', defaultOfferingSellable } : null,
    )
  }

  it('takes the spec default when the caller omits isSellable', async () => {
    mockSpecDefault(false)
    const response = await POST(post({ specId: SPEC_ID, code: 'ONT', name: 'ONT' }))
    expect(response.status).toBe(201)
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isSellable: false }))
    expect((await response.json()).isSellable).toBe(false)
  })

  it('lets the caller override the spec default', async () => {
    mockSpecDefault(false)
    const response = await POST(post({ specId: SPEC_ID, code: 'ONT', name: 'ONT', isSellable: true }))
    expect(response.status).toBe(201)
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isSellable: true }))
  })

  it('stays sellable for a spec without the default (existing data)', async () => {
    mockSpec('simple')
    await POST(post({ specId: SPEC_ID, code: 'S', name: 'Simple' }))
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isSellable: true }))
  })
})

