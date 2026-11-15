import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-012: Delete test / dry Bill Runs (Spec F, F1)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-15-billing-operator-feedback.md (F-D1)
 *
 *   - deleting a test run removes the run, its outcomes and its test invoices;
 *   - a dry run deletes cleanly (no invoices);
 *   - a real run is refused with 422 `billing.run.delete_real_forbidden`;
 *   - the `mode` list filter narrows runs.
 * Self-contained: own account (soft-deleted after). The real run is scoped to
 * an account with nothing due, so it writes no documents.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function createAccount(request: APIRequestContext, token: string, nextBillDate: string): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Run delete ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleAnchor: '1',
      invoiceEmail: `inv-${uniq()}@example.com`,
      invoiceLanguage: 'en',
      nextBillDate,
      invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(res.ok(), `POST account status was ${res.status()}`).toBeTruthy()
  const accountId = ((await res.json()) as { id: string }).id
  const item = await apiRequest(request, 'POST', '/api/billing/items', {
    token,
    data: { billAccountId: accountId, type: 'recurring', billStartDate: nextBillDate, description: 'Plan', rateJson: { unit_price: 100 } },
  })
  expect(item.ok(), `POST item status was ${item.status()}`).toBeTruthy()
  return accountId
}

async function trigger(
  request: APIRequestContext,
  token: string,
  accountId: string,
  mode: 'real' | 'test' | 'dry',
  asOfDate: string,
): Promise<string> {
  const run = await apiRequest(request, 'POST', '/api/billing/runs', {
    token,
    data: { mode, asOfDate, scopedAccountIds: [accountId] },
  })
  expect(run.ok(), `POST run (${mode}) status was ${run.status()}`).toBeTruthy()
  return ((await run.json()) as { billRunId: string }).billRunId
}

test.describe('TC-BILL-012: delete test / dry Bill Runs (Spec F)', () => {
  let token: string
  const accounts: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterAll(async ({ request }) => {
    for (const id of accounts) {
      await apiRequest(request, 'DELETE', '/api/billing/accounts', { token, data: { id } })
    }
  })

  test('a test run is deleted with its test invoices and outcomes', async ({ request }) => {
    const accountId = await createAccount(request, token, '2026-08-01')
    accounts.push(accountId)
    const runId = await trigger(request, token, accountId, 'test', '2026-09-15')

    const before = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=true`, { token })
    expect(((await before.json()) as { items: unknown[] }).items.length).toBe(2)

    const filtered = await apiRequest(request, 'GET', `/api/billing/runs?mode=test&id=${runId}`, { token })
    expect(((await filtered.json()) as { items: unknown[] }).items).toHaveLength(1)

    const del = await apiRequest(request, 'DELETE', `/api/billing/runs/${runId}`, { token })
    expect(del.status()).toBe(200)
    expect(await del.json()).toEqual({ ok: true, invoicesRemoved: 2 })

    const after = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=true`, { token })
    expect(((await after.json()) as { items: unknown[] }).items).toHaveLength(0)
    const run = await apiRequest(request, 'GET', `/api/billing/runs?id=${runId}`, { token })
    expect(((await run.json()) as { items: unknown[] }).items).toHaveLength(0)
    const outcomes = await apiRequest(request, 'GET', `/api/billing/run-outcomes?billRunId=${runId}`, { token })
    expect(((await outcomes.json()) as { items: unknown[] }).items).toHaveLength(0)
  })

  test('a dry run deletes cleanly', async ({ request }) => {
    const accountId = await createAccount(request, token, '2026-08-01')
    accounts.push(accountId)
    const runId = await trigger(request, token, accountId, 'dry', '2026-08-15')
    const del = await apiRequest(request, 'DELETE', `/api/billing/runs/${runId}`, { token })
    expect(del.status()).toBe(200)
    expect(((await del.json()) as { invoicesRemoved: number }).invoicesRemoved).toBe(0)
  })

  test('a real run is never deleted', async ({ request }) => {
    // Nothing due up to the as-of date → the real run writes no documents.
    const accountId = await createAccount(request, token, '2030-01-01')
    accounts.push(accountId)
    const runId = await trigger(request, token, accountId, 'real', '2026-08-15')
    const del = await apiRequest(request, 'DELETE', `/api/billing/runs/${runId}`, { token })
    expect(del.status()).toBe(422)
    expect(((await del.json()) as { code: string }).code).toBe('billing.run.delete_real_forbidden')
  })
})
