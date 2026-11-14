import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCustomer, hideFloatingOverlays, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-COST-ORDER-001 — cost-plus costs carried to orders and subscriptions
 * (feature spec 2026-11-12-cpq-cost-plus-order-subscription-costs, App Spec WF5 / WF6)
 *
 * Every fixture is created through the API by this test (company, specifications, offerings, cost-plus
 * charges, cost elements, a role and a user without `cpq.costs.view`); nothing relies on demo data. The
 * tenant toggle `cpq.cost_plus` is switched on for the test and restored afterwards.
 *
 * Flow: a quote with a subscription line (MRC cost-plus) and a server line (assetizable, NRC cost-plus with
 * two costs) → convert → the order shows its line costs → activate → the subscription shows the item cost
 * and the server's asset costs, and the `created` Change History entry lists them → Cancel quote → convert →
 * activate → every cost is ended. A user without `cpq.costs.view` only ever sees status chips.
 */

type Json = Record<string, unknown>
type CostRow = { id: string; name: string; valueStatus: string; status?: string; totalAmount?: string | null }
type OrderCosts = { currencyCode?: string; lines: Array<{ orderLineId: string; costs: CostRow[] }> }
type SubscriptionCosts = {
  currencyCode?: string
  items: Array<{ subscriptionItemId: string; costs: CostRow[] }>
  assets: Array<{ assetId: string; costs: CostRow[] }>
}
type ChangeLogEntry = { id: string; changeType: string; afterSnapshot: { items?: Array<{ costs?: CostRow[] }>; assets?: Array<{ costs?: CostRow[] }> } | null }

const TOGGLE = 'cpq.cost_plus'
const PASSWORD = 'Valid1!Pass'

async function json<T = Json>(res: { ok: () => boolean; status: () => number; json: () => Promise<unknown>; text: () => Promise<string> }, what: string): Promise<T> {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBeTruthy()
  return (await res.json()) as T
}

async function post<T = Json>(request: APIRequestContext, token: string, path: string, data: unknown, what: string): Promise<T> {
  return json<T>(await apiRequest(request, 'POST', path, { token, data }), what)
}

async function setCostPlusToggle(request: APIRequestContext, token: string, on: boolean): Promise<boolean> {
  const list = await json<{ items?: Array<{ id: string; identifier: string }> }>(
    await apiRequest(request, 'GET', `/api/feature_toggles/global?identifier=${TOGGLE}&pageSize=10`, { token }),
    'toggle lookup',
  )
  const toggle = list.items?.find((item) => item.identifier === TOGGLE)
  expect(toggle, `feature toggle ${TOGGLE} must be registered (yarn mercato cpq seed-cost-plus)`).toBeTruthy()
  const res = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token,
    data: on ? { toggleId: toggle!.id, isOverride: true, overrideValue: true } : { toggleId: toggle!.id, isOverride: false },
  })
  expect(res.ok(), `toggle override returned ${res.status()}: ${await res.text()}`).toBeTruthy()
  return true
}

/** A costed offering: an offering with one cost-plus charge whose cost elements are fixed amounts. */
async function seedCostedOffering(
  request: APIRequestContext,
  token: string,
  input: { label: string; assetizable: boolean; chargeType: 'mrc' | 'nrc'; costs: Array<{ code: string; name: string; role: 'price_basis' | 'margin_only'; amount: number }> },
  cleanup: Array<() => Promise<void>>,
): Promise<{ offeringId: string; specId: string }> {
  const code = `${input.label}-${uniq()}`
  const spec = await post<{ id: string }>(request, token, '/api/cpq/product-specifications', {
    code, name: `${input.label} spec`, lifecycleStatus: 'active', isAssetizable: input.assetizable,
  }, 'spec')
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.id } }).then(() => undefined))
  const offering = await post<{ id: string }>(request, token, '/api/cpq/product-offerings', {
    specId: spec.id, code: `${code}-O`, name: `${input.label} offering ${code}`, lifecycleStatus: 'active',
  }, 'offering')
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.id } }).then(() => undefined))

  // A cost-plus charge is created inactive, given its cost elements, then activated (it needs a price basis).
  const charge = await post<{ id: string }>(request, token, '/api/cpq/product-charges', {
    offeringId: offering.id, code: `${code}-C`, name: `${input.label} charge`, chargeType: input.chargeType, chargeModel: 'flat',
    pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25, currencyCode: 'USD', isActive: false,
  }, 'charge')
  for (const cost of input.costs) {
    await post(request, token, '/api/cpq/charge-cost-elements', {
      productChargeId: charge.id, code: `${cost.code}-${uniq()}`, name: cost.name, role: cost.role, costType: input.chargeType,
      source: 'fixed', costModel: 'flat', amount: cost.amount, currencyCode: 'USD',
    }, `cost element ${cost.name}`)
  }
  const activated = await apiRequest(request, 'PUT', '/api/cpq/product-charges', { token, data: { id: charge.id, isActive: true } })
  expect(activated.ok(), `charge activation returned ${activated.status()}: ${await activated.text()}`).toBeTruthy()
  return { offeringId: offering.id, specId: spec.id }
}

/** Walks a quote from wherever recalculation left it to `accepted` (same ladder as TC-CPQ-ARC-012). */
async function acceptQuote(request: APIRequestContext, token: string, quoteId: string): Promise<void> {
  const quote = await json<{ cpqStatus: string }>(await apiRequest(request, 'GET', `/api/cpq/quotes/${quoteId}`, { token }), 'quote read')
  const ladder = ['ready', 'in_approval', 'approved', 'with_customer', 'accepted']
  for (const targetStatus of ladder.slice(ladder.indexOf(quote.cpqStatus) + 1)) {
    const res = await apiRequest(request, 'POST', `/api/cpq/quotes/${quoteId}/status`, { token, data: { targetStatus } })
    expect(res.ok(), `transition to ${targetStatus} returned ${res.status()}: ${await res.text()}`).toBeTruthy()
  }
}

async function convertAndActivate(request: APIRequestContext, token: string, quoteId: string): Promise<string> {
  await acceptQuote(request, token, quoteId)
  const order = await post<{ id: string }>(request, token, '/api/cpq/orders', { quoteId }, 'convert')
  await post(request, token, `/api/cpq/orders/${order.id}/activate`, undefined, 'activate')
  return order.id
}

async function getJson<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  return json<T>(await apiRequest(request, 'GET', path, { token }), `GET ${path}`)
}

/** Browser session for an arbitrary user (the shared `login` helper only knows the default roles). */
async function loginAs(page: Page, email: string): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email, password: PASSWORD }).toString(),
  })
  expect(res.ok(), `login of ${email} returned ${res.status()}`).toBeTruthy()
}

test.describe('TC-CPQ-COST-ORDER-001 — order and subscription costs', () => {
  test('convert → order costs → activate → item and asset costs + created history → cancel ends every cost; restricted user sees chips only', async ({ page, request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)
    const cleanup: Array<() => Promise<void>> = []
    const customerId = await seedCustomer(request, token, `COST-ORDER-Co-${uniq()}`)
    let roleId: string | null = null
    let userId: string | null = null

    try {
      await setCostPlusToggle(request, token, true)

      // 1. Catalog: a subscription offering (MRC, one cost) and a server (assetizable, NRC, two costs).
      const line = await seedCostedOffering(request, token, {
        label: 'Transport', assetizable: false, chargeType: 'mrc', costs: [{ code: 'tail', name: 'Tail circuit', role: 'price_basis', amount: 400 }],
      }, cleanup)
      const server = await seedCostedOffering(request, token, {
        label: 'Server', assetizable: true, chargeType: 'nrc',
        costs: [
          { code: 'hw', name: 'Server hardware', role: 'price_basis', amount: 2000 },
          { code: 'rack', name: 'Rack installation', role: 'margin_only', amount: 150 },
        ],
      }, cleanup)

      // 2. Quote with both lines; fixed costs are confirmed, so the quote can go all the way.
      const quote = await post<{ id: string }>(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'USD' }, 'quote')
      await post(request, token, `/api/cpq/quotes/${quote.id}/items`, { offeringId: line.offeringId, configuration: {}, quantity: 1, action: 'add' }, 'add subscription line')
      await post(request, token, `/api/cpq/quotes/${quote.id}/items`, { offeringId: server.offeringId, configuration: {}, quantity: 1, action: 'add' }, 'add server line')
      await post(request, token, `/api/cpq/quotes/${quote.id}/recalculate`, { save: true }, 'recalculate')
      const quoteCosts = await getJson<{ lines: Array<{ costs: CostRow[] }> }>(request, token, `/api/cpq/quotes/${quote.id}/costs`)
      expect(quoteCosts.lines.flatMap((l) => l.costs).map((c) => c.name).sort()).toEqual(['Rack installation', 'Server hardware', 'Tail circuit'])

      // 3. Convert: the order carries a copy of every quote cost line.
      await acceptQuote(request, token, quote.id)
      const order = await post<{ id: string }>(request, token, '/api/cpq/orders', { quoteId: quote.id }, 'convert')
      const orderCosts = await getJson<OrderCosts>(request, token, `/api/cpq/orders/${order.id}/costs`)
      const orderCostNames = orderCosts.lines.flatMap((l) => l.costs).map((c) => c.name).sort()
      expect(orderCostNames).toEqual(['Rack installation', 'Server hardware', 'Tail circuit'])
      expect(orderCosts.lines.flatMap((l) => l.costs).every((c) => c.totalAmount != null)).toBe(true)

      await login(page, 'admin')
      await page.goto(`/backend/cpq/orders/${order.id}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      const orderSection = page.getByTestId('cpq-order-costs')
      await expect(orderSection).toBeVisible({ timeout: 20_000 })
      await expect(orderSection).toContainText('Tail circuit')
      await expect(orderSection).toContainText('Server hardware')
      await expect(orderSection).toContainText('Rack installation')

      // 4. Activate: one inventory cost per order line cost, owned by the item or the server asset.
      await post(request, token, `/api/cpq/orders/${order.id}/activate`, undefined, 'activate')
      const subs = await getJson<{ items: Array<{ id: string }> }>(request, token, `/api/cpq/inventory/subscriptions?customerId=${customerId}`)
      expect(subs.items).toHaveLength(1)
      const subId = subs.items[0].id
      const costs = await getJson<SubscriptionCosts>(request, token, `/api/cpq/inventory/subscriptions/${subId}/costs`)
      expect(costs.items.flatMap((i) => i.costs).map((c) => c.name)).toEqual(['Tail circuit'])
      expect(costs.assets).toHaveLength(1)
      expect(costs.assets[0].costs.map((c) => c.name).sort()).toEqual(['Rack installation', 'Server hardware'])
      expect([...costs.items, ...costs.assets].flatMap((o) => o.costs).every((c) => c.status === 'active')).toBe(true)

      // 5. Subscription page: Costs section with the server's asset costs; Change History `created` entry lists the costs.
      await page.goto(`/backend/cpq/inventory/subscriptions/${subId}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      const costsSection = page.getByTestId('cpq-subscription-costs')
      await expect(costsSection).toBeVisible({ timeout: 20_000 })
      await expect(costsSection.getByTestId('cpq-asset-costs')).toContainText('Server hardware')
      await expect(costsSection.getByTestId('cpq-asset-costs')).toContainText('Rack installation')
      const created = page.getByTestId('cpq-change-log-costs').first()
      await expect(created).toBeVisible({ timeout: 20_000 })
      await expect(created).toContainText('Tail circuit')
      await expect(created).toContainText('Server hardware')
      await expect(created).toContainText('added')

      const log = await getJson<{ items: ChangeLogEntry[] }>(request, token, `/api/cpq/inventory/subscriptions/${subId}/change-log?pageSize=50`)
      const createdEntry = log.items.find((entry) => entry.changeType === 'created')
      expect(createdEntry?.afterSnapshot?.items?.flatMap((i) => i.costs ?? []).map((c) => c.name)).toEqual(['Tail circuit'])
      expect(createdEntry?.afterSnapshot?.assets?.flatMap((a) => a.costs ?? []).length).toBe(2)

      // 6. A user without cpq.costs.view: status-only projection, no amounts, no cost diff in the history.
      roleId = await createRoleFixture(request, token, { name: `cpq-no-costs-${uniq()}` })
      await setRoleAclFeatures(request, token, {
        roleId, features: ['cpq.quotes.view', 'cpq.orders.view', 'cpq.inventory.view', 'cpq.arc.changelog.view'],
      })
      const email = `cpq-no-costs-${uniq()}@example.com`
      userId = await createUserFixture(request, token, { email, password: PASSWORD, organizationId, roles: [roleId] })
      const limitedToken = await getAuthToken(request, email, PASSWORD)
      const limitedCosts = await getJson<SubscriptionCosts>(request, limitedToken, `/api/cpq/inventory/subscriptions/${subId}/costs`)
      expect(limitedCosts.currencyCode).toBeUndefined()
      const limitedRows = [...limitedCosts.items, ...limitedCosts.assets].flatMap((o) => o.costs)
      expect(limitedRows).toHaveLength(3)
      for (const row of limitedRows) {
        expect(row.valueStatus).toBeTruthy()
        expect(row).not.toHaveProperty('totalAmount')
        expect(row).not.toHaveProperty('unitAmount')
      }
      const limitedOrder = await getJson<OrderCosts>(request, limitedToken, `/api/cpq/orders/${order.id}/costs`)
      expect(limitedOrder.currencyCode).toBeUndefined()
      const limitedLog = await getJson<{ items: ChangeLogEntry[] }>(request, limitedToken, `/api/cpq/inventory/subscriptions/${subId}/change-log?pageSize=50`)
      expect(JSON.stringify(limitedLog)).not.toContain('"costs"')

      await loginAs(page, email)
      await page.goto(`/backend/cpq/inventory/subscriptions/${subId}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      await expect(page.getByTestId('cpq-subscription-costs')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('cpq-cost-value')).toHaveCount(0)
      await expect(page.getByTestId('cpq-subscription-margin')).toHaveCount(0)
      await expect(page.getByTestId('cpq-change-log-costs')).toHaveCount(0)

      // 7. Cancel: a cancel quote, converted and activated, ends every cost (history kept, nothing open).
      // A freshly activated subscription is `pending`; ARC (Cancel) needs it `active` (as the ARC fixtures do).
      await post(request, token, '/api/cpq/inventory/subscriptions/status', { id: subId, targetStatus: 'active' }, 'subscription → active')
      const cancelQuote = await post<{ id: string }>(request, token, '/api/cpq/quotes/from-subscription', { subscriptionId: subId, type: 'cancel' }, 'cancel quote')
      await post(request, token, `/api/cpq/quotes/${cancelQuote.id}/cancel-meta`, { reasonCode: 'non-payment' }, 'cancel meta')
      await convertAndActivate(request, token, cancelQuote.id)

      const open = await getJson<SubscriptionCosts>(request, token, `/api/cpq/inventory/subscriptions/${subId}/costs`)
      expect([...open.items, ...open.assets].flatMap((o) => o.costs)).toHaveLength(0)
      const all = await getJson<SubscriptionCosts>(request, token, `/api/cpq/inventory/subscriptions/${subId}/costs?includeEnded=true`)
      const allRows = [...all.items, ...all.assets].flatMap((o) => o.costs)
      expect(allRows).toHaveLength(3)
      expect(allRows.every((c) => c.status === 'ended')).toBe(true)

      await login(page, 'admin')
      await page.goto(`/backend/cpq/inventory/subscriptions/${subId}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      await expect(page.getByTestId('cpq-change-log-costs').filter({ hasText: 'ended' }).first()).toBeVisible({ timeout: 20_000 })
    } finally {
      await deleteUserIfExists(request, token, userId).catch(() => undefined)
      await deleteRoleIfExists(request, token, roleId).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
      for (const f of cleanup.reverse()) await f().catch(() => undefined)
      await setCostPlusToggle(request, token, false).catch(() => undefined)
    }
  })
})
