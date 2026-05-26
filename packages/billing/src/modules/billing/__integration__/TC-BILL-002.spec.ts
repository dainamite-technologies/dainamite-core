import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-002: Billing Item create + bulk create via REST API
 * Category: BILL — API
 * Priority: High
 *
 * Exercises `POST /api/billing/items` and the batched
 * `POST /api/billing/items/bulk`. Pins the bulk-create result
 * contract: every `items[]` entry — created or deduplicated — carries
 * the flush-assigned UUID, never an empty string.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const BASE = process.env.BASE_URL || 'http://localhost:3000'

async function createAccount(request: APIRequestContext, token: string): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Item-test account ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleAnchor: '1',
      invoiceEmail: `inv-${uniq()}@example.com`,
      invoiceLanguage: 'pl',
      nextBillDate: '2026-07-01',
      invoiceAddress: { line1: 'ul. A 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(res.ok(), `account POST status was ${res.status()}`).toBeTruthy()
  return (await res.json()).id as string
}

function recurringEntry(billAccountId: string, sourceRef?: string) {
  return {
    billAccountId,
    type: 'recurring' as const,
    billStartDate: '2026-07-01',
    description: 'MRC line',
    rateJson: { unit_price: 49.99 },
    ...(sourceRef ? { sourceRef } : {}),
  }
}

test.describe('TC-BILL-002: Billing Item create + bulk create (API)', () => {
  let token: string
  const accountIds: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterAll(async ({ request }) => {
    // Deleting the account soft-deletes; its items drop out of scope.
    while (accountIds.length > 0) {
      const id = accountIds.pop()!
      await apiRequest(request, 'DELETE', '/api/billing/accounts', { token, data: { id } })
    }
  })

  test('creates a single recurring item', async ({ request }) => {
    const accountId = await createAccount(request, token)
    accountIds.push(accountId)

    const res = await apiRequest(request, 'POST', '/api/billing/items', {
      token,
      data: recurringEntry(accountId),
    })
    expect(res.ok(), `POST status was ${res.status()}`).toBeTruthy()
    const body = await res.json()
    expect(body.id).toBeTruthy()
  })

  test('bulk-creates distinct items in one call', async ({ request }) => {
    const accountId = await createAccount(request, token)
    accountIds.push(accountId)

    const res = await apiRequest(request, 'POST', '/api/billing/items/bulk', {
      token,
      data: {
        items: [
          recurringEntry(accountId, `ref-${uniq()}`),
          recurringEntry(accountId, `ref-${uniq()}`),
        ],
      },
    })
    expect(res.ok(), `bulk POST status was ${res.status()}`).toBeTruthy()
    const body = await res.json()
    expect(body.created).toBe(2)
    expect(body.deduplicated).toBe(0)
    expect(body.items).toHaveLength(2)
    // Every created entry carries a real, flush-assigned UUID.
    for (const entry of body.items as Array<{ id: string }>) {
      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    }
  })

  test('dedups a source_ref repeated within the same payload (same id reported)', async ({
    request,
  }) => {
    const accountId = await createAccount(request, token)
    accountIds.push(accountId)
    const ref = `dup-${uniq()}`

    const res = await apiRequest(request, 'POST', '/api/billing/items/bulk', {
      token,
      data: {
        items: [recurringEntry(accountId, ref), recurringEntry(accountId, ref)],
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.created).toBe(1)
    expect(body.deduplicated).toBe(1)

    const items = body.items as Array<{ id: string; deduplicated: boolean }>
    const created = items.find((i) => !i.deduplicated)
    const repeated = items.find((i) => i.deduplicated)
    // Regression guard: the deduped repeat must report the SAME real
    // UUID as the row that persisted — not '' captured pre-flush.
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(repeated?.id).toBe(created?.id)
  })

  test('dedups against an already-persisted source_ref', async ({ request }) => {
    const accountId = await createAccount(request, token)
    accountIds.push(accountId)
    const ref = `existing-${uniq()}`

    const first = await apiRequest(request, 'POST', '/api/billing/items/bulk', {
      token,
      data: { items: [recurringEntry(accountId, ref)] },
    })
    const firstId = (await first.json()).items[0].id as string
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/)

    const second = await apiRequest(request, 'POST', '/api/billing/items/bulk', {
      token,
      data: { items: [recurringEntry(accountId, ref)] },
    })
    const secondBody = await second.json()
    expect(secondBody.created).toBe(0)
    expect(secondBody.deduplicated).toBe(1)
    expect(secondBody.items[0].id).toBe(firstId)
  })

  test('returns 404 when a referenced account is missing', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/billing/items/bulk', {
      token,
      data: {
        items: [recurringEntry('00000000-0000-4000-8000-000000000000', `ref-${uniq()}`)],
      },
    })
    expect(res.status()).toBe(404)
  })

  test('rejects unauthenticated bulk requests', async ({ request }) => {
    const res = await request.fetch(`${BASE}/api/billing/items/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ items: [] }),
    })
    expect([401, 403]).toContain(res.status())
  })
})
