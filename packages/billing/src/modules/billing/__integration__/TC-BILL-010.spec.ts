import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { ensureSellerSettings } from './sellerSettings'

/**
 * TC-BILL-010: Credit and debit memos (Spec D)
 * Category: BILL — API
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-credit-debit-memos.md
 *
 *   1. Post an invoice (100 net, 0 % VAT for simple maths).
 *   2. Partial credit memo (30) → draft `DRAFT-…` → post → `CN/…` number,
 *      original partially paid with 70 outstanding, memo settled.
 *   3. A second credit of 80 is refused at creation (exceeds 100 − 30).
 *   4. Debit memo (+15) → post → invoice-series number, own due date and
 *      outstanding; the original lists both corrections.
 *
 * Self-contained (own account + item). Posted documents stay (no void).
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

type Doc = { id: string; number: string; status: string; outstanding: string; total_gross: string; due_date: string | null }

async function postedInvoice(request: APIRequestContext, token: string): Promise<{ invoice: Doc; lineId: string }> {
  const account = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name: `Memos ${uniq()}`,
      currencyCode: 'PLN',
      billCycle: 'monthly',
      billCycleDay: '1',
      invoiceEmail: `memo-${uniq()}@example.com`,
      nextBillDate: '2026-10-01',
      invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    },
  })
  expect(account.ok()).toBeTruthy()
  const accountId = ((await account.json()) as { id: string }).id
  const item = await apiRequest(request, 'POST', '/api/billing/items', {
    token,
    data: { billAccountId: accountId, type: 'recurring', billStartDate: '2026-10-01', description: 'Plan', rateJson: { unit_price: 100 }, taxRate: 0 },
  })
  expect(item.ok()).toBeTruthy()
  const run = await apiRequest(request, 'POST', '/api/billing/runs', { token, data: { mode: 'real', asOfDate: '2026-10-15', scopedAccountIds: [accountId] } })
  expect(run.ok()).toBeTruthy()
  const list = await apiRequest(request, 'GET', `/api/billing/invoices?billAccountId=${accountId}&testRun=false`, { token })
  const [draft] = ((await list.json()) as { items: Doc[] }).items
  const post = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: draft.id } })
  expect(post.ok()).toBeTruthy()
  const detail = (await (await apiRequest(request, 'GET', `/api/billing/invoices/${draft.id}`, { token })).json()) as {
    invoice: Doc
    lines: Array<{ id: string }>
  }
  return { invoice: detail.invoice, lineId: detail.lines[0].id }
}

async function getDoc(request: APIRequestContext, token: string, id: string) {
  return (await (await apiRequest(request, 'GET', `/api/billing/invoices/${id}`, { token })).json()) as {
    invoice: Doc
    corrections: Array<{ id: string; document_type: string }>
  }
}

test.describe('TC-BILL-010: credit and debit memos', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    await ensureSellerSettings(request, token)
  })

  test('credit memo settles the original; over-credit refused; debit memo is payable', async ({ request }) => {
    const { invoice, lineId } = await postedInvoice(request, token)

    const credit = await apiRequest(request, 'POST', `/api/billing/invoices/${invoice.id}/memos`, {
      token,
      data: { type: 'credit_memo', reason: 'Goodwill', lines: [{ correctsLineId: lineId, description: 'Plan (part)', quantity: 1, unitPriceNet: 30 }] },
    })
    expect(credit.ok(), `create memo status ${credit.status()}`).toBeTruthy()
    const { memoId, number } = (await credit.json()) as { memoId: string; number: string }
    expect(number).toMatch(/^DRAFT-/)

    const postMemo = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: memoId } })
    expect(postMemo.ok(), `post memo status ${postMemo.status()}`).toBeTruthy()
    expect(((await postMemo.json()) as { invoiceNumber: string }).invoiceNumber).toMatch(/^CN\//)

    const afterCredit = await getDoc(request, token, invoice.id)
    expect(afterCredit.invoice.status).toBe('partially_paid')
    expect(Number(afterCredit.invoice.outstanding)).toBeCloseTo(70, 2)
    expect((await getDoc(request, token, memoId)).invoice).toMatchObject({ status: 'paid' })

    const tooMuch = await apiRequest(request, 'POST', `/api/billing/invoices/${invoice.id}/memos`, {
      token,
      data: { type: 'credit_memo', reason: 'Too much', lines: [{ correctsLineId: lineId, description: 'Plan', quantity: 1, unitPriceNet: 80 }] },
    })
    expect(tooMuch.status()).toBe(409)
    expect(((await tooMuch.json()) as { code: string }).code).toBe('billing.memo.exceeds_invoice')

    const debit = await apiRequest(request, 'POST', `/api/billing/invoices/${invoice.id}/memos`, {
      token,
      data: { type: 'debit_memo', reason: 'Missed fee', lines: [{ description: 'Installation', quantity: 1, unitPriceNet: 15, taxRate: 0 }] },
    })
    expect(debit.ok()).toBeTruthy()
    const debitId = ((await debit.json()) as { memoId: string }).memoId
    const postDebit = await apiRequest(request, 'POST', '/api/billing/invoices/post', { token, data: { invoiceId: debitId } })
    expect(postDebit.ok()).toBeTruthy()
    expect(((await postDebit.json()) as { invoiceNumber: string }).invoiceNumber).toMatch(/^INV\//)
    const debitDoc = (await getDoc(request, token, debitId)).invoice
    expect(debitDoc.status).toBe('posted')
    expect(debitDoc.due_date).toBeTruthy()
    expect(Number(debitDoc.outstanding)).toBeCloseTo(15, 2)

    const corrections = (await getDoc(request, token, invoice.id)).corrections.map((c) => c.document_type).sort()
    expect(corrections).toEqual(['credit_memo', 'debit_memo'])
  })
})
