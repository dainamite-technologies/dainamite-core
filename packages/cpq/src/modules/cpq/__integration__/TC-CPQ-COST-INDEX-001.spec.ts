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
import { uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-COST-INDEX-001 — cost index catalogue (feature spec 2026-11-12-cpq-cost-plus-index-costs-expiry, Phase A)
 *
 * Self-contained: every fixture is created through the API by this test (an index, its values, a role and user
 * holding the read features but not `cpq.pricing.manage`); nothing relies on demo data. The tenant toggle
 * `cpq.cost_plus` is switched on and restored.
 *
 * Flow: admin creates an index -> adds a value (r1) -> adds a same-date correction (r2) -> the list shows the
 * correction as the current value -> the default value list hides the superseded revision -> an import dry run writes
 * nothing and a real import is idempotent -> a rep with the read features lists and reads the index but cannot
 * create, append or import (403) -> a user without `cpq.costs.view` gets 403 on every read.
 */

type Json = Record<string, unknown>
type Current = { effectiveDate: string; value: string; revision: number } | null
type IndexItem = { id: string; code: string; currencyCode: string; isActive: boolean }
type ListItem = IndexItem & { current: Current; elementCount: number }
type ValueRow = { id: string; effectiveDate: string; value: string; revision: number; inForceToday: boolean; superseded: boolean; future: boolean }

const TOGGLE = 'cpq.cost_plus'
const PASSWORD = 'Valid1!Pass'
const today = () => new Date().toISOString().slice(0, 10)
const daysFromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

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

async function makeUser(request: APIRequestContext, token: string, organizationId: string, features: string[], label: string) {
  const roleId = await createRoleFixture(request, token, { name: `cpq-${label}-${uniq()}` })
  await setRoleAclFeatures(request, token, { roleId, features })
  const email = `cpq-${label}-${uniq()}@example.com`
  const userId = await createUserFixture(request, token, { email, password: PASSWORD, organizationId, roles: [roleId] })
  return { roleId, userId, token: await getAuthToken(request, email, PASSWORD) }
}

test.describe('TC-CPQ-COST-INDEX-001 — cost index catalogue', () => {
  test('create -> value r1 -> correction r2 -> list -> import; a rep reads but cannot write', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)
    const code = `SMOKE-${uniq().toUpperCase().replace(/[^A-Z0-9]/g, '')}`.slice(0, 40)
    const created: Array<{ roleId: string; userId: string }> = []
    let indexId: string | null = null

    try {
      await setCostPlusToggle(request, token, true)

      // 1. Admin creates an index (code immutable, currency fixed).
      const index = await post<{ item: IndexItem }>(request, token, '/api/cpq/cost-indices', {
        code, name: 'Smoke power', unit: 'EUR/MWh', currencyCode: 'EUR',
      }, 'create index')
      indexId = index.item.id
      expect(index.item.code).toBe(code)
      const duplicate = await apiRequest(request, 'POST', '/api/cpq/cost-indices', { token, data: { code, name: 'Again', unit: 'EUR/MWh', currencyCode: 'EUR' } })
      expect(duplicate.status()).toBe(422)
      expect(await duplicate.text()).toContain('DUPLICATE_CODE')

      // 2. Revision 1, then a same-date correction (revision 2).
      const day = today()
      const first = await post<{ value: ValueRow }>(request, token, `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: day, value: 80, sourceNote: 'first print' }, 'value r1')
      expect(first.value.revision).toBe(1)
      const correction = await post<{ value: ValueRow }>(request, token, `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: day, value: 82.4, sourceNote: 'correction' }, 'value r2')
      expect(correction.value.revision).toBe(2)
      const future = await post<{ value: ValueRow }>(request, token, `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: daysFromToday(30), value: 90 }, 'future value')
      expect(future.value.revision).toBe(1)

      // 3. The list and detail show the correction as the value in force; the future value is counted, not in force.
      const list = await getJson<{ items: ListItem[]; total: number }>(request, token, `/api/cpq/cost-indices?search=${encodeURIComponent(code)}`)
      const row = list.items.find((item) => item.id === indexId)
      expect(row?.current).toMatchObject({ effectiveDate: day, revision: 2 })
      expect(Number(row?.current?.value)).toBe(82.4)
      expect(row?.elementCount).toBe(0)
      const detail = await getJson<{ item: IndexItem; current: Current; futureValueCount: number; elements: unknown[] }>(request, token, `/api/cpq/cost-indices/${indexId}`)
      expect(detail.current?.revision).toBe(2)
      expect(detail.futureValueCount).toBe(1)
      expect(detail.elements).toEqual([])

      // 4. Values: superseded revisions are hidden by default and flagged when requested.
      const visible = await getJson<{ items: ValueRow[] }>(request, token, `/api/cpq/cost-indices/${indexId}/values`)
      expect(visible.items.map((v) => [v.effectiveDate, v.revision])).toEqual([[daysFromToday(30), 1], [day, 2]])
      expect(visible.items.find((v) => v.revision === 2)?.inForceToday).toBe(true)
      expect(visible.items.find((v) => v.effectiveDate === daysFromToday(30))?.future).toBe(true)
      const all = await getJson<{ items: ValueRow[] }>(request, token, `/api/cpq/cost-indices/${indexId}/values?includeSuperseded=true`)
      expect(all.items).toHaveLength(3)
      expect(all.items.find((v) => v.revision === 1 && v.effectiveDate === day)?.superseded).toBe(true)

      // 5. Import: an invalid row refuses the whole file (nothing written), a dry run writes nothing, a real import is idempotent.
      const rows = [{ indexCode: code, effectiveDate: daysFromToday(-30), value: 70 }, { indexCode: code, effectiveDate: day, value: 82.4 }]
      const invalid = await apiRequest(request, 'POST', '/api/cpq/cost-indices/import', { token, data: { items: [...rows, { indexCode: `NOPE-${uniq().toUpperCase()}`.slice(0, 40), effectiveDate: day, value: 1 }] } })
      expect(invalid.status()).toBe(422)
      expect(await invalid.text()).toContain('IMPORT_VALIDATION_FAILED')
      const dry = await post<{ batchId: string | null; dryRun: boolean; results: Array<{ status: string }> }>(request, token, '/api/cpq/cost-indices/import', { items: rows, dryRun: true }, 'dry run')
      expect(dry.dryRun).toBe(true)
      expect(dry.batchId).toBeNull()
      expect(dry.results.map((r) => r.status)).toEqual(['created', 'unchanged'])
      expect((await getJson<{ total: number }>(request, token, `/api/cpq/cost-indices/${indexId}/values?includeSuperseded=true`)).total).toBe(3)
      const imported = await post<{ batchId: string; results: Array<{ status: string }> }>(request, token, '/api/cpq/cost-indices/import', { items: rows }, 'import')
      expect(imported.batchId).toBeTruthy()
      expect(imported.results.map((r) => r.status)).toEqual(['created', 'unchanged'])
      const again = await post<{ results: Array<{ status: string }> }>(request, token, '/api/cpq/cost-indices/import', { items: rows }, 're-import')
      expect(again.results.map((r) => r.status)).toEqual(['unchanged', 'unchanged'])

      // 6. A rep (read features, no cpq.pricing.manage) sees the list read-only: reads work, every write is 403.
      const rep = await makeUser(request, token, organizationId, ['cpq.pricing.view', 'cpq.costs.view'], 'index-rep')
      created.push(rep)
      const repList = await getJson<{ items: ListItem[] }>(request, rep.token, `/api/cpq/cost-indices?search=${encodeURIComponent(code)}`)
      expect(repList.items.map((item) => item.id)).toContain(indexId)
      expect((await getJson<{ items: ValueRow[] }>(request, rep.token, `/api/cpq/cost-indices/${indexId}/values`)).items.length).toBeGreaterThan(0)
      const writes: Array<[string, string, unknown]> = [
        ['POST', '/api/cpq/cost-indices', { code: `REP-${uniq().toUpperCase()}`.slice(0, 40), name: 'x', unit: 'u', currencyCode: 'EUR' }],
        ['PATCH', `/api/cpq/cost-indices/${indexId}`, { name: 'renamed' }],
        ['DELETE', `/api/cpq/cost-indices/${indexId}`, undefined],
        ['POST', `/api/cpq/cost-indices/${indexId}/values`, { effectiveDate: day, value: 1 }],
        ['POST', '/api/cpq/cost-indices/import', { items: rows }],
      ]
      for (const [method, path, data] of writes) {
        const denied = await apiRequest(request, method as 'POST', path, { token: rep.token, data })
        expect(denied.status(), `${method} ${path} as a rep`).toBe(403)
      }
      expect((await getJson<{ current: Current }>(request, token, `/api/cpq/cost-indices/${indexId}`)).current?.revision).toBe(2)

      // 7. Index values are cost data: pricing.view without cpq.costs.view reads nothing.
      const noCosts = await makeUser(request, token, organizationId, ['cpq.pricing.view'], 'index-nocost')
      created.push(noCosts)
      expect((await apiRequest(request, 'GET', '/api/cpq/cost-indices', { token: noCosts.token })).status()).toBe(403)
      expect((await apiRequest(request, 'GET', `/api/cpq/cost-indices/${indexId}/values`, { token: noCosts.token })).status()).toBe(403)

      // 8. With the toggle off the catalogue answers 404.
      await setCostPlusToggle(request, token, false)
      expect((await apiRequest(request, 'GET', '/api/cpq/cost-indices', { token })).status()).toBe(404)
      await setCostPlusToggle(request, token, true)
    } finally {
      for (const fixture of created.reverse()) {
        await deleteUserIfExists(request, token, fixture.userId).catch(() => undefined)
        await deleteRoleIfExists(request, token, fixture.roleId).catch(() => undefined)
      }
      if (indexId) await apiRequest(request, 'DELETE', `/api/cpq/cost-indices/${indexId}`, { token }).catch(() => undefined)
      await setCostPlusToggle(request, token, false).catch(() => undefined)
    }
  })
})
