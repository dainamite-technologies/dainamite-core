import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCustomer, hideFloatingOverlays, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-COST-FX-001 — foreign-currency costs (feature spec 2026-11-12-cpq-cost-plus-foreign-currency-costs)
 *
 * Every fixture is created through the API by this test; nothing relies on demo data. The USD->EUR rates are created
 * through `POST /api/currencies/exchange-rates` at UTC midnight today (the only instant `getRate` matches) under unique
 * source names chosen to sort BEFORE any other source, so the resolver's tie-break (`source` ascending, no priority
 * list) picks them whatever the tenant already holds. Rates, fixtures and the toggle are removed / restored at the end.
 *
 * Flow: a cost-plus offering with a fixed 300 USD price-basis element on a EUR quote -> a saved recalculation stores
 * the snapshot (fx_rate 0.92, converted 276.00, line ready, list price 345.00) -> the Costs panel shows
 * "≈ 276.00 EUR" -> while the quote is `ready` a newer-ranking rate moves the snapshot (0.95) -> the quote goes
 * `with_customer` (cost lock) -> another rate (0.97) arrives -> a saved recalculation leaves rate, date, source and the
 * charge price unchanged (frozen).
 */

type Json = Record<string, unknown>
type CostRow = {
  id: string; name: string; valueStatus: string; currencyCode?: string; unitAmount?: string | number | null
  fxRate?: string | null; fxRateDate?: string | null; fxRateSource?: string | null; fxRateDerivation?: string | null
  convertedInstanceAmount?: string | null
}
type QuoteCosts = { lines: Array<{ costs: CostRow[] }> }
type QuoteView = { cpqStatus: string }

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

/** UTC midnight today as ISO: `getRate` matches the stored `date` exactly at this instant. */
function utcMidnightToday(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/** A USD->EUR rate for today under `source`; its cleanup is registered. */
async function addRate(
  request: APIRequestContext, token: string, scope: { organizationId: string; tenantId: string },
  source: string, rate: string, cleanup: Array<() => Promise<void>>,
): Promise<void> {
  const created = await post<{ id: string }>(request, token, '/api/currencies/exchange-rates', {
    organizationId: scope.organizationId, tenantId: scope.tenantId, fromCurrencyCode: 'USD', toCurrencyCode: 'EUR',
    rate, date: utcMidnightToday(), source,
  }, `exchange rate ${source}`)
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/currencies/exchange-rates', { token, data: { id: created.id } }).then(() => undefined))
}

/** A EUR cost-plus offering whose only element is a fixed 300 USD price-basis cost (markup 25 %: 300 x 0.92 x 1.25 = 345.00). */
async function seedUsdTailOffering(request: APIRequestContext, token: string, cleanup: Array<() => Promise<void>>): Promise<string> {
  const code = `Fx-${uniq()}`
  const spec = await post<{ id: string }>(request, token, '/api/cpq/product-specifications', {
    code, name: 'FX spec', lifecycleStatus: 'active', isAssetizable: false,
  }, 'spec')
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.id } }).then(() => undefined))
  const offering = await post<{ id: string }>(request, token, '/api/cpq/product-offerings', {
    specId: spec.id, code: `${code}-O`, name: `FX offering ${code}`, lifecycleStatus: 'active',
  }, 'offering')
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.id } }).then(() => undefined))
  // A cost-plus charge is created inactive, given its cost element, then activated (it needs a price basis).
  const charge = await post<{ id: string }>(request, token, '/api/cpq/product-charges', {
    offeringId: offering.id, code: `${code}-C`, name: 'FX charge', chargeType: 'mrc', chargeModel: 'flat',
    pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25, currencyCode: 'EUR', isActive: false,
  }, 'charge')
  await post(request, token, '/api/cpq/charge-cost-elements', {
    productChargeId: charge.id, code: `tail-${uniq()}`, name: 'USD tail', role: 'price_basis', costType: 'mrc',
    source: 'fixed', costModel: 'flat', amount: 300, currencyCode: 'USD',
  }, 'cost element')
  const activated = await apiRequest(request, 'PUT', '/api/cpq/product-charges', { token, data: { id: charge.id, isActive: true } })
  expect(activated.ok(), `charge activation returned ${activated.status()}: ${await activated.text()}`).toBeTruthy()
  return offering.id
}

async function tailCost(request: APIRequestContext, token: string, quoteId: string): Promise<CostRow> {
  const costs = await getJson<QuoteCosts>(request, token, `/api/cpq/quotes/${quoteId}/costs`)
  const rows = costs.lines.flatMap((l) => l.costs).filter((c) => c.name === 'USD tail')
  expect(rows, 'exactly one USD tail cost line').toHaveLength(1)
  return rows[0]
}

async function recalculate(request: APIRequestContext, token: string, quoteId: string): Promise<void> {
  await post(request, token, `/api/cpq/quotes/${quoteId}/recalculate`, { save: true }, 'saved recalculation')
}

test.describe('TC-CPQ-COST-FX-001 — foreign-currency costs', () => {
  test('300 USD tail on a EUR quote: converted and ready; refreshed while unlocked; frozen once with_customer', async ({ page, request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const cleanup: Array<() => Promise<void>> = []
    const customerId = await seedCustomer(request, token, `COST-FX-Co-${uniq()}`)
    const id = uniq()

    try {
      await setCostPlusToggle(request, token, true)
      // Sources sort ascending when no priority list is set: digits sort before letters, so "0..." beats every real provider.
      await addRate(request, token, scope, `0e2efx-b-${id}`, '0.92000000', cleanup)
      const offeringId = await seedUsdTailOffering(request, token, cleanup)

      // 1. A saved recalculation stores the snapshot: original 300 USD kept, rate 0.92 (direct), converted 276.00, line ready.
      const quote = await post<{ id: string }>(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'EUR' }, 'quote')
      await post(request, token, `/api/cpq/quotes/${quote.id}/items`, { offeringId, configuration: {}, quantity: 1, action: 'add' }, 'add line')
      await recalculate(request, token, quote.id)
      const first = await tailCost(request, token, quote.id)
      expect(first.currencyCode).toBe('USD')
      expect(Number(first.unitAmount)).toBe(300)
      expect(first.valueStatus).not.toBe('none')
      expect(Number(first.fxRate)).toBeCloseTo(0.92, 8)
      expect(first.fxRateSource).toBe(`0e2efx-b-${id}`)
      expect(first.fxRateDerivation).toBe('direct')
      expect(first.fxRateDate?.slice(0, 10)).toBe(utcMidnightToday().slice(0, 10))
      expect(Number(first.convertedInstanceAmount)).toBeCloseTo(276, 4)
      const priced = await getJson<QuoteView>(request, token, `/api/cpq/quotes/${quote.id}`)
      expect(priced.cpqStatus).toBe('ready')

      // 2. The Costs panel shows the conversion.
      await login(page, 'admin')
      await page.goto(`/backend/cpq/quotes/${quote.id}`, { waitUntil: 'domcontentloaded' })
      await hideFloatingOverlays(page)
      // The Costs sub-panel renders inside an expanded quote line: expand it with the row's toggle (first button).
      const lineRow = page.getByTestId('cpq-quote-line').first()
      await expect(lineRow).toBeVisible({ timeout: 20_000 })
      await lineRow.getByRole('button').first().click()
      await expect(page.getByTestId('cpq-cost-row').filter({ hasText: 'USD tail' })).toContainText('≈ 276.00 EUR', { timeout: 20_000 })

      // 3. Unlocked (`ready`): a rate that outranks the first one moves the snapshot on the next saved recalculation.
      await addRate(request, token, scope, `0e2efx-a-${id}`, '0.95000000', cleanup)
      await recalculate(request, token, quote.id)
      const refreshed = await tailCost(request, token, quote.id)
      expect(Number(refreshed.fxRate)).toBeCloseTo(0.95, 8)
      expect(refreshed.fxRateSource).toBe(`0e2efx-a-${id}`)
      expect(Number(refreshed.convertedInstanceAmount)).toBeCloseTo(285, 4)

      // 4. Send it: with_customer applies the cost lock.
      const toCustomer = await apiRequest(request, 'POST', `/api/cpq/quotes/${quote.id}/status`, { token, data: { targetStatus: 'with_customer' } })
      expect(toCustomer.ok(), `transition to with_customer returned ${toCustomer.status()}: ${await toCustomer.text()}`).toBeTruthy()
      const locked = await tailCost(request, token, quote.id)

      // 5. A rate that outranks both arrives; a saved recalculation of the locked quote leaves the snapshot untouched.
      await addRate(request, token, scope, `0e2efx-0-${id}`, '0.97000000', cleanup)
      await recalculate(request, token, quote.id)
      const frozen = await tailCost(request, token, quote.id)
      expect(frozen.fxRate).toBe(locked.fxRate)
      expect(Number(frozen.fxRate)).toBeCloseTo(0.95, 8)
      expect(frozen.fxRateDate).toBe(locked.fxRateDate)
      expect(frozen.fxRateSource).toBe(`0e2efx-a-${id}`)
      expect(frozen.convertedInstanceAmount).toBe(locked.convertedInstanceAmount)
      const after = await getJson<QuoteView>(request, token, `/api/cpq/quotes/${quote.id}`)
      expect(after.cpqStatus).toBe('with_customer')
    } finally {
      await deleteCustomer(request, token, customerId).catch(() => undefined)
      for (const f of cleanup.reverse()) await f().catch(() => undefined)
      await setCostPlusToggle(request, token, false).catch(() => undefined)
    }
  })
})
