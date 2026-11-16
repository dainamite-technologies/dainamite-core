import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { ensureSellerSettings } from './sellerSettings'

/**
 * TC-BILL-009: Payments — CSV import, auto-matching, allocation, credit (Spec C)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-payments.md
 *
 *   1. Two posted invoices on a fresh account (monthly, two bill dates).
 *   2. Upload a CSV: half of invoice 1, invoice 2 + 30 overpayment, a junk
 *      line, a EUR line → counts; invoice 1 partially paid, invoice 2 paid,
 *      the 30 overpayment applied to invoice 1 as credit.
 *   3. Account summary shows the remaining open amount; re-upload = duplicates.
 *   4. The junk payment is assigned to the account manually → credit applied.
 *
 * Self-contained (own account + items). Uses JSON upload (`{ fileName, content }`).
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

type InvoiceRow = { id: string; number: string; status: string; total_gross: string; outstanding: string; bill_date: string | null }

async function postedInvoices(request: APIRequestContext, token: string): Promise<{ accountId: string; invoices: InvoiceRow[] }> {
  const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Payments ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleDay: '1',
      invoiceEmail: `pay-${uniq()}@example.com`,
      nextBillDate: '2026-09-01',
      invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(account.ok(), `POST account status was ${account.status()}`).toBeTruthy()
  const accountId = ((await account.json()) as { id: string }).id
  const item = await apiRequest(request, 'POST', '/api/billing/items', {
    token,
    data: { billAccountId: accountId, type: 'recurring', billStartDate: '2026-09-01', description: 'Plan', rateJson: { unit_price: 100 }, taxRate: 0 },
  })
  expect(item.ok()).toBeTruthy()
  // Catch-up: as of 2026-10-15 → bill dates 2026-09-01 and 2026-10-01 → two drafts.
  const run = await apiRequest(request, 'POST', '/api/billing/runs', {
    token,
    data: { mode: 'real', asOfDate: '2026-10-15', scopedAccountIds: [accountId] },
  })
  expect(run.ok()).toBeTruthy()
  const list = async () =>
    ((await (await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=false`, { token })).json()) as {
      items: InvoiceRow[]
    }).items.sort((a, b) => String(a.bill_date).localeCompare(String(b.bill_date)))
  for (const draft of await list()) {
    const post = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: draft.id } })
    expect(post.ok(), `POST post status was ${post.status()}`).toBeTruthy()
  }
  const invoices = await list()
  expect(invoices).toHaveLength(2)
  return { accountId, invoices }
}

test.describe('TC-BILL-009: payments import and allocation', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    await ensureSellerSettings(request, token)
  })

  test('CSV upload allocates, applies credit, detects duplicates; manual assign applies credit', async ({ request }) => {
    const { accountId, invoices } = await postedInvoices(request, token)
    const [first, second] = invoices
    const junkRef = `misc ${uniq()}`
    const content = [
      'date,amount,currency,reference,payer_name,payer_account',
      `2026-11-20,50.00,PLN,"Part of ${first.number}",QA,`,
      `2026-11-20,130.00,PLN,"${second.number} with extra",QA,`,
      `2026-11-21,20.00,PLN,${junkRef},Someone,`,
      `2026-11-21,10.00,EUR,${first.number},QA,`,
    ].join('\n')

    const upload = await apiRequest(request, 'POST', '/api/billing/payments/import', { token, data: { fileName: 'qa.csv', content } })
    expect(upload.ok(), `import status was ${upload.status()}`).toBeTruthy()
    const summary = (await upload.json()) as { importId: string; counts: Record<string, number> }
    expect(summary.counts).toMatchObject({ allocated: 2, unmatched: 2, duplicate: 0, rejected: 0 })

    const detail = async (id: string) =>
      ((await (await apiRequest(request, 'GET', `/api/billing/invoices/${id}`, { token })).json()) as { invoice: InvoiceRow }).invoice
    // 50 + 30 credit from the overpayment → invoice 1: 80 of 100 paid.
    expect(await detail(first.id)).toMatchObject({ status: 'partially_paid' })
    expect(Number((await detail(first.id)).outstanding)).toBeCloseTo(20, 2)
    expect(await detail(second.id)).toMatchObject({ status: 'paid' })

    const again = await apiRequest(request, 'POST', '/api/billing/payments/import', { token, data: { fileName: 'qa.csv', content } })
    expect(((await again.json()) as { counts: Record<string, number> }).counts).toMatchObject({ duplicate: 4, allocated: 0 })

    const junk = ((await (await apiRequest(request, 'GET', `/api/billing/payments?search=${encodeURIComponent(junkRef)}`, { token })).json()) as {
      items: Array<{ id: string; status: string }>
    }).items[0]
    expect(junk.status).toBe('unmatched')
    const assign = await apiRequest(request, 'POST', '/api/billing/payments/assign', { token, data: { paymentId: junk.id, billAccountId: accountId } })
    expect(assign.ok(), `assign status was ${assign.status()}`).toBeTruthy()
    expect(await detail(first.id)).toMatchObject({ status: 'paid' })

    const summaryRes = await apiRequest(request, 'GET', `/api/billing/accounts/${accountId}/summary`, { token })
    const ar = (await summaryRes.json()) as { open_amount: string; credit_amount: string }
    expect(Number(ar.open_amount)).toBeCloseTo(0, 2)
    expect(Number(ar.credit_amount)).toBeCloseTo(0, 2)
  })
})
