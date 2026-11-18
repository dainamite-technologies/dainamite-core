/**
 * Cross-module writes from CPQ routes go through the owning module's
 * command (sales.quotes.delete, catalog.products.create) instead of direct
 * ORM writes on SalesQuote / SalesQuoteLine / CatalogProduct.
 */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqProductSpecification } from '../../data/entities'

const execute = jest.fn()
const em = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
const ctx = {
  auth: { sub: 'user', tenantId: 'tenant' },
  tenantId: 'tenant',
  organizationId: 'org',
  organizationScope: null,
  em,
  container: { resolve: (name: string) => (name === 'commandBus' ? { execute } : {}) },
}
jest.mock('../context', () => ({
  cpqContextError: jest.requireActual('../context').cpqContextError,
  resolveCpqRouteContext: jest.fn(async () => ctx),
}))

import { DELETE as deleteQuote } from '../quotes/[quoteId]/route'
import { POST as createSpec } from '../product-specifications/route'

const CONFIG_ID = '11111111-1111-4111-8111-111111111111'
const QUOTE_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const scope = { organizationId: 'org', tenantId: 'tenant' }

function deleteRequest() {
  return new Request(`http://localhost/api/cpq/quotes/${CONFIG_ID}`, { method: 'DELETE' })
}
const params = { params: Promise.resolve({ quoteId: CONFIG_ID }) }

function postRequest(body: unknown) {
  return new Request('http://localhost/api/cpq/product-specifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('DELETE /api/cpq/quotes/[quoteId]', () => {
  let config: Record<string, unknown>
  let lines: Array<Record<string, unknown>>
  let salesQuote: Record<string, unknown> | null

  beforeEach(() => {
    config = { id: CONFIG_ID, quoteId: QUOTE_ID, cpqStatus: 'draft', deletedAt: null }
    lines = [{ id: 'lc1', quoteLineId: 'sl1', deletedAt: null }, { id: 'lc2', quoteLineId: 'sl2', deletedAt: null }]
    salesQuote = { id: QUOTE_ID, deletedAt: null }
    em.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteConfiguration) return config
      if (entity === SalesQuote) return salesQuote
      return null
    })
    em.find.mockImplementation(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? lines : []))
    execute.mockResolvedValue({ result: { quoteId: QUOTE_ID }, logEntry: null })
  })

  it('deletes the sales quote through sales.quotes.delete, then soft-deletes the CPQ rows', async () => {
    const response = await deleteQuote(deleteRequest(), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('sales.quotes.delete', expect.objectContaining({
      input: { body: { id: QUOTE_ID } },
      ctx: expect.objectContaining({ selectedOrganizationId: 'org', organizationIds: ['org'], auth: ctx.auth }),
    }))
    expect(em.findOne).toHaveBeenCalledWith(SalesQuote, { id: QUOTE_ID, ...scope })

    // Core rows are never written directly.
    expect(salesQuote?.deletedAt).toBeNull()
    expect(em.findOne.mock.calls.some(([entity]) => entity !== CpqQuoteConfiguration && entity !== SalesQuote)).toBe(false)

    expect(config.deletedAt).toBeInstanceOf(Date)
    expect(lines.every((l) => l.deletedAt instanceof Date)).toBe(true)
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(em.flush.mock.invocationCallOrder[0])
  })

  it('leaves CPQ rows untouched when the sales command fails', async () => {
    execute.mockRejectedValue(new CrudHttpError(403, { error: 'Forbidden' }))
    const response = await deleteQuote(deleteRequest(), params)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(config.deletedAt).toBeNull()
    expect(lines.every((l) => l.deletedAt === null)).toBe(true)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('skips the command when the sales quote is already gone (retry finishes CPQ cleanup)', async () => {
    salesQuote = null
    const response = await deleteQuote(deleteRequest(), params)
    expect(response.status).toBe(200)
    expect(execute).not.toHaveBeenCalled()
    expect(config.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('refuses terminal quotes before any write', async () => {
    config.cpqStatus = 'accepted'
    const response = await deleteQuote(deleteRequest(), params)
    expect(response.status).toBe(409)
    expect(execute).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns 404 when no CPQ configuration matches', async () => {
    em.findOne.mockResolvedValue(null)
    const response = await deleteQuote(deleteRequest(), params)
    expect(response.status).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('POST /api/cpq/product-specifications', () => {
  const body = { code: 'Fiber Pro 1', name: 'Fiber Pro', description: 'Fast line' }

  beforeEach(() => {
    em.findOne.mockResolvedValue(null)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: 'spec-1', ...data }))
    execute.mockResolvedValue({ result: { productId: PRODUCT_ID }, logEntry: null })
  })

  it('creates the catalog product through catalog.products.create', async () => {
    const response = await createSpec(postRequest(body))
    expect(response.status).toBe(201)
    expect((await response.json()).productId).toBe(PRODUCT_ID)

    expect(execute).toHaveBeenCalledWith('catalog.products.create', expect.objectContaining({
      input: {
        ...scope,
        title: 'Fiber Pro',
        sku: 'FIBER-PRO-1',
        handle: 'fiber-pro-1',
        description: 'Fast line',
        productType: 'configurable',
        isConfigurable: true,
        isActive: true,
      },
      ctx: expect.objectContaining({ selectedOrganizationId: 'org', auth: ctx.auth }),
    }))
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.create).toHaveBeenCalledWith(CpqProductSpecification, expect.objectContaining({ productId: PRODUCT_ID, ...scope }))
    expect(em.create.mock.calls.some(([entity]) => entity === CatalogProduct)).toBe(false)
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('omits a null description from the catalog command input', async () => {
    await createSpec(postRequest({ ...body, description: null }))
    expect(execute.mock.calls[0][1].input).not.toHaveProperty('description')
  })

  it('reuses an existing catalog product without running the command', async () => {
    em.findOne.mockResolvedValue({ id: PRODUCT_ID })
    const response = await createSpec(postRequest(body))
    expect(response.status).toBe(201)
    expect(execute).not.toHaveBeenCalled()
    expect(em.create).toHaveBeenCalledWith(CpqProductSpecification, expect.objectContaining({ productId: PRODUCT_ID }))
  })

  it('does not touch the catalog when productId is given', async () => {
    await createSpec(postRequest({ ...body, productId: PRODUCT_ID }))
    expect(execute).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('maps a catalog command error to its status and creates no specification', async () => {
    execute.mockRejectedValue(new CrudHttpError(409, { error: 'SKU already exists' }))
    const response = await createSpec(postRequest(body))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'SKU already exists' })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
