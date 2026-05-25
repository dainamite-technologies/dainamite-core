import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-BILL-003: Billing admin UI — accounts list + detail
 * Category: BILL — UI
 * Priority: High
 *
 * Verifies the admin pages actually render against live data:
 *  - the list table populates non-name columns (regression guard for
 *    the snake_case API vs camelCase page mismatch);
 *  - the detail page renders the entity name through `FormHeader`;
 *  - the Polish locale dictionary loads.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function createAccount(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/billing/accounts', {
    token,
    data: {
      customerId: `cust-${uniq()}`,
      name,
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

test.describe('TC-BILL-003: Billing admin UI (accounts)', () => {
  let token: string
  let accountId: string
  let accountName: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    accountName = `UI Test Account ${uniq()}`
    accountId = await createAccount(request, token, accountName)
  })

  test.afterAll(async ({ request }) => {
    if (accountId) {
      await apiRequest(request, 'DELETE', '/api/billing/accounts', {
        token,
        data: { id: accountId },
      })
    }
  })

  test('accounts list renders the row with populated columns', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/billing/accounts', { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByRole('heading', { name: /Billing Accounts/i }).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: /New account/i })).toBeVisible({
      timeout: 15_000,
    })

    const row = page.locator('tr', { hasText: accountName }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    // The currency column only fills if the page reads the API's
    // snake_case `currency_code` key — a blank cell here means the
    // list is reading the wrong key.
    await expect(row).toContainText('PLN')
  })

  test('account detail page shows the entity name in the FormHeader', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(`/backend/billing/accounts/${accountId}`, {
      waitUntil: 'domcontentloaded',
    })

    // FormHeader detail mode renders the entity name as the <h1>.
    await expect(
      page.getByRole('heading', { level: 1, name: accountName }),
    ).toBeVisible({ timeout: 15_000 })
    // Detail page opens read-only with an Edit gate (commit 4dbb61a):
    // the Edit button is the proof that the detail read path resolved
    // a record (not stuck on Loading / Account not found).
    const editButton = page.getByRole('button', { name: /^Edit$/i })
    await expect(editButton).toBeVisible({ timeout: 15_000 })
    // Click into edit mode → Save changes appears, confirming the form
    // hydrated with the loaded record.
    await editButton.click()
    await expect(
      page.getByRole('button', { name: /Save changes/i }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('renders Polish copy when the locale cookie is set', async ({ page }) => {
    await login(page, 'admin')
    await page.context().addCookies([
      { name: 'locale', value: 'pl', url: BASE },
    ])
    await page.goto('/backend/billing/accounts', { waitUntil: 'domcontentloaded' })

    // pl.json: billing.accounts.title → "Konta rozliczeniowe".
    await expect(
      page.getByRole('heading', { name: /Konta rozliczeniowe/i }).first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})
