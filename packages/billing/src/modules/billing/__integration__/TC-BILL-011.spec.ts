import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-011: Prepaid period close — catch-up, charge timing, tax point (Spec F)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-15-billing-operator-feedback.md (F4, F4b, F5)
 *
 * The operator's report (F4), against the real database: a prepaid account
 * with next bill date 2026-11-14, a 99 setup fee and a 49 monthly plan in
 * advance. ONE real run as of 2026-12-14 must close BOTH bill dates:
 *   - Nov 14: setup fee + plan for Nov 14 – Dec 13,
 *   - Dec 14: plan for Dec 14 – Jan 13,
 * and leave next_bill_date = 2027-01-14. Then, with the tax point switched to
 * `consumption`, a 10 net @ 23 % plan debits 12.30.
 * Self-contained: own accounts (soft-deleted after); the tax point is
 * restored to `topup` in a finally block. Serial — the tax point is org-wide.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

type Cycle = { bill_date: string; status: string; total_debit?: string }
type Txn = { type: string; amount: string; source_ref: string | null }

async function createPrepaidAccount(request: APIRequestContext, token: string, nextBillDate: string): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Prepaid ${uniq()}`,
      currencyCode: 'EUR',
      billCycle: 'monthly',
      billCycleDay: '14',
      invoiceEmail: `inv-${uniq()}@example.com`,
      invoiceLanguage: 'en',
      nextBillDate,
      billingMode: 'prepaid',
      invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(res.ok(), `POST account status was ${res.status()}`).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

async function createItem(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/billing/items', { token, data })
  expect(res.ok(), `POST item status was ${res.status()}`).toBeTruthy()
}

async function realRun(request: APIRequestContext, token: string, accountId: string, asOfDate: string): Promise<Cycle[]> {
  const run = await apiRequest(request, 'POST', '/api/billing/runs', {
    token,
    data: { mode: 'real', asOfDate, scopedAccountIds: [accountId] },
  })
  expect(run.ok(), `POST run status was ${run.status()}`).toBeTruthy()
  const { billRunId } = (await run.json()) as { billRunId: string }
  const outcomes = await apiRequest(request, 'GET', `/api/billing/run-outcomes?billRunId=${billRunId}`, { token })
  const body = (await outcomes.json()) as { items: Array<{ bill_account_id: string; cycles: Cycle[] | null }> }
  return body.items.find((row) => row.bill_account_id === accountId)?.cycles ?? []
}

async function charges(request: APIRequestContext, token: string, accountId: string): Promise<Txn[]> {
  const res = await apiRequest(request, 'GET', `/api/billing/transactions?billAccountId=${accountId}&pageSize=50`, { token })
  const rows = ((await res.json()) as { items: Txn[] }).items
  return rows.filter((row) => row.type === 'recurring' || row.type === 'one_time')
}

async function nextBillDate(request: APIRequestContext, token: string, accountId: string): Promise<string> {
  const res = await apiRequest(request, 'GET', `/api/billing/accounts?id=${accountId}&pageSize=1`, { token })
  return ((await res.json()) as { items: Array<{ next_bill_date: string }> }).items[0].next_bill_date.slice(0, 10)
}

test.describe.serial('TC-BILL-011: prepaid period close (Spec F)', () => {
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

  test('one real run closes every due bill date, in advance (the F4 report)', async ({ request }) => {
    const accountId = await createPrepaidAccount(request, token, '2026-11-14')
    accounts.push(accountId)
    await createItem(request, token, {
      billAccountId: accountId,
      type: 'one_time',
      billStartDate: '2026-11-14',
      description: 'Setup fee',
      rateJson: { amount: 99 },
    })
    await createItem(request, token, {
      billAccountId: accountId,
      type: 'recurring',
      billStartDate: '2026-11-14',
      description: 'Plan',
      rateJson: { unit_price: 49 },
      chargeTiming: 'in_advance',
    })

    const cycles = await realRun(request, token, accountId, '2026-12-14')
    expect(cycles.map((c) => [c.bill_date, c.status, c.total_debit])).toEqual([
      ['2026-11-14', 'charged', '148.0000'],
      ['2026-12-14', 'charged', '49.0000'],
    ])
    expect(await nextBillDate(request, token, accountId)).toBe('2027-01-14')
    const refs = (await charges(request, token, accountId)).map((t) => t.source_ref ?? '')
    expect(refs).toHaveLength(3)
    expect(refs.filter((ref) => ref.startsWith('one_time-'))).toHaveLength(1)
    expect(refs.some((ref) => ref.endsWith('-charge-2026-11-14-2026-12-13'))).toBe(true)
    expect(refs.some((ref) => ref.endsWith('-charge-2026-12-14-2027-01-13'))).toBe(true)
  })

  test('tax at billing: a 10 net @ 23 % plan debits 12.30', async ({ request }) => {
    const set = (prepaidTaxPoint: 'topup' | 'consumption') =>
      apiRequest(request, 'PUT', '/api/billing/settings', { token, data: { prepaidTaxPoint } })
    try {
      expect((await set('consumption')).ok()).toBeTruthy()
      const accountId = await createPrepaidAccount(request, token, '2026-11-14')
      accounts.push(accountId)
      await createItem(request, token, {
        billAccountId: accountId,
        type: 'recurring',
        billStartDate: '2026-11-14',
        description: 'Plan (VAT at billing)',
        rateJson: { unit_price: 10 },
        taxRate: 23,
        chargeTiming: 'in_advance',
      })
      await realRun(request, token, accountId, '2026-11-14')
      expect((await charges(request, token, accountId)).map((t) => t.amount)).toEqual(['-12.3000'])
    } finally {
      await set('topup')
    }
  })
})
