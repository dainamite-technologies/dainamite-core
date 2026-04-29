import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CPQ-004: Bundle slot validation rules (V-SLOT-1, V-SLOT-2, V-SLOT-6)
 * Category: CPQ — API
 * Priority: High
 *
 * V-SLOT rules drive bundle correctness; even a single dropped check can
 * silently allow malformed bundles. We exercise the rules from the API
 * boundary (not just the unit tests) to catch wiring regressions.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function asJson<T = unknown>(res: { json: () => Promise<T>; ok: () => boolean; status: () => number }): Promise<T> {
  expect(res.ok(), `unexpected status ${res.status()}`).toBeTruthy()
  return res.json()
}

async function deleteSpec(request: APIRequestContext, token: string, id: string) {
  await apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id } })
}

async function createSpec(
  request: APIRequestContext,
  token: string,
  specType: 'simple' | 'bundle',
): Promise<string> {
  const code = `S-${uniq()}`
  const res = await apiRequest(request, 'POST', '/api/cpq/product-specifications', {
    token,
    data: { code, name: `Spec ${code}`, specType, lifecycleStatus: 'active' },
  })
  const body = await asJson<{ id: string }>(res)
  return body.id
}

test.describe('TC-CPQ-004: Bundle slot validation (V-SLOT)', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test('V-SLOT-1: rejects when parent spec is not bundle type', async ({ request }) => {
    const cleanup: string[] = []
    try {
      const simpleSpecId = await createSpec(request, token, 'simple')
      cleanup.push(simpleSpecId)
      const targetSpecId = await createSpec(request, token, 'simple')
      cleanup.push(targetSpecId)

      const res = await apiRequest(request, 'POST', '/api/cpq/bundle-slots', {
        token,
        data: {
          specId: simpleSpecId,
          targetSpecId,
          componentGroup: 'access',
          name: 'Slot 1',
        },
      })

      expect(res.status()).toBe(400)
      const body = (await res.json()) as { error?: string }
      expect(body.error).toMatch(/V-SLOT-1|bundle/i)
    } finally {
      for (const id of cleanup) await deleteSpec(request, token, id)
    }
  })

  test('V-SLOT-2: rejects when target spec does not exist', async ({ request }) => {
    const cleanup: string[] = []
    try {
      const bundleSpecId = await createSpec(request, token, 'bundle')
      cleanup.push(bundleSpecId)

      const res = await apiRequest(request, 'POST', '/api/cpq/bundle-slots', {
        token,
        data: {
          specId: bundleSpecId,
          targetSpecId: '00000000-0000-4000-8000-000000000000',
          componentGroup: 'access',
          name: 'Slot 1',
        },
      })

      expect(res.status()).toBe(400)
      const body = (await res.json()) as { error?: string }
      expect(body.error).toMatch(/V-SLOT-2|target/i)
    } finally {
      for (const id of cleanup) await deleteSpec(request, token, id)
    }
  })

  test('V-SLOT-6: rejects self-referencing slot', async ({ request }) => {
    const cleanup: string[] = []
    try {
      const bundleSpecId = await createSpec(request, token, 'bundle')
      cleanup.push(bundleSpecId)

      const res = await apiRequest(request, 'POST', '/api/cpq/bundle-slots', {
        token,
        data: {
          specId: bundleSpecId,
          targetSpecId: bundleSpecId,
          componentGroup: 'access',
          name: 'Self',
        },
      })

      expect(res.status()).toBe(400)
      const body = (await res.json()) as { error?: string }
      expect(body.error).toMatch(/V-SLOT-6|same/i)
    } finally {
      for (const id of cleanup) await deleteSpec(request, token, id)
    }
  })

  test('V-SLOT-5: rejects cardinalityMax < cardinalityMin', async ({ request }) => {
    const cleanup: string[] = []
    try {
      const bundleSpecId = await createSpec(request, token, 'bundle')
      cleanup.push(bundleSpecId)
      const targetSpecId = await createSpec(request, token, 'simple')
      cleanup.push(targetSpecId)

      const res = await apiRequest(request, 'POST', '/api/cpq/bundle-slots', {
        token,
        data: {
          specId: bundleSpecId,
          targetSpecId,
          componentGroup: 'access',
          name: 'Slot 1',
          cardinalityMin: 5,
          cardinalityMax: 2,
        },
      })

      expect(res.status()).toBe(400)
      const body = (await res.json()) as { error?: string }
      expect(body.error).toMatch(/V-SLOT-5|cardinality/i)
    } finally {
      for (const id of cleanup) await deleteSpec(request, token, id)
    }
  })

  test('happy path: creates a slot when all rules pass', async ({ request }) => {
    const cleanup: string[] = []
    let slotId: string | null = null
    try {
      const bundleSpecId = await createSpec(request, token, 'bundle')
      cleanup.push(bundleSpecId)
      const targetSpecId = await createSpec(request, token, 'simple')
      cleanup.push(targetSpecId)

      const res = await apiRequest(request, 'POST', '/api/cpq/bundle-slots', {
        token,
        data: {
          specId: bundleSpecId,
          targetSpecId,
          componentGroup: 'access',
          name: 'Valid Slot',
          cardinalityMin: 1,
          cardinalityMax: 3,
        },
      })

      expect(res.ok(), `expected 200 OK, got ${res.status()}`).toBeTruthy()
      const body = await asJson<{ id: string; specId: string; targetSpecId: string }>(res)
      expect(body.specId).toBe(bundleSpecId)
      expect(body.targetSpecId).toBe(targetSpecId)
      slotId = body.id
    } finally {
      if (slotId) {
        await apiRequest(request, 'DELETE', '/api/cpq/bundle-slots', {
          token,
          data: { id: slotId },
        }).catch(() => undefined)
      }
      for (const id of cleanup) await deleteSpec(request, token, id)
    }
  })
})
