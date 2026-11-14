import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-BILL-004: B2C billing accounts, invoice-language picklist, return-to-account navigation
 * Category: BILL — API + UI
 * Priority: High
 * Spec: .ai/specs/2026-11-14-billing-account-workspace.md (Phase 1, D21–D23)
 *
 * Self-contained: creates its own person, account and item; removes them
 * in teardown. Avoids `GET /api/billing/accounts?id=` (known CI flake, see
 * TC-BILL-001) — reads back through the `customerKind` + `search` filters.
 */

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function accountPayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: `cust-${uniq()}`,
    name: `B2C Account ${uniq()}`,
    currencyCode: 'PLN',
    billCycle: 'monthly',
    billCycleAnchor: '1',
    invoiceEmail: `inv-${uniq()}@example.com`,
    invoiceLanguage: 'pl',
    nextBillDate: '2026-12-01',
    invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
    ...overrides,
  }
}

async function createAccount(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/billing/accounts', { token, data })
  expect(res.ok(), `POST /api/billing/accounts status was ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { id?: string }
  expect(body.id).toBeTruthy()
  return body.id as string
}

async function createItem(request: APIRequestContext, token: string, billAccountId: string): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/billing/items', {
    token,
    data: {
      billAccountId,
      type: 'recurring',
      billStartDate: '2026-12-01',
      description: `Internet 300 ${uniq()}`,
      rateJson: { unit_price: 79 },
    },
  })
  expect(res.ok(), `POST /api/billing/items status was ${res.status()}`).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

test.describe('TC-BILL-004: B2C accounts + navigation', () => {
  let token: string
  const accountIds: string[] = []
  const itemIds: string[] = []
  const personIds: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test.afterEach(async ({ request }) => {
    while (itemIds.length) {
      await apiRequest(request, 'DELETE', '/api/billing/items', { token, data: { id: itemIds.pop() } })
    }
    while (accountIds.length) {
      await apiRequest(request, 'DELETE', '/api/billing/accounts', { token, data: { id: accountIds.pop() } })
    }
    while (personIds.length) {
      await deleteEntityIfExists(request, token, '/api/customers/people', personIds.pop() ?? null)
    }
  })

  test('creates a person (B2C) account and filters by customer kind', async ({ request }) => {
    const suffix = uniq()
    const personId = await createPersonFixture(request, token, {
      firstName: 'Jan',
      lastName: `Kowalski ${suffix}`,
      displayName: `Jan Kowalski ${suffix}`,
      primaryEmail: `jan-${suffix}@example.com`,
    })
    personIds.push(personId)
    const name = `B2C ${suffix}`
    accountIds.push(
      await createAccount(request, token, accountPayload({ customerId: personId, customerKind: 'person', name })),
    )

    const persons = await apiRequest(
      request,
      'GET',
      `/api/billing/accounts?customerKind=person&search=${encodeURIComponent(name)}`,
      { token },
    )
    const personRows = ((await persons.json()) as { items: Array<{ name: string; customer_kind: string }> }).items
    expect(personRows.find((row) => row.name === name)?.customer_kind).toBe('person')

    const companies = await apiRequest(
      request,
      'GET',
      `/api/billing/accounts?customerKind=company&search=${encodeURIComponent(name)}`,
      { token },
    )
    const companyRows = ((await companies.json()) as { items: Array<{ name: string }> }).items
    expect(companyRows.some((row) => row.name === name)).toBe(false)
  })

  test('defaults customer kind to company', async ({ request }) => {
    const name = `Company ${uniq()}`
    accountIds.push(await createAccount(request, token, accountPayload({ name })))
    const res = await apiRequest(
      request,
      'GET',
      `/api/billing/accounts?customerKind=company&search=${encodeURIComponent(name)}`,
      { token },
    )
    const rows = ((await res.json()) as { items: Array<{ name: string; customer_kind: string }> }).items
    expect(rows.find((row) => row.name === name)?.customer_kind).toBe('company')
  })

  test('rejects an invoice language the template does not support', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/billing/accounts', {
      token,
      data: accountPayload({ invoiceLanguage: 'de' }),
    })
    expect(res.status()).toBe(400)
  })

  test('item pages return to the owning account; from the items list they return to the list', async ({
    page,
    request,
  }) => {
    const accountId = await createAccount(request, token, accountPayload())
    accountIds.push(accountId)
    const itemId = await createItem(request, token, accountId)
    itemIds.push(itemId)

    await login(page, 'admin')

    // FormHeader's back link is the anchor rendering the "←" glyph. (The
    // detail body also links to the account, so match the header link only.)
    const backLink = page.locator('a', { hasText: '←' }).first()

    // Opened in account context → back goes to the account.
    await page.goto(`/backend/billing/items/${itemId}`, { waitUntil: 'domcontentloaded' })
    await expect(backLink).toHaveAttribute('href', `/backend/billing/accounts/${accountId}`)

    // Opened from the global Items list → back goes to the list.
    await page.goto(`/backend/billing/items/${itemId}?from=items`, { waitUntil: 'domcontentloaded' })
    await expect(backLink).toHaveAttribute('href', '/backend/billing/items')

    // "Add item" from an account → Cancel returns to that account.
    await page.goto(`/backend/billing/items/create?billAccountId=${accountId}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: /cancel/i }).first().click()
    await expect(page).toHaveURL(new RegExp(`/backend/billing/accounts/${accountId}$`))
  })
})
