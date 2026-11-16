import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { seedCustomer, deleteCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-COST-INDEX-002 — index costs on quotes (feature spec 2026-11-12-cpq-cost-plus-index-costs-expiry, Phase B)
 *
 * Self-contained through the admin API token: the index, its values, the offering, the customer and the quote are
 * created by this test and removed at the end (an index is deleted only after its element is gone). The tenant toggle
 * `cpq.cost_plus` is switched on and restored. The index and the charge are both in EUR, so no exchange rate is needed.
 *
 * Flow: index + a value dated yesterday (80) -> a cost-plus offering whose only price-basis element is an `index`
 * element (factor 0.5, markup 25 %) -> a quote line, saved recalculation: snapshot 80 / r1, unit cost 40, list price
 * 50.00, `ready` -> the admin adds a value dated today (90) -> a saved recalculation re-prices (unit cost 45, price
 * 56.25, snapshot r1 of today) -> an unsaved recalculation (`save: false`) stores nothing -> the quote moves to
 * `with_customer` (cost lock) -> a correction for today (100, revision 2) -> a saved recalculation leaves snapshot,
 * unit cost and price unchanged (frozen). The Costs panel renders only inside an expanded quote line, so the
 * assertions are on the API.
 */

type Json = Record<string, unknown>
type Snapshot = { indexId: string; effectiveDate: string; revision: number; value: string | number; factor: string | number; offset: string | number }
type CostRow = { id: string; name: string; valueStatus: string; unitAmount?: string | number | null; indexSnapshot?: Snapshot | null; error?: string }
type QuoteCosts = { lines: Array<{ costs: CostRow[] }> }
type QuoteView = { cpqStatus: string; pricingSummary: { mrcTotal: number } }

const TOGGLE = 'cpq.cost_plus'
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

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

async function indexCost(request: APIRequestContext, token: string, quoteId: string): Promise<CostRow> {
  const costs = await getJson<QuoteCosts>(request, token, `/api/cpq/quotes/${quoteId}/costs`)
  const rows = costs.lines.flatMap((l) => l.costs).filter((c) => c.name === 'Index power')
  expect(rows, 'exactly one index cost line').toHaveLength(1)
  return rows[0]
}

const listPrice = async (request: APIRequestContext, token: string, quoteId: string) =>
  (await getJson<QuoteView>(request, token, `/api/cpq/quotes/${quoteId}`)).pricingSummary.mrcTotal

async function recalculate(request: APIRequestContext, token: string, quoteId: string, save: boolean): Promise<void> {
  await post(request, token, `/api/cpq/quotes/${quoteId}/recalculate`, { save }, save ? 'saved recalculation' : 'unsaved recalculation')
}

test.describe('TC-CPQ-COST-INDEX-002 — index costs on quotes', () => {
  test('a new index value re-prices an unlocked quote on save; a sent quote stays frozen', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const cleanup: Array<() => Promise<void>> = []
    const customerId = await seedCustomer(request, token, `COST-INDEX-Co-${uniq()}`)
    const code = `E2E-${uniq().toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 40)
    const id = uniq()

    try {
      await setCostPlusToggle(request, token, true)

      // 1. The index with a value dated yesterday (so it is in force today and tomorrow).
      const index = await post<{ item: { id: string } }>(request, token, '/api/cpq/cost-indices', { code, name: 'E2E power', unit: 'EUR/MWh', currencyCode: 'EUR' }, 'create index')
      const indexId = index.item.id
      // Registered first: runs last (LIFO), once the element that references the index is gone.
      cleanup.push(() => apiRequest(request, 'DELETE', `/api/cpq/cost-indices/${indexId}`, { token }).then(() => undefined))
      await post(request, token, `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: day(-1), value: 80 }, 'value 80')

      // 2. A EUR cost-plus offering whose only price-basis cost is the index (factor 0.5, markup 25 %).
      const spec = await post<{ id: string }>(request, token, '/api/cpq/product-specifications', { code: `Idx-${id}`, name: 'Index spec', lifecycleStatus: 'active', isAssetizable: false }, 'spec')
      cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.id } }).then(() => undefined))
      const offering = await post<{ id: string }>(request, token, '/api/cpq/product-offerings', { specId: spec.id, code: `Idx-${id}-O`, name: `Index offering ${id}`, lifecycleStatus: 'active' }, 'offering')
      cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.id } }).then(() => undefined))
      const charge = await post<{ id: string }>(request, token, '/api/cpq/product-charges', {
        offeringId: offering.id, code: `Idx-${id}-C`, name: 'Index charge', chargeType: 'mrc', chargeModel: 'flat',
        pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25, currencyCode: 'EUR', isActive: false,
      }, 'charge')
      const element = await post<{ id: string }>(request, token, '/api/cpq/charge-cost-elements', {
        productChargeId: charge.id, code: `idx-${id}`, name: 'Index power', role: 'price_basis', costType: 'mrc',
        source: 'index', costModel: 'flat', costIndexId: indexId, indexFactor: 0.5,
      }, 'index cost element')
      cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/charge-cost-elements', { token, data: { id: element.id } }).then(() => undefined))
      const activated = await apiRequest(request, 'PUT', '/api/cpq/product-charges', { token, data: { id: charge.id, isActive: true } })
      expect(activated.ok(), `charge activation returned ${activated.status()}: ${await activated.text()}`).toBeTruthy()
      cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-charges', { token, data: { id: charge.id } }).then(() => undefined))
      // The in-use guard: the active element blocks deactivating or deleting the index.
      const blocked = await apiRequest(request, 'PATCH', `/api/cpq/cost-indices/${indexId}`, { token, data: { isActive: false } })
      expect(blocked.status()).toBe(422)
      expect(await blocked.text()).toContain('INDEX_IN_USE')

      // 3. A saved recalculation snapshots the value in force today (80, r1) and prices 80 x 0.5 x 1.25 = 50.00.
      const quote = await post<{ id: string }>(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'EUR' }, 'quote')
      await post(request, token, `/api/cpq/quotes/${quote.id}/items`, { offeringId: offering.id, configuration: {}, quantity: 1, action: 'add' }, 'add line')
      await recalculate(request, token, quote.id, true)
      const first = await indexCost(request, token, quote.id)
      expect(first.valueStatus).not.toBe('none')
      expect(Number(first.unitAmount)).toBeCloseTo(40, 4)
      expect(first.indexSnapshot).toMatchObject({ indexId, effectiveDate: day(-1), revision: 1 })
      expect(Number(first.indexSnapshot?.value)).toBe(80)
      expect(Number(first.indexSnapshot?.factor)).toBe(0.5)
      expect((await getJson<QuoteView>(request, token, `/api/cpq/quotes/${quote.id}`)).cpqStatus).toBe('ready')
      expect(await listPrice(request, token, quote.id)).toBeCloseTo(50, 2)

      // 4. The admin adds a value for today; the next saved recalculation of the unlocked quote re-prices (90 -> 45 -> 56.25).
      await post(request, token, `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: day(0), value: 90, sourceNote: 'new print' }, 'value 90')
      await recalculate(request, token, quote.id, false)
      expect((await indexCost(request, token, quote.id)).indexSnapshot).toMatchObject({ effectiveDate: day(-1), revision: 1 }) // unsaved: nothing stored
      await recalculate(request, token, quote.id, true)
      const refreshed = await indexCost(request, token, quote.id)
      expect(Number(refreshed.unitAmount)).toBeCloseTo(45, 4)
      expect(refreshed.indexSnapshot).toMatchObject({ effectiveDate: day(0), revision: 1 })
      expect(Number(refreshed.indexSnapshot?.value)).toBe(90)
      const repriced = await listPrice(request, token, quote.id)
      expect(repriced).toBeCloseTo(56.25, 2)

      // 5. Send it: with_customer applies the cost lock.
      const toCustomer = await apiRequest(request, 'POST', `/api/cpq/quotes/${quote.id}/status`, { token, data: { targetStatus: 'with_customer' } })
      expect(toCustomer.ok(), `transition to with_customer returned ${toCustomer.status()}: ${await toCustomer.text()}`).toBeTruthy()
      const locked = await indexCost(request, token, quote.id)

      // 6. A same-date correction (revision 2) arrives; a saved recalculation of the locked quote changes nothing.
      const correction = await post<{ value: { revision: number } }>(request, token, `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: day(0), value: 100, sourceNote: 'correction' }, 'value 100 (r2)')
      expect(correction.value.revision).toBe(2)
      await recalculate(request, token, quote.id, true)
      const frozen = await indexCost(request, token, quote.id)
      expect(frozen.unitAmount).toBe(locked.unitAmount)
      expect(frozen.indexSnapshot).toEqual(locked.indexSnapshot)
      expect(frozen.indexSnapshot).toMatchObject({ effectiveDate: day(0), revision: 1 })
      const after = await getJson<QuoteView>(request, token, `/api/cpq/quotes/${quote.id}`)
      expect(after.cpqStatus).toBe('with_customer')
      expect(after.pricingSummary.mrcTotal).toBe(repriced)
    } finally {
      await deleteCustomer(request, token, customerId).catch(() => undefined)
      for (const f of cleanup.reverse()) await f().catch(() => undefined)
      await setCostPlusToggle(request, token, false).catch(() => undefined)
    }
  })
})
