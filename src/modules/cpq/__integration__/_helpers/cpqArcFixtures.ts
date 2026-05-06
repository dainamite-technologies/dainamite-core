import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * XD-250 ARC integration test fixtures.
 *
 * Test setup helpers (subscription / customer creation) go through the
 * CPQ inventory + customers REST APIs because building a real subscription
 * end-to-end via the new-sale UI flow per test would be enormous. The
 * actual ARC behaviour under test still drives the UI (drawer, status
 * transitions, change history) — only the *prerequisite state* is API.
 */

export const uniq = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export interface SeededSubscription {
  id: string
  customerId: string
  code: string
  name: string
  currencyCode: string
  billingCycle: string
  mrcAmount: string
  currentTermEnd: string | null
}

export interface SeedSubscriptionInput {
  customerId: string
  name?: string
  code?: string
  billingCycle?: 'monthly' | 'quarterly' | 'annually'
  currencyCode?: string
  mrcAmount?: number
  /** ISO date — sets currentTermEnd via PUT after creation. */
  currentTermEnd?: string
  termMonths?: number
  /** Pre-seed at least one item; subscription schema requires items.min(1). */
  items?: Array<{
    name: string
    mrcAmount?: number
    nrcAmount?: number
  }>
}

/**
 * Creates a customer (company) and returns its id.
 */
export async function seedCustomer(
  request: APIRequestContext,
  token: string,
  displayName?: string,
): Promise<string> {
  return createCompanyFixture(request, token, displayName ?? `ARC-Test-Co-${uniq()}`)
}

/**
 * Creates a subscription, transitions it to active, optionally sets the
 * current term end (used by Expiring view test). Returns enough metadata
 * for the test to navigate by id and assert by code.
 */
export async function seedActiveSubscription(
  request: APIRequestContext,
  token: string,
  input: SeedSubscriptionInput,
): Promise<SeededSubscription> {
  const code = input.code ?? `SUB-${uniq().toUpperCase()}`
  const name = input.name ?? `ARC Test Subscription ${uniq()}`
  const items = input.items ?? [{ name: 'Default Item', mrcAmount: input.mrcAmount ?? 100 }]

  const createRes = await apiRequest(request, 'POST', '/api/cpq/inventory/subscriptions', {
    token,
    data: {
      customerId: input.customerId,
      code,
      name,
      billingCycle: input.billingCycle ?? 'monthly',
      currencyCode: input.currencyCode ?? 'USD',
      termMonths: input.termMonths ?? 12,
      items,
    },
  })
  expect(
    createRes.ok(),
    `subscription POST returned ${createRes.status()}: ${await createRes.text()}`,
  ).toBeTruthy()
  const created = (await createRes.json()) as { id: string; code: string; name: string; currencyCode: string; billingCycle: string; mrcAmount: string }

  // Pending → active.
  const transitionRes = await apiRequest(
    request,
    'POST',
    '/api/cpq/inventory/subscriptions/status',
    {
      token,
      data: { id: created.id, targetStatus: 'active' },
    },
  )
  expect(
    transitionRes.ok(),
    `status transition returned ${transitionRes.status()}: ${await transitionRes.text()}`,
  ).toBeTruthy()

  // Optional: stamp currentTermEnd via PUT for the Expiring view test.
  if (input.currentTermEnd) {
    const updateRes = await apiRequest(request, 'PUT', '/api/cpq/inventory/subscriptions', {
      token,
      data: { id: created.id, currentTermEnd: input.currentTermEnd },
    })
    expect(
      updateRes.ok(),
      `subscription PUT returned ${updateRes.status()}: ${await updateRes.text()}`,
    ).toBeTruthy()
  }

  return {
    id: created.id,
    customerId: input.customerId,
    code: created.code,
    name: created.name,
    currencyCode: created.currencyCode,
    billingCycle: created.billingCycle,
    mrcAmount: created.mrcAmount,
    currentTermEnd: input.currentTermEnd ?? null,
  }
}

/**
 * Cleanup: soft-delete created subscriptions, swallow errors so teardown
 * never aborts subsequent cleanup.
 */
export async function deleteSubscription(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', '/api/cpq/inventory/subscriptions', {
    token,
    data: { id },
  }).catch(() => undefined)
}

export async function deleteCustomer(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', '/api/customers/companies', {
    token,
    data: { id },
  }).catch(() => undefined)
}

/**
 * Compute an ISO date `daysFromNow` days into the future. Used by the
 * Expiring view test to build subscriptions with predictable term-end dates.
 */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

/**
 * Hide globally floating widgets (Feedback FAB, Next.js dev toolbar) so they
 * don't intercept clicks on drawer / page buttons. Safe to call multiple times.
 */
export async function hideFloatingOverlays(page: Page): Promise<void> {
  await page
    .addStyleTag({
      content: `
        button[aria-label="Open feedback form"],
        nextjs-portal,
        [data-nextjs-toast-wrapper] {
          display: none !important;
        }
      `,
    })
    .catch(() => undefined)
}
