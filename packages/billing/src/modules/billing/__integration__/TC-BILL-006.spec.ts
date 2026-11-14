import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-006: Billing-owned invoice ledger (Spec 0)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-standalone-invoice-ledger.md
 *
 *   1. A real Bill Run for a fresh account writes a draft numbered `DRAFT-…`.
 *   2. Posting assigns the series number (default mask `INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`),
 *      status `posted`, outstanding = gross; a second post → 409.
 *   3. The document lives in billing only — core sales never lists it.
 *
 * Self-contained: its own account + item, scoped run. Posted documents are
 * immutable by design (no delete), so they stay in the test database.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

type InvoiceRow = { id: string; number: string; status: string; total_gross: string; outstanding: string; document_type: string }

async function createBilledAccount(request: APIRequestContext, token: string): Promise<string> {
  const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Ledger ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleAnchor: '1',
      invoiceEmail: `inv-${uniq()}@example.com`,
      nextBillDate: '2026-10-01',
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
      billStartDate: '2026-10-01',
      description: 'Internet 300',
      rateJson: { unit_price: 79 },
    },
  })
  expect(item.ok(), `POST item status was ${item.status()}`).toBeTruthy()
  return accountId
}

async function listInvoices(request: APIRequestContext, token: string, accountId: string): Promise<InvoiceRow[]> {
  const res = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=false`, { token })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { items: InvoiceRow[] }).items
}

test.describe('TC-BILL-006: billing-owned invoice ledger', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test('draft → post assigns the series number; the document never appears in core sales', async ({ request }) => {
    const accountId = await createBilledAccount(request, token)

    const run = await apiRequest(request, 'POST', '/api/billing/runs', {
      token,
      data: { mode: 'real', asOfDate: '2026-10-15', scopedAccountIds: [accountId] },
    })
    expect(run.ok(), `POST run status was ${run.status()}`).toBeTruthy()

    const [draft] = await listInvoices(request, token, accountId)
    expect(draft).toMatchObject({ status: 'draft', document_type: 'invoice' })
    expect(draft.number).toMatch(/^DRAFT-/)

    const post = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: draft.id } })
    expect(post.ok(), `POST post status was ${post.status()}`).toBeTruthy()
    const posted = (await post.json()) as { invoiceNumber: string; status: string }
    expect(posted.status).toBe('posted')
    expect(posted.invoiceNumber).toMatch(/^INV\/\d{4}\/\d{2}\/\d{4}$/)

    const [after] = await listInvoices(request, token, accountId)
    expect(after).toMatchObject({ id: draft.id, status: 'posted', number: posted.invoiceNumber })
    expect(after.outstanding).toBe(after.total_gross)

    const again = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: draft.id } })
    expect(again.status()).toBe(409)

    const sales = await apiRequest(request, 'GET', `/api/sales/invoices?search=${encodeURIComponent(posted.invoiceNumber)}`, { token })
    if (sales.ok()) {
      const salesItems = ((await sales.json()) as { items?: Array<{ id: string }> }).items ?? []
      expect(salesItems.some((row) => row.id === draft.id)).toBe(false)
    }
  })
})
