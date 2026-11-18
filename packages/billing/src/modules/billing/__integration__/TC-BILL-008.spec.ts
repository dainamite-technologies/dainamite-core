import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { ensureSellerSettings } from './sellerSettings'

/**
 * TC-BILL-008: Sending invoices by email (Spec B)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-invoice-documents.md
 *
 *   1. A draft cannot be sent (409 billing.invoice.not_posted).
 *   2. A posted invoice is sent through the platform `sendEmail()`; with
 *      `OM_TEST_MODE` the message is captured (recipient + subject) and the
 *      attempt is logged in `metadata.deliveries`.
 *   3. A placeholder address (`@invalid.local`) is refused with 422.
 *
 * Delivery status may be `sent` or `failed` depending on whether the test
 * instance has an outbound transport; either way exactly one attempt is
 * logged. The capture-file assertion runs only when the server shares this
 * machine's temp dir (local runs).
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const capturePath = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || join(tmpdir(), 'open-mercato-email-capture.jsonl')

async function postedInvoiceFor(request: APIRequestContext, token: string, invoiceEmail: string) {
  const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Send ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleDay: '1',
      invoiceEmail,
      nextBillDate: '2026-10-01',
      invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(account.ok(), `POST account status was ${account.status()}`).toBeTruthy()
  const accountId = ((await account.json()) as { id: string }).id
  const item = await apiRequest(request, 'POST', '/api/billing/items', {
    token,
    data: { billAccountId: accountId, type: 'recurring', billStartDate: '2026-10-01', description: 'Plan', rateJson: { unit_price: 50 } },
  })
  expect(item.ok()).toBeTruthy()
  const run = await apiRequest(request, 'POST', '/api/billing/runs', {
    token,
    data: { mode: 'real', asOfDate: '2026-10-15', scopedAccountIds: [accountId] },
  })
  expect(run.ok()).toBeTruthy()
  const list = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=false`, { token })
  const [draft] = ((await list.json()) as { items: Array<{ id: string }> }).items
  return { accountId, invoiceId: draft.id }
}

test.describe('TC-BILL-008: send invoice by email', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    await ensureSellerSettings(request, token)
  })

  test('draft refused; posted invoice sent and logged', async ({ request }) => {
    const email = `send-${uniq()}@example.com`
    const { invoiceId } = await postedInvoiceFor(request, token, email)

    const early = await apiRequest(request, 'POST', `/api/billing/invoices/${invoiceId}/send`, { token, data: {} })
    expect(early.status()).toBe(409)

    const post = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId } })
    expect(post.ok()).toBeTruthy()
    const { invoiceNumber } = (await post.json()) as { invoiceNumber: string }

    const send = await apiRequest(request, 'POST', `/api/billing/invoices/${invoiceId}/send`, { token, data: {} })
    expect(send.status()).toBe(200)
    const result = (await send.json()) as { to: string; status: 'sent' | 'failed' }
    expect(result.to).toBe(email)
    expect(['sent', 'failed']).toContain(result.status)

    const detail = await apiRequest(request, 'GET', `/api/billing/invoices/${invoiceId}`, { token })
    const { invoice } = (await detail.json()) as {
      invoice: { metadata: { deliveries?: Array<{ to: string; status: string; trigger: string }> } }
    }
    expect(invoice.metadata.deliveries).toEqual([expect.objectContaining({ to: email, trigger: 'manual', status: result.status })])

    if (existsSync(capturePath)) {
      const captured = readFileSync(capturePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { to: string; subject: string })
      expect(captured.some((m) => m.to === email && m.subject.includes(invoiceNumber))).toBe(true)
    }
  })

  test('placeholder address is refused with 422', async ({ request }) => {
    const { invoiceId } = await postedInvoiceFor(request, token, `shell-${uniq()}@invalid.local`)
    const post = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId } })
    expect(post.ok()).toBeTruthy()
    const send = await apiRequest(request, 'POST', `/api/billing/invoices/${invoiceId}/send`, { token, data: {} })
    expect(send.status()).toBe(422)
    expect(((await send.json()) as { code: string }).code).toBe('billing.invoice.email_invalid')
  })
})
