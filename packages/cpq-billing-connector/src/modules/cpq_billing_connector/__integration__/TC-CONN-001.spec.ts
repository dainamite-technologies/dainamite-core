import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CONN-001: quote with a free month, a promo and an annual add-on →
 * activate → line status → terminate → Bill Run (API).
 *
 * Specs: `2026-11-26-billing-price-phases-ramp-deals.md` (P) Phase 3 and
 * `2026-11-26-billing-line-period-and-status.md` (L) Phase 3; contract C3 of
 * the run plan `.ai/runs/2026-11-26-billing-cpq-flex/PLAN.md`.
 *
 * 1. Catalog: Internet 79,900 / month; Mobile 480,000 every 1 year.
 * 2. Quote both; on Internet: month 1 free ("Free trial"), months 2–3 at 50%
 *    ("Promo 50%"). Accept, convert, activate.
 * 3. Billing gets two recurring items: Internet with its two fixed month
 *    phases on the account cycle (ref `…-recurring`), Mobile with its own
 *    annual period (ref `…-recurring-1y`).
 * 4. Pause the Internet item in CPQ → one billing status period; replaying
 *    the same pause is a no-op; resume closes it at `fromDate − 1`.
 * 5. A TEST Bill Run invoices the Internet free phase at 0.00 and Mobile's
 *    whole year at 480,000.
 * 6. Terminate the subscription in CPQ → every Billing Item ends the day
 *    before the effective date (cancel rule).
 *
 * Needs a running app with the connector and its worker (`yarn dev`); it
 * cannot run in a unit-test sandbox without a database.
 */

type Json = Record<string, unknown>
type Line = { lineId: string; offeringId: string | null }
type Quote = { id: string; cpqStatus: string; lines: Line[] }
type Item = { id: string; offeringId: string | null; children?: Item[] }
type BillingItem = {
  id: string
  type: string
  sourceRef: string | null
  subscriptionItemId: string | null
  billAccountId: string | null
  billEndDate: string | null
  billingPeriodUnit: string | null
  billingPeriodInterval: number | null
  phasesEnabled: boolean
  phases: Array<{ name: string | null; priceType: string; value: number | string | null; durationUnit?: string | null; durationCount?: number | null }>
}
type StatusPeriod = { id: string; status: string; fromDate: string; toDate: string | null }

const LADDER = ['ready', 'in_approval', 'approved', 'with_customer', 'accepted']
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const flatten = (items: Item[]): Item[] => items.flatMap((item) => [item, ...flatten(item.children ?? [])])
const day = (value: unknown) => (typeof value === 'string' && value ? value.slice(0, 10) : null)

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const today = () => new Date().toISOString().slice(0, 10)

async function call(request: APIRequestContext, token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: Json) {
  const res = await apiRequest(request, method, path, { token, ...(data ? { data } : {}) })
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Json }
}

async function created(request: APIRequestContext, token: string, path: string, data: Json): Promise<string> {
  const res = await call(request, token, 'POST', path, data)
  expect(res.status, `POST ${path}: ${JSON.stringify(res.body)}`).toBe(201)
  return res.body.id as string
}

/** Item reads carry snake_case columns plus camelCase aliases (T2 as built); read both. */
function toBillingItem(row: Json): BillingItem {
  const pick = (camel: string, snake: string) => row[camel] ?? row[snake] ?? null
  return {
    id: row.id as string,
    type: String(row.type ?? ''),
    sourceRef: pick('sourceRef', 'source_ref') as string | null,
    subscriptionItemId: pick('subscriptionItemId', 'subscription_item_id') as string | null,
    billAccountId: pick('billAccountId', 'bill_account_id') as string | null,
    billEndDate: day(pick('billEndDate', 'bill_end_date')),
    billingPeriodUnit: pick('billingPeriodUnit', 'billing_period_unit') as string | null,
    billingPeriodInterval: pick('billingPeriodInterval', 'billing_period_interval') as number | null,
    phasesEnabled: Boolean(pick('phasesEnabled', 'phases_enabled')),
    phases: (row.phases ?? []) as BillingItem['phases'],
  }
}

async function billingItems(request: APIRequestContext, token: string, subscriptionId: string): Promise<BillingItem[]> {
  const res = await call(request, token, 'GET', `/api/billing/items?subscriptionId=${subscriptionId}&pageSize=100`)
  return ((res.body.items ?? []) as Json[]).map(toBillingItem)
}

async function statusPeriods(request: APIRequestContext, token: string, billingItemId: string): Promise<StatusPeriod[]> {
  const res = await call(request, token, 'GET', `/api/billing/items/status-periods?billingItemId=${billingItemId}&pageSize=100`)
  return ((res.body.items ?? []) as Json[]).map((row) => ({
    id: row.id as string,
    status: String(row.status),
    fromDate: day(row.fromDate ?? row.from_date) ?? '',
    toDate: day(row.toDate ?? row.to_date),
  }))
}

async function toOrderAndActivate(request: APIRequestContext, token: string, quoteId: string): Promise<void> {
  const current = (await call(request, token, 'GET', `/api/cpq/quotes/${quoteId}`)).body.cpqStatus as string
  for (const targetStatus of LADDER.slice(LADDER.indexOf(current) + 1)) {
    const res = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/status`, { targetStatus })
    expect(res.status, `transition to ${targetStatus}: ${JSON.stringify(res.body)}`).toBeLessThan(300)
  }
  const order = await call(request, token, 'POST', '/api/cpq/orders', { quoteId })
  expect(order.status, `convert: ${JSON.stringify(order.body)}`).toBeLessThan(300)
  const activated = await call(request, token, 'POST', `/api/cpq/orders/${order.body.id}/activate`, {})
  expect(activated.status, `activate: ${JSON.stringify(activated.body)}`).toBeLessThan(300)
}

test.describe('TC-CONN-001: CPQ phases, annual period and line status reach billing (API)', () => {
  const cleanup: Array<() => Promise<unknown>> = []
  const testRunIds: string[] = []
  let token = ''

  test.afterAll(async ({ request }) => {
    for (const billRunId of testRunIds) {
      await apiRequest(request, 'POST', '/api/billing/test-invoices/wipe', { token, data: { billRunId } }).catch(() => undefined)
    }
    for (const run of cleanup.reverse()) await run().catch(() => undefined)
  })

  test('quote → activate → status → bill run → terminate', async ({ request }) => {
    test.setTimeout(180_000)
    token = await getAuthToken(request, 'admin')
    const del = (path: string, id: string) => () => apiRequest(request, 'DELETE', path, { token, data: { id } })
    const tag = uniq()

    // ── 1. Catalog ──────────────────────────────────────────────────────
    const service = async (code: string, charge: Json) => {
      const specId = await created(request, token, '/api/cpq/product-specifications', { code: `CONN1-${code}-${tag}`, name: `CONN1 ${code}`, specType: 'simple', lifecycleStatus: 'active' })
      cleanup.push(del('/api/cpq/product-specifications', specId))
      const offeringId = await created(request, token, '/api/cpq/product-offerings', { specId, code: `CONN1-OFF-${code}-${tag}`, name: `CONN1 ${code}`, lifecycleStatus: 'active' })
      cleanup.push(del('/api/cpq/product-offerings', offeringId))
      await created(request, token, '/api/cpq/product-charges', {
        offeringId, code: `MRC-${code}-${tag}`, name: `${code} recurring`, chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'fixed', currencyCode: 'USD', ...charge,
      })
      return offeringId
    }
    const internet = await service('internet', { fixedPrice: '79900' })
    const mobile = await service('mobile', { fixedPrice: '480000', billingPeriodUnit: 'year', billingPeriodInterval: 1 })

    // ── 2. Quote with phases on Internet, then activate ─────────────────
    const customerId = await createCompanyFixture(request, token, `CONN1-Co-${tag}`)
    cleanup.push(() => apiRequest(request, 'DELETE', '/api/customers/companies', { token, data: { id: customerId } }))
    const quoteId = await created(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'USD' })
    let quote: Quote | null = null
    for (const offeringId of [internet, mobile]) {
      const added = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/items`, { offeringId, configuration: {} })
      expect(added.status, JSON.stringify(added.body)).toBe(201)
      quote = added.body as unknown as Quote
    }
    const internetLine = quote!.lines.find((line) => line.offeringId === internet)!
    const phase = async (data: Json) => {
      const res = await call(request, token, 'POST', `/api/cpq/quotes/${quoteId}/price-adjustments`, {
        level: 'line', quoteLineId: internetLine.lineId, chargeTypeFilter: 'mrc', currencyCode: 'USD', reasonCode: 'other', reasonNote: 'TC-CONN-001', ...data,
      })
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    }
    await phase({ adjustmentType: 'price_override', value: 0, fromMonth: 1, toMonth: 1, phaseName: 'Free trial' })
    await phase({ adjustmentType: 'discount_percent', value: 50, fromMonth: 2, toMonth: 3, phaseName: 'Promo 50%' })
    await toOrderAndActivate(request, token, quoteId)

    const subs = await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?customerId=${customerId}`)
    const subId = ((subs.body.items as Json[])[0] as Json).id as string
    expect(subId).toBeTruthy()
    // Order activation leaves the subscription pending until the operator activates it (XD-215),
    // and status actions need an active subscription: activate it as seedActiveSubscription does.
    const live = await call(request, token, 'POST', '/api/cpq/inventory/subscriptions/status', { id: subId, targetStatus: 'active' })
    expect(live.status, JSON.stringify(live.body)).toBeLessThan(300)
    const items = flatten(((await call(request, token, 'GET', `/api/cpq/inventory/subscriptions?id=${subId}`)).body.items ?? []) as Item[])
    const internetItem = items.find((item) => item.offeringId === internet)!
    const mobileItem = items.find((item) => item.offeringId === mobile)!
    expect(internetItem && mobileItem).toBeTruthy()

    // ── 3. Billing items: phases and own period (C3) ────────────────────
    await expect
      .poll(async () => (await billingItems(request, token, subId)).filter((bi) => bi.type === 'recurring').length, { timeout: 30_000 })
      .toBe(2)
    const recurring = (await billingItems(request, token, subId)).filter((bi) => bi.type === 'recurring')
    const internetBilling = recurring.find((bi) => bi.subscriptionItemId === internetItem.id)!
    const mobileBilling = recurring.find((bi) => bi.subscriptionItemId === mobileItem.id)!
    expect(internetBilling.sourceRef).toBe(`cpq-${subId}-${internetItem.id}-recurring`)
    expect(internetBilling.billingPeriodUnit).toBeNull()
    expect(internetBilling.phasesEnabled).toBe(true)
    expect(internetBilling.phases.map((p) => [p.name, p.priceType, Number(p.value), p.durationUnit, p.durationCount])).toEqual([
      ['Free trial', 'fixed', 0, 'month', 1],
      ['Promo 50%', 'fixed', 39_950, 'month', 2],
    ])
    expect(mobileBilling.sourceRef).toBe(`cpq-${subId}-${mobileItem.id}-recurring-1y`)
    expect([mobileBilling.billingPeriodUnit, mobileBilling.billingPeriodInterval]).toEqual(['annually', 1])

    // ── 4. Pause / replay / resume the Internet item ────────────────────
    const pauseFrom = addDays(today(), 90)
    const pause = { subscriptionId: subId, subscriptionItemId: internetItem.id, action: 'pause', fromDate: pauseFrom, reason: 'TC-CONN-001' }
    const paused = await call(request, token, 'POST', '/api/cpq/inventory/subscriptions/actions', pause)
    expect(paused.status, JSON.stringify(paused.body)).toBeLessThan(300)
    await expect.poll(async () => (await statusPeriods(request, token, internetBilling.id)).length, { timeout: 30_000 }).toBe(1)
    expect((await statusPeriods(request, token, internetBilling.id))[0]).toMatchObject({ status: 'paused', fromDate: pauseFrom, toDate: null })

    const resumeFrom = addDays(pauseFrom, 10)
    const resumed = await call(request, token, 'POST', '/api/cpq/inventory/subscriptions/actions', {
      subscriptionId: subId, subscriptionItemId: internetItem.id, action: 'resume', fromDate: resumeFrom,
    })
    expect(resumed.status, JSON.stringify(resumed.body)).toBeLessThan(300)
    await expect
      .poll(async () => (await statusPeriods(request, token, internetBilling.id))[0]?.toDate ?? null, { timeout: 30_000 })
      .toBe(addDays(resumeFrom, -1))
    expect(await statusPeriods(request, token, internetBilling.id)).toHaveLength(1)

    // ── 5. TEST Bill Run: free phase at 0.00, Mobile's year at 480,000 ──
    const run = await call(request, token, 'POST', '/api/billing/runs', {
      mode: 'test', asOfDate: addDays(today(), 35), scopedAccountIds: [internetBilling.billAccountId], catchUp: true,
    })
    expect(run.status, JSON.stringify(run.body)).toBeLessThan(300)
    testRunIds.push(run.body.billRunId as string)
    const invoices = await call(request, token, 'GET', `/api/billing/invoices?billAccountId=${internetBilling.billAccountId}&testRun=true&pageSize=100`)
    const invoiceIds = ((invoices.body.items ?? []) as Json[]).map((row) => row.id as string)
    expect(invoiceIds.length).toBeGreaterThan(0)
    const lines: Json[] = []
    for (const id of invoiceIds) lines.push(...(((await call(request, token, 'GET', `/api/billing/invoices/${id}`)).body.lines ?? []) as Json[]))
    const ofItem = (billingItemId: string) => lines.filter((line) => line.billing_item_id === billingItemId)
    expect(ofItem(internetBilling.id).some((line) => Number(line.net_amount) === 0)).toBe(true)
    expect(ofItem(mobileBilling.id).map((line) => Number(line.net_amount))).toContain(480_000)

    // ── 6. Terminate → cancel end dates ─────────────────────────────────
    const effective = addDays(today(), 120)
    const terminated = await call(request, token, 'POST', '/api/cpq/inventory/subscriptions/actions', {
      subscriptionId: subId, action: 'terminate', fromDate: effective, reason: 'TC-CONN-001',
    })
    expect(terminated.status, JSON.stringify(terminated.body)).toBeLessThan(300)
    const endDates = async () =>
      (await billingItems(request, token, subId)).filter((row) => row.type === 'recurring').map((row) => row.billEndDate)
    await expect.poll(endDates, { timeout: 30_000 }).toEqual([addDays(effective, -1), addDays(effective, -1)])
  })
})
