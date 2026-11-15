import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCustomer, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-COST-SOURCING-001 — supplier cost sourcing (feature spec 2026-11-12-cpq-cost-plus-supplier-sourcing)
 *
 * Every fixture is created through the API by this test (specification, offering, cost-plus charge with an
 * `on_request` cost element that `requires_sourcing`, customer, a role and user holding `cpq.costs.view` but not
 * `cpq.costs.manage`); nothing relies on demo data. The tenant toggle `cpq.cost_plus` is switched on and restored.
 *
 * Flow: a saved recalculation opens a request -> the queue lists it -> the current request id is answered (line
 * ready, value confirmed) -> an identical repeat is a 200 noop -> a re-request supersedes the old id (409) -> a
 * changed payload under the same supplier reference is refused -> a rep without `cpq.costs.manage` reads the
 * queue but cannot answer.
 *
 * The workflow-recipe scenario is `test.fixme` below: it cannot be made deterministic.
 */

type Json = Record<string, unknown>
type CostRow = {
  id: string; name: string; valueStatus: string; sourcingStatus: string; costRequestId: string | null; requestSeq: number | null
  unitAmount?: string | number | null; valueOrigin?: string | null
}
type QuoteCosts = { lines: Array<{ costs: CostRow[] }>; pricingRevision: number }
type QueueItem = { costId: string; costRequestId: string | null; sourcingStatus: string; requestSeq: number | null; quoteNumber: string | null }
type Queue = { items: QueueItem[]; total: number }
type AnswerResponse = { outcome: string; lineReady: boolean; pricingRevision: number; cost: Json }

const TOGGLE = 'cpq.cost_plus'
const PASSWORD = 'Valid1!Pass'

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

/** A cost-plus offering whose only cost element is `on_request` + `requires_sourcing` (estimate 300 USD). */
async function seedSourcedOffering(request: APIRequestContext, token: string, cleanup: Array<() => Promise<void>>): Promise<string> {
  const code = `Sourcing-${uniq()}`
  const spec = await post<{ id: string }>(request, token, '/api/cpq/product-specifications', {
    code, name: 'Sourcing spec', lifecycleStatus: 'active', isAssetizable: false,
  }, 'spec')
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-specifications', { token, data: { id: spec.id } }).then(() => undefined))
  const offering = await post<{ id: string }>(request, token, '/api/cpq/product-offerings', {
    specId: spec.id, code: `${code}-O`, name: `Sourcing offering ${code}`, lifecycleStatus: 'active',
  }, 'offering')
  cleanup.push(() => apiRequest(request, 'DELETE', '/api/cpq/product-offerings', { token, data: { id: offering.id } }).then(() => undefined))
  // A cost-plus charge is created inactive, given its cost element, then activated (it needs a price basis).
  const charge = await post<{ id: string }>(request, token, '/api/cpq/product-charges', {
    offeringId: offering.id, code: `${code}-C`, name: 'Sourcing charge', chargeType: 'mrc', chargeModel: 'flat',
    pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25, currencyCode: 'USD', isActive: false,
  }, 'charge')
  await post(request, token, '/api/cpq/charge-cost-elements', {
    productChargeId: charge.id, code: `tail-${uniq()}`, name: 'Partner tail', role: 'price_basis', costType: 'mrc',
    source: 'on_request', costModel: 'flat', estimateAmount: 300, currencyCode: 'USD', requiresSourcing: true,
  }, 'cost element')
  const activated = await apiRequest(request, 'PUT', '/api/cpq/product-charges', { token, data: { id: charge.id, isActive: true } })
  expect(activated.ok(), `charge activation returned ${activated.status()}: ${await activated.text()}`).toBeTruthy()
  return offering.id
}

async function tailCost(request: APIRequestContext, token: string, quoteId: string): Promise<CostRow> {
  const costs = await getJson<QuoteCosts>(request, token, `/api/cpq/quotes/${quoteId}/costs`)
  const rows = costs.lines.flatMap((l) => l.costs).filter((c) => c.name === 'Partner tail')
  expect(rows, 'exactly one Partner tail cost line').toHaveLength(1)
  return rows[0]
}

const answerBody = (costRequestId: string, over: Json = {}): Json => ({
  costRequestId, unitAmount: 280, currencyCode: 'USD', valueStatus: 'confirmed', supplierQuoteRef: 'CARR-889', ...over,
})

test.describe('TC-CPQ-COST-SOURCING-001 — supplier cost sourcing', () => {
  test('auto-open -> queue -> answer -> noop -> superseded -> ref conflict; a rep reads the queue but cannot answer', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)
    const cleanup: Array<() => Promise<void>> = []
    const customerId = await seedCustomer(request, token, `COST-SOURCING-Co-${uniq()}`)
    let roleId: string | null = null
    let userId: string | null = null

    try {
      await setCostPlusToggle(request, token, true)
      const offeringId = await seedSourcedOffering(request, token, cleanup)

      // 1. A saved recalculation opens the request (preview would not).
      const quote = await post<{ id: string }>(request, token, '/api/cpq/quotes', { customerId, currencyCode: 'USD' }, 'quote')
      await post(request, token, `/api/cpq/quotes/${quote.id}/items`, { offeringId, configuration: {}, quantity: 1, action: 'add' }, 'add line')
      await post(request, token, `/api/cpq/quotes/${quote.id}/recalculate`, { save: true }, 'recalculate')
      const opened = await tailCost(request, token, quote.id)
      expect(opened.sourcingStatus).toBe('requested')
      expect(opened.requestSeq).toBe(1)
      expect(opened.valueStatus).toBe('estimated')
      expect(opened.costRequestId).toBeTruthy()
      const firstRequestId = opened.costRequestId as string

      // 2. The queue lists it (no amounts in the projection).
      const queue = await getJson<Queue>(request, token, `/api/cpq/cost-requests?quoteId=${quote.id}`)
      expect(queue.items.map((i) => i.costId)).toEqual([opened.id])
      expect(queue.items[0].costRequestId).toBe(firstRequestId)
      expect(queue.items[0]).not.toHaveProperty('unitAmount')

      // 3. Answer with the current request id: applied, value confirmed from the supplier, line ready.
      const answerPath = `/api/cpq/quotes/${quote.id}/costs/${opened.id}/answer`
      const applied = await post<AnswerResponse>(request, token, answerPath, answerBody(firstRequestId), 'answer')
      expect(applied.outcome).toBe('applied')
      expect(applied.lineReady).toBe(true)
      const answered = await tailCost(request, token, quote.id)
      expect(answered.sourcingStatus).toBe('answered')
      expect(answered.valueStatus).toBe('confirmed')
      expect(answered.valueOrigin).toBe('supplier')
      expect(Number(answered.unitAmount)).toBe(280)
      const open = await getJson<Queue>(request, token, `/api/cpq/cost-requests?quoteId=${quote.id}`)
      expect(open.items).toHaveLength(0)
      const done = await getJson<Queue>(request, token, `/api/cpq/cost-requests?quoteId=${quote.id}&status=answered`)
      expect(done.items.map((i) => i.costId)).toEqual([opened.id])

      // 4. An identical repeat (a workflow retry) is a 200 noop: same revision, nothing written.
      const repeat = await post<AnswerResponse>(request, token, answerPath, answerBody(firstRequestId), 'repeat answer')
      expect(repeat.outcome).toBe('noop')
      expect(repeat.pricingRevision).toBe(applied.pricingRevision)

      // 5. A re-request supersedes the old id: answering it is 409 COST_REQUEST_SUPERSEDED, nothing changes.
      await post(request, token, `/api/cpq/quotes/${quote.id}/costs/${opened.id}/request`, {}, 're-request')
      const second = await tailCost(request, token, quote.id)
      expect(second.requestSeq).toBe(2)
      expect(second.costRequestId).toBeTruthy()
      expect(second.costRequestId).not.toBe(firstRequestId)
      const stale = await apiRequest(request, 'POST', answerPath, { token, data: answerBody(firstRequestId, { unitAmount: 295, supplierQuoteRef: 'CARR-890' }) })
      expect(stale.status()).toBe(409)
      expect(await stale.text()).toContain('COST_REQUEST_SUPERSEDED')
      expect((await tailCost(request, token, quote.id)).costRequestId).toBe(second.costRequestId)

      // 6. The same supplier reference with a changed payload is refused (hash differs), nothing written.
      const conflict = await apiRequest(request, 'POST', answerPath, {
        token, data: answerBody(second.costRequestId as string, { unitAmount: 295 }),
      })
      expect(conflict.status()).toBe(409)
      expect(await conflict.text()).toContain('SUPPLIER_QUOTE_REF_CONFLICT')

      // 7. A rep with cpq.costs.view but not cpq.costs.manage reads the queue (no amounts) and cannot answer.
      roleId = await createRoleFixture(request, token, { name: `cpq-rep-${uniq()}` })
      await setRoleAclFeatures(request, token, { roleId, features: ['cpq.quotes.view', 'cpq.costs.view'] })
      const email = `cpq-rep-${uniq()}@example.com`
      userId = await createUserFixture(request, token, { email, password: PASSWORD, organizationId, roles: [roleId] })
      const repToken = await getAuthToken(request, email, PASSWORD)
      const repQueue = await getJson<Queue>(request, repToken, `/api/cpq/cost-requests?quoteId=${quote.id}`)
      expect(repQueue.items.map((i) => i.costId)).toEqual([opened.id])
      const denied = await apiRequest(request, 'POST', answerPath, {
        token: repToken, data: answerBody(second.costRequestId as string, { supplierQuoteRef: 'CARR-891' }),
      })
      expect(denied.status()).toBe(403)

      // 8. The current request is answered by procurement with a new reference.
      const final = await post<AnswerResponse>(request, token, answerPath, answerBody(second.costRequestId as string, { unitAmount: 290, supplierQuoteRef: 'CARR-892' }), 'answer seq 2')
      expect(final.outcome).toBe('applied')
      expect(Number((await tailCost(request, token, quote.id)).unitAmount)).toBe(290)
    } finally {
      await deleteUserIfExists(request, token, userId).catch(() => undefined)
      await deleteRoleIfExists(request, token, roleId).catch(() => undefined)
      await deleteCustomer(request, token, customerId).catch(() => undefined)
      for (const f of cleanup.reverse()) await f().catch(() => undefined)
      await setCostPlusToggle(request, token, false).catch(() => undefined)
    }
  })

  // The recipe (`cpq_cost_sourcing`, seeded disabled in demo_gix) is started by `cpq.quote.cost_requested` through the
  // workflows event trigger, which is delivered by a persistent subscriber on the queue worker: the task appears after
  // an unbounded delay that no API lets a test await, and the definition's execution principal is provisioned only by
  // the demo seed (`syncWorkflowDefinitionPrincipal`), which is demo data this suite must not rely on. Covered instead
  // by the seed unit test (`seeds/__tests__/cost-sourcing-workflow.test.ts`) and the answer API steps above.
  test.fixme('enabled recipe creates a task and answers through the API', async () => {
    // 1. enable `cpq_cost_sourcing`; 2. add the partner tail so a request opens; 3. poll the workflows tasks API for the
    // task; 4. complete it with outcome=answer; 5. assert the cost line is answered. Needs a deterministic event trigger.
  })
})
