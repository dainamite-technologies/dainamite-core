import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { deleteCustomer, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-COST-ARC-001 — a cost-only Amend renegotiates a live subscription's cost in place
 * (feature spec 2026-11-12-cpq-cost-plus-arc-costs, App Spec WF6 / R13 / I-9)
 *
 * Every fixture is created through the API by this test (company, specification, offering, cost-plus charge, one
 * fixed cost element at 270); nothing relies on demo data. The tenant toggle `cpq.cost_plus` is switched on for
 * the test and restored afterwards.
 *
 * Flow: quote → convert → activate → the subscription holds one item cost (270) and is moved to `active` (ARC needs
 * it; a freshly activated subscription is `pending`) → Amend from the subscription: the mirror line carries the item
 * cost (`carried`) → the carried cost is edited to 240 with a note (the line is frozen, so the price is untouched)
 * → the Amend quote is accepted → converted → activated → the item cost keeps its id and now holds 240, and the
 * Change History `amend` entry shows 270 → 240 in its before / after snapshots.
 */

type Json = Record<string, unknown>
type CostRow = { id: string; name: string; carried?: boolean; unitAmount?: string | number | null; totalAmount?: string | null; status?: string }
type SubscriptionCosts = { items: Array<{ subscriptionItemId: string; costs: CostRow[] }> }
type Snapshot = { items?: Array<{ costs?: CostRow[] }> } | null
type ChangeLogEntry = { id: string; changeType: string; beforeSnapshot: Snapshot; afterSnapshot: Snapshot }

const TOGGLE = 'cpq.cost_plus'

async function json<T = Json>(res: { ok: () => boolean; status: () => number; json: () => Promise<unknown>; text: () => Promise<string> }, what: string): Promise<T> {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBeTruthy()
  return (await res.json()) as T
}

async function post<T = Json>(request: APIRequestContext, token: string, path: string, data: unknown, what: string): Promise<T> {
  return json<T>(await apiRequest(request, 'POST', path, { token, data }), what)
}

async function getJson<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  return json<T>(await apiRequest(request, 'GET', path, { token }), `GET ${path}`)
}

async function setCostPlusToggle(request: APIRequestContext, token: string, on: boolean): Promise<void> {
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
}

/** Walks a quote from wherever recalculation left it to `accepted` (same ladder as TC-CPQ-ARC-012). */
async function acceptQuote(request: APIRequestContext, token: string, quoteId: string): Promise<void> {
  const quote = await getJson<{ cpqStatus: string }>(request, token, `/api/cpq/quotes/${quoteId}`)
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

const rounded = (value: string | number | null | undefined): number => Math.round(Number(value) * 100) / 100

test.describe('TC-CPQ-COST-ARC-001 — cost-only Amend', () => {
  test('Amend carries the item cost; edited 270 → 240 it is written back in place (same id) and Change History shows it', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const cleanup: Array<() => Promise<void>> = []
    const customerId = await seedCustomer(request, token, `COST-ARC-Co-${uniq()}`)

    try {
      await setCostPlusToggle(request, token, true)

      // 1. Catalog: an MRC cost-plus offering with one fixed price-basis cost element at 270.
      const code = `ArcCost-${uniq()}`
      const spec = await post<{ id: string }>(request, token, '/api/cpq/product-specifications', { code, name: `${code} spec`, lifecycleStatus: 'active' }, 'spec')
      cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.id } }).then(() => undefined))
      const offering = await post<{ id: string }>(request, token, '/api/cpq/product-offerings', { specId: spec.id, code: `${code}-O`, name: `${code} offering`, lifecycleStatus: 'active' }, 'offering')
      cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.id } }).then(() => undefined))
      // A cost-plus charge is created inactive, given its cost element, then activated (it needs a price basis).
      const charge = await post<{ id: string }>(request, token, '/api/cpq/product-charges', {
        offeringId: offering.id, code: `${code}-C`, name: `${code} charge`, chargeType: 'mrc', chargeModel: 'flat',
        pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25, currencyCode: 'USD', isActive: false,
      }, 'charge')
      await post(request, token, '/api/cpq/charge-cost-elements', {
        productChargeId: charge.id, code: `tail-${uniq()}`, name: 'Partner tail', role: 'price_basis', costType: 'mrc',
        source: 'fixed', costModel: 'flat', amount: 270, currencyCode: 'USD',
      }, 'cost element')
      const activated = await apiRequest(request, 'PUT', '/api/cpq/product-charges', { token, data: { id: charge.id, isActive: true } })
      expect(activated.ok(), `charge activation returned ${activated.status()}: ${await activated.text()}`).toBeTruthy()

      // 2. New sale: quote → convert → activate. The subscription holds one open item cost (270).
      const quote = await post<{ id: string }>(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'USD' }, 'quote')
      await post(request, token, `/api/cpq/quotes/${quote.id}/items`, { offeringId: offering.id, configuration: {}, quantity: 1, action: 'add' }, 'add line')
      await post(request, token, `/api/cpq/quotes/${quote.id}/recalculate`, { save: true }, 'recalculate')
      await convertAndActivate(request, token, quote.id)
      const subs = await getJson<{ items: Array<{ id: string }> }>(request, token, `/api/cpq/inventory/subscriptions?customerId=${customerId}`)
      expect(subs.items).toHaveLength(1)
      const subId = subs.items[0].id
      const before = await getJson<SubscriptionCosts>(request, token, `/api/cpq/inventory/subscriptions/${subId}/costs`)
      const itemCosts = before.items.flatMap((item) => item.costs)
      expect(itemCosts).toHaveLength(1)
      expect(rounded(itemCosts[0].totalAmount)).toBe(270)
      const itemCostId = itemCosts[0].id

      // 3. A freshly activated subscription is `pending`; ARC needs it `active` (as the ARC fixtures do).
      await post(request, token, '/api/cpq/inventory/subscriptions/status', { id: subId, targetStatus: 'active' }, 'subscription → active')

      // 4. Amend from the subscription: `from-subscription` answers `{ quoteId, cpqConfigId }`; the mirror line carries the cost.
      const amend = await post<{ quoteId: string; cpqConfigId: string }>(request, token, '/api/cpq/quotes/from-subscription', { subscriptionId: subId, type: 'amend' }, 'amend quote')
      expect(amend.quoteId, 'from-subscription returned no quoteId').toBeTruthy()
      const costsRead = await getJson<{ lines: Array<{ costs: CostRow[] }> }>(request, token, `/api/cpq/quotes/${amend.quoteId}/costs`)
      const carried = costsRead.lines.flatMap((line) => line.costs).filter((cost) => cost.carried === true)
      expect(carried, 'the Amend mirror line must carry the item cost').toHaveLength(1)
      expect(rounded(carried[0].unitAmount)).toBe(270)

      // 5. Renegotiate on the frozen line: 270 → 240 with a note (overwriting a carried value needs a reason).
      const edit = await apiRequest(request, 'PATCH', `/api/cpq/quotes/${amend.quoteId}/costs/${carried[0].id}`, {
        token, data: { unitAmount: 240, note: 'Renegotiated with the partner carrier' },
      })
      expect(edit.ok(), `carried cost edit returned ${edit.status()}: ${await edit.text()}`).toBeTruthy()
      const edited = await getJson<{ lines: Array<{ costs: CostRow[] }> }>(request, token, `/api/cpq/quotes/${amend.quoteId}/costs`)
      expect(rounded(edited.lines.flatMap((line) => line.costs).find((cost) => cost.id === carried[0].id)?.unitAmount)).toBe(240)

      // 6. Accepted → converted → activated: the cost-only Amend writes the cost back in place.
      await convertAndActivate(request, token, amend.quoteId)

      // 7. The item cost keeps its id and now holds 240 (no second cost row, nothing ended).
      const after = await getJson<SubscriptionCosts>(request, token, `/api/cpq/inventory/subscriptions/${subId}/costs`)
      const afterCosts = after.items.flatMap((item) => item.costs)
      expect(afterCosts).toHaveLength(1)
      expect(afterCosts[0].id).toBe(itemCostId)
      expect(rounded(afterCosts[0].totalAmount)).toBe(240)
      const everything = await getJson<SubscriptionCosts>(request, token, `/api/cpq/inventory/subscriptions/${subId}/costs?includeEnded=true`)
      expect(everything.items.flatMap((item) => item.costs)).toHaveLength(1)

      // 8. Change History: an `amend` entry whose before / after snapshots show 270 → 240 for the same cost id.
      const log = await getJson<{ items: ChangeLogEntry[] }>(request, token, `/api/cpq/inventory/subscriptions/${subId}/change-log?pageSize=50`)
      const amendEntry = log.items.find((entry) => entry.changeType === 'amend')
      expect(amendEntry, 'the change log must hold an amend entry').toBeTruthy()
      const beforeCost = amendEntry?.beforeSnapshot?.items?.flatMap((item) => item.costs ?? []).find((cost) => cost.id === itemCostId)
      const afterCost = amendEntry?.afterSnapshot?.items?.flatMap((item) => item.costs ?? []).find((cost) => cost.id === itemCostId)
      expect(rounded(beforeCost?.totalAmount)).toBe(270)
      expect(rounded(afterCost?.totalAmount)).toBe(240)
    } finally {
      await deleteCustomer(request, token, customerId).catch(() => undefined)
      for (const f of cleanup.reverse()) await f().catch(() => undefined)
      await setCostPlusToggle(request, token, false).catch(() => undefined)
    }
  })
})
