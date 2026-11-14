import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { ensureSellerSettings } from './sellerSettings'

/**
 * TC-BILL-007: Invoice documents — VAT, due date, PDF (Spec B)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-invoice-documents.md
 *
 *   1. Items carry VAT rates (23 % explicit, 0 % explicit) → the draft has
 *      per-line VAT and totals = Σ lines.
 *   2. The draft PDF renders (watermarked preview) before posting.
 *   3. Posting sets due date = issue date + the account's terms (7 days) and
 *      freezes the PDF; the list exposes due_date / days_overdue.
 *   4. The account summary counts the posted invoice as open, not overdue.
 *
 * Self-contained: own account + items, scoped run. Posted documents are
 * immutable by design, so they stay in the test database.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

type InvoiceRow = {
  id: string
  number: string
  status: string
  subtotal_net: string
  tax_total: string
  total_gross: string
  issue_date: string | null
  due_date: string | null
  days_overdue: number
}

async function createAccountWithVatItems(request: APIRequestContext, token: string): Promise<string> {
  const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `VAT ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleAnchor: '1',
      invoiceEmail: `vat-${uniq()}@example.com`,
      invoiceLanguage: 'pl',
      nextBillDate: '2026-10-01',
      paymentTermsDays: 7,
      invoiceAddress: { line1: 'ul. Kupującego 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(account.ok(), `POST account status was ${account.status()}`).toBeTruthy()
  const accountId = ((await account.json()) as { id: string }).id
  for (const [description, unitPrice, taxRate] of [
    ['Internet 300', 100, 23],
    ['Usługa zwolniona', 15, 0],
  ] as const) {
    const item = await apiRequest(request, 'POST', '/api/billing/items', {
      token,
      data: {
        billAccountId: accountId,
        type: 'recurring',
        billStartDate: '2026-10-01',
        description,
        rateJson: { unit_price: unitPrice },
        taxRate,
      },
    })
    expect(item.ok(), `POST item status was ${item.status()}`).toBeTruthy()
  }
  return accountId
}

async function listInvoices(request: APIRequestContext, token: string, accountId: string): Promise<InvoiceRow[]> {
  const res = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=false`, { token })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { items: InvoiceRow[] }).items
}

test.describe('TC-BILL-007: VAT, due date and PDF', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    await ensureSellerSettings(request, token)
  })

  test('VAT per line, draft PDF preview, due date and frozen PDF at post', async ({ request }) => {
    const accountId = await createAccountWithVatItems(request, token)
    const run = await apiRequest(request, 'POST', '/api/billing/runs', {
      token,
      data: { mode: 'real', asOfDate: '2026-10-15', scopedAccountIds: [accountId] },
    })
    expect(run.ok(), `POST run status was ${run.status()}`).toBeTruthy()

    const [draft] = await listInvoices(request, token, accountId)
    expect(draft).toMatchObject({ status: 'draft' })
    // 100 @ 23 % + 15 @ 0 %
    expect(Number(draft.subtotal_net)).toBeCloseTo(115, 2)
    expect(Number(draft.tax_total)).toBeCloseTo(23, 2)
    expect(Number(draft.total_gross)).toBeCloseTo(138, 2)

    const detail = await apiRequest(request, 'GET', `/api/billing/invoices/${draft.id}`, { token })
    const { lines } = (await detail.json()) as { lines: Array<{ tax_rate: string; tax_amount: string }> }
    expect(lines.map((l) => Number(l.tax_rate)).sort((a, b) => a - b)).toEqual([0, 23])

    const preview = await apiRequest(request, 'GET', `/api/billing/invoices/${draft.id}/pdf`, { token })
    expect(preview.status()).toBe(200)
    expect(preview.headers()['content-type']).toContain('application/pdf')
    expect((await preview.body()).subarray(0, 4).toString()).toBe('%PDF')

    const post = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: draft.id } })
    expect(post.ok(), `POST post status was ${post.status()}`).toBeTruthy()

    const [posted] = await listInvoices(request, token, accountId)
    expect(posted.status).toBe('posted')
    const issue = new Date(`${posted.issue_date!.slice(0, 10)}T00:00:00Z`)
    const due = new Date(`${posted.due_date!.slice(0, 10)}T00:00:00Z`)
    expect((due.getTime() - issue.getTime()) / 86_400_000).toBe(7)
    expect(posted.days_overdue).toBe(0)

    const frozen = await apiRequest(request, 'GET', `/api/billing/invoices/${draft.id}/pdf?download=1`, { token })
    expect(frozen.status()).toBe(200)
    expect(frozen.headers()['content-disposition']).toContain('attachment')

    const summary = await apiRequest(request, 'GET', `/api/billing/accounts/${accountId}/summary`, { token })
    expect(summary.ok()).toBeTruthy()
    const body = (await summary.json()) as { open_amount: string; overdue_count: number }
    expect(Number(body.open_amount)).toBeCloseTo(138, 2)
    expect(body.overdue_count).toBe(0)

    const overdueOnly = await apiRequest(
      request,
      'GET',
      `/api/billing/invoices?billAccountId=${accountId}&overdue=true`,
      { token },
    )
    expect(((await overdueOnly.json()) as { items: unknown[] }).items).toHaveLength(0)
  })
})
