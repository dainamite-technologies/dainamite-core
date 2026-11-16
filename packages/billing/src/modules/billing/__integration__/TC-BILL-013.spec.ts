import { test, expect } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-013: Gross-basis item price reaches the invoice exactly (Spec F, F3)
 * Category: BILL — API
 * Priority: Medium
 * Spec: .ai/specs/2026-11-15-billing-operator-feedback.md (F-D2)
 *
 * A recurring item entered as 49.99 GROSS at 23 % VAT: the test draft line
 * carries gross 49.99 (net 40.64 + VAT 9.35) — a value net-only storage
 * could not reproduce. The item API echoes `price_basis`. A gross basis on a
 * tiered usage rate is refused (422).
 * Self-contained: own account (soft-deleted after), test drafts wiped.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

test.describe('TC-BILL-013: gross price basis (Spec F)', () => {
  let token: string
  let accountId: string | null = null
  let runId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterEach(async ({ request }) => {
    if (runId) {
      await apiRequest(request, 'DELETE', `/api/billing/runs/${runId}`, { token })
      runId = null
    }
    if (accountId) {
      await apiRequest(request, 'DELETE', '/api/billing/accounts', { token, data: { id: accountId } })
      accountId = null
    }
  })

  test('the typed gross is the invoice gross', async ({ request }) => {
    const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
      token,
      data: {
        customerId: `cust-${uniq()}`,
        name: `Gross ${uniq()}`,
        currencyCode: 'PLN',
        billCycle: 'monthly',
        billCycleDay: '1',
        invoiceEmail: `inv-${uniq()}@example.com`,
        invoiceLanguage: 'pl',
        nextBillDate: '2026-11-01',
        invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
      },
    })
    expect(account.ok()).toBeTruthy()
    accountId = ((await account.json()) as { id: string }).id

    const item = await apiRequest(request, 'POST', '/api/billing/items', {
      token,
      data: {
        billAccountId: accountId,
        type: 'recurring',
        billStartDate: '2026-11-01',
        description: 'Internet (brutto)',
        rateJson: { unit_price: 49.99 },
        taxRate: 23,
        priceBasis: 'gross',
      },
    })
    expect(item.ok(), `POST item status was ${item.status()}`).toBeTruthy()
    const items = await apiRequest(request, 'GET', `/api/billing/items?billAccountId=${accountId}`, { token })
    expect(((await items.json()) as { items: Array<{ price_basis: string }> }).items[0].price_basis).toBe('gross')

    const run = await apiRequest(request, 'POST', '/api/billing/runs', {
      token,
      data: { mode: 'test', asOfDate: '2026-11-01', scopedAccountIds: [accountId] },
    })
    expect(run.ok()).toBeTruthy()
    runId = ((await run.json()) as { billRunId: string }).billRunId

    const list = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=true`, { token })
    const invoiceId = ((await list.json()) as { items: Array<{ id: string }> }).items[0].id
    const detail = await apiRequest(request, 'GET', `/api/billing/invoices/${invoiceId}`, { token })
    const body = (await detail.json()) as { lines: Array<{ net_amount: string; tax_amount: string; gross_amount: string }> }
    expect(body.lines.map((l) => [Number(l.net_amount), Number(l.tax_amount), Number(l.gross_amount)])).toEqual([[40.64, 9.35, 49.99]])
  })

  test('a gross basis on a tiered usage rate is refused', async ({ request }) => {
    const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
      token,
      data: {
        customerId: `cust-${uniq()}`,
        name: `Tiered ${uniq()}`,
        currencyCode: 'PLN',
        billCycle: 'monthly',
        billCycleDay: '1',
        invoiceEmail: `inv-${uniq()}@example.com`,
        invoiceLanguage: 'en',
        nextBillDate: '2026-11-01',
        invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
      },
    })
    accountId = ((await account.json()) as { id: string }).id
    const item = await apiRequest(request, 'POST', '/api/billing/items', {
      token,
      data: {
        billAccountId: accountId,
        type: 'usage',
        uomCode: 'gb',
        billStartDate: '2026-11-01',
        description: 'Data',
        priceBasis: 'gross',
        rateJson: { model: 'volume', tiers: [{ up_to: null, unit_price: 1 }] },
      },
    })
    expect(item.status()).toBeGreaterThanOrEqual(400)
    expect(item.status()).toBeLessThan(500)
  })
})
