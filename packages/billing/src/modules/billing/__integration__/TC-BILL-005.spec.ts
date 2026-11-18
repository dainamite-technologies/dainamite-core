import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-005: Bill Run catches up on every due cycle (Spec A)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-cycle-semantics.md
 *
 * An account whose next bill date lies three cycles before the as-of date,
 * with one monthly in-advance item:
 *   - a dry run previews 3 cycles and writes no invoice;
 *   - a test run writes 3 TEST drafts (one per bill date), each covering its
 *     own month, and leaves the account untouched;
 *   - a legacy `catchUp` flag in the body is accepted and ignored.
 * Self-contained: creates its own account + item, wipes its test drafts.
 * Scoped with `scopedAccountIds` so other tenant data can't interfere.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

type Cycle = { bill_date: string; period_start: string | null; period_end: string | null; status: string; invoice_id: string | null }

async function createAccountWithItem(request: APIRequestContext, token: string): Promise<string> {
  const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Catch-up ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleDay: '1',
      invoiceEmail: `inv-${uniq()}@example.com`,
      invoiceLanguage: 'en',
      nextBillDate: '2026-08-01',
      invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(account.ok(), `POST account status was ${account.status()}`).toBeTruthy()
  const accountId = ((await account.json()) as { id: string }).id

  const item = await apiRequest(request, 'POST', '/api/billing/items', {
    token,
    data: {
      billAccountId: accountId,
      type: 'recurring',
      billStartDate: '2026-08-01',
      description: 'Internet 300',
      rateJson: { unit_price: 100 },
      chargeTiming: 'in_advance',
    },
  })
  expect(item.ok(), `POST item status was ${item.status()}`).toBeTruthy()
  return accountId
}

async function runCycles(
  request: APIRequestContext,
  token: string,
  accountId: string,
  mode: 'dry' | 'test',
): Promise<{ billRunId: string; cycles: Cycle[] }> {
  const run = await apiRequest(request, 'POST', '/api/billing/runs', {
    token,
    data: { mode, asOfDate: '2026-10-15', scopedAccountIds: [accountId], catchUp: true },
  })
  expect(run.ok(), `POST run (${mode}) status was ${run.status()}`).toBeTruthy()
  const { billRunId } = (await run.json()) as { billRunId: string }

  const outcomes = await apiRequest(request, 'GET', `/api/billing/run-outcomes?billRunId=${billRunId}`, { token })
  const body = (await outcomes.json()) as { items: Array<{ bill_account_id: string; cycles: Cycle[] | null }> }
  const outcome = body.items.find((row) => row.bill_account_id === accountId)
  expect(outcome, 'outcome for the scoped account').toBeTruthy()
  return { billRunId, cycles: outcome?.cycles ?? [] }
}

test.describe('TC-BILL-005: Bill Run catch-up (Spec A)', () => {
  let token: string
  let accountId: string | null = null
  const testRunIds: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterEach(async ({ request }) => {
    while (testRunIds.length) {
      await apiRequest(request, 'POST', '/api/billing/test-invoices/wipe', {
        token,
        data: { billRunId: testRunIds.pop() },
      })
    }
    if (accountId) {
      await apiRequest(request, 'DELETE', '/api/billing/accounts', { token, data: { id: accountId } })
      accountId = null
    }
  })

  test('dry run previews every due cycle without writing invoices', async ({ request }) => {
    accountId = await createAccountWithItem(request, token)
    const { cycles } = await runCycles(request, token, accountId, 'dry')
    expect(cycles.map((c) => [c.bill_date, c.status, c.invoice_id])).toEqual([
      ['2026-08-01', 'previewed', null],
      ['2026-09-01', 'previewed', null],
      ['2026-10-01', 'previewed', null],
    ])
  })

  test('test run writes one TEST draft per bill date, each for its own month', async ({ request }) => {
    accountId = await createAccountWithItem(request, token)
    const { billRunId, cycles } = await runCycles(request, token, accountId, 'test')
    testRunIds.push(billRunId)

    expect(cycles.map((c) => [c.bill_date, c.period_start, c.period_end, c.status])).toEqual([
      ['2026-08-01', '2026-08-01', '2026-08-31', 'invoiced'],
      ['2026-09-01', '2026-09-01', '2026-09-30', 'invoiced'],
      ['2026-10-01', '2026-10-01', '2026-10-31', 'invoiced'],
    ])
    expect(new Set(cycles.map((c) => c.invoice_id)).size).toBe(3)

    const invoices = await apiRequest(
      request,
      'GET',
      `/api/billing/invoices?billAccountId=${accountId}&testRun=true`,
      { token },
    )
    const invoiceRows = ((await invoices.json()) as { items: unknown[] }).items
    expect(invoiceRows).toHaveLength(3)

    // Test mode never advances the account: a second dry run still sees 3 cycles.
    const again = await runCycles(request, token, accountId, 'dry')
    expect(again.cycles).toHaveLength(3)
  })
})
