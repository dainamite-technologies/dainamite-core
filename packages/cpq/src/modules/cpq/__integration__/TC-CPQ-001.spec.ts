import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CPQ-001: Product specification CRUD via REST API
 * Category: CPQ — API
 * Priority: High
 *
 * Validates the foundation entity of the CPQ product catalogue.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function deleteSpec(request: APIRequestContext, token: string, id: string): Promise<void> {
  await apiRequest(request, 'DELETE', '/api/cpq/product-specifications', {
    token,
    data: { id },
  })
}

test.describe('TC-CPQ-001: Product Specification CRUD (API)', () => {
  let token: string
  const createdIds: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterEach(async ({ request }) => {
    while (createdIds.length > 0) {
      const id = createdIds.pop()!
      await deleteSpec(request, token, id)
    }
  })

  test('creates a simple specification with defaults', async ({ request }) => {
    const code = `SPEC-${uniq()}`
    const res = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { code, name: 'Test Spec' },
    })
    expect(res.ok(), `POST status was ${res.status()}`).toBeTruthy()

    const body = await res.json()
    expect(body).toMatchObject({
      code,
      name: 'Test Spec',
      specType: 'simple',
      lifecycleStatus: 'draft',
      version: 1,
      isActive: true,
    })
    expect(body.id).toBeTruthy()
    createdIds.push(body.id)
  })

  test('rejects creation with missing code', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { name: 'No Code' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects creation with empty code', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { code: '', name: 'Empty Code' },
    })
    expect(res.status()).toBe(400)
  })

  test('lists previously created specifications', async ({ request }) => {
    const code = `SPEC-${uniq()}`
    const created = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { code, name: 'Listable Spec' },
    })
    const createdBody = await created.json()
    createdIds.push(createdBody.id)

    const list = await apiRequest(request, 'GET', '/api/cpq/product-specifications?pageSize=100', {
      token,
      data: undefined,
    })
    expect(list.ok()).toBeTruthy()
    const listBody = await list.json()
    const found = (listBody.items as Array<{ id: string; code: string }>).find((s) => s.id === createdBody.id)
    expect(found).toBeDefined()
    expect(found?.code).toBe(code)
  })

  test('reads a specification detail by id (with related collections)', async ({ request }) => {
    const code = `SPEC-${uniq()}`
    const created = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { code, name: 'Detail Spec', specType: 'bundle' },
    })
    const createdBody = await created.json()
    createdIds.push(createdBody.id)

    const detail = await apiRequest(request, 'GET', `/api/cpq/product-specifications?id=${createdBody.id}`, {
      token,
      data: undefined,
    })
    expect(detail.ok()).toBeTruthy()
    const detailBody = await detail.json()
    expect(detailBody.id).toBe(createdBody.id)
    expect(detailBody.specType).toBe('bundle')
    expect(Array.isArray(detailBody.attributes)).toBe(true)
    expect(Array.isArray(detailBody.offerings)).toBe(true)
    expect(Array.isArray(detailBody.relationships)).toBe(true)
  })

  test('returns 404 for unknown id', async ({ request }) => {
    const res = await apiRequest(
      request,
      'GET',
      '/api/cpq/product-specifications?id=00000000-0000-4000-8000-000000000000',
      { token, data: undefined },
    )
    expect(res.status()).toBe(404)
  })

  test('updates fields and bumps the persisted state', async ({ request }) => {
    const code = `SPEC-${uniq()}`
    const created = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { code, name: 'Original Name' },
    })
    const { id } = await created.json()
    createdIds.push(id)

    const upd = await apiRequest(request, 'PUT', '/api/cpq/product-specifications', {
      token,
      data: { id, name: 'Updated Name', lifecycleStatus: 'active' },
    })
    expect(upd.ok(), `PUT status was ${upd.status()}`).toBeTruthy()

    const detail = await apiRequest(request, 'GET', `/api/cpq/product-specifications?id=${id}`, {
      token,
      data: undefined,
    })
    const body = await detail.json()
    expect(body.name).toBe('Updated Name')
    expect(body.lifecycleStatus).toBe('active')
  })

  test('soft-deletes a specification (subsequent detail returns 404)', async ({ request }) => {
    const code = `SPEC-${uniq()}`
    const created = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
      token,
      data: { code, name: 'To Delete' },
    })
    const { id } = await created.json()

    const del = await apiRequest(request, 'DELETE', '/api/cpq/product-specifications', {
      token,
      data: { id },
    })
    expect(del.ok(), `DELETE status was ${del.status()}`).toBeTruthy()

    const detail = await apiRequest(request, 'GET', `/api/cpq/product-specifications?id=${id}`, {
      token,
      data: undefined,
    })
    expect(detail.status()).toBe(404)
  })

  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/cpq/product-specifications`,
      { method: 'GET' },
    )
    expect([401, 403]).toContain(res.status())
  })
})
