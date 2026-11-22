import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCustomer, seedCustomer, uniq } from './_helpers/cpqArcFixtures'

/**
 * TC-CPQ-013 — Bundle setup and bundle quoting (API), issues #122–#125.
 *
 * 1. A bundle offering is created without sending `offeringType` — it takes
 *    the specification's type (#122, V-OFF-7).
 * 2. A component can be removed and added back (#122, partial unique index).
 * 3. Adding the bundle to a quote with `expandBundleDefaults` creates a child
 *    line per default component (#123). The components have no charges, and
 *    are still configured (#125). The quote is `ready`.
 * 4. Removing a required component makes the bundle line incomplete with a
 *    V-QBUN-1 error naming the slot, and conversion is refused (#124).
 */

type Json = Record<string, unknown>
type QuoteLine = { lineId: string; offeringId: string | null; parentLineId: string | null; isConfigured: boolean; validationErrors: Array<{ message: string; slotGroup?: string }> | null }
type Quote = { id: string; cpqStatus: string; lines: QuoteLine[]; validationResult: { valid: boolean; errors: Array<{ message: string }> } }

async function post(request: APIRequestContext, token: string, path: string, data: Json): Promise<{ status: number; body: Json }> {
  const res = await apiRequest(request, 'POST', path, { token, data })
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Json }
}

async function createSpec(request: APIRequestContext, token: string, specType: 'simple' | 'bundle', label: string): Promise<string> {
  const { status, body } = await post(request, token, '/api/cpq/product-specifications', {
    code: `TC013-${label}-${uniq()}`, name: `TC-013 ${label}`, specType, lifecycleStatus: 'active',
  })
  expect(status, `create ${label} spec`).toBe(201)
  return body.id as string
}

async function createOffering(request: APIRequestContext, token: string, specId: string, label: string): Promise<Json> {
  // offeringType deliberately omitted: it must follow the specification (#122).
  const { status, body } = await post(request, token, '/api/cpq/product-offerings', {
    specId, code: `TC013-OFF-${label}-${uniq()}`, name: `TC-013 ${label}`, lifecycleStatus: 'active',
  })
  expect(status, `create ${label} offering: ${JSON.stringify(body)}`).toBe(201)
  return body
}

test.describe('TC-CPQ-013: bundle setup and bundle quoting (API)', () => {
  const cleanup: Array<() => Promise<unknown>> = []

  test.afterAll(async ({ request }) => {
    for (const run of cleanup.reverse()) await run().catch(() => undefined)
  })

  test('bundle offering, component re-add, default expansion, slot validation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const del = (path: string, id: string) => () => apiRequest(request, 'DELETE', path, { token, data: { id } })

    // ── Catalog: bundle "Fiber Home" with two required 1..1 slots ──────────
    const accessSpec = await createSpec(request, token, 'simple', 'access')
    const cpeSpec = await createSpec(request, token, 'simple', 'cpe')
    const bundleSpec = await createSpec(request, token, 'bundle', 'bundle')
    cleanup.push(del('/api/cpq/product-specifications', accessSpec), del('/api/cpq/product-specifications', cpeSpec), del('/api/cpq/product-specifications', bundleSpec))

    const accessSlot = await post(request, token, '/api/cpq/bundle-slots', {
      specId: bundleSpec, targetSpecId: accessSpec, componentGroup: 'access', name: 'Access', cardinalityMin: 1, cardinalityMax: 1,
    })
    const cpeSlot = await post(request, token, '/api/cpq/bundle-slots', {
      specId: bundleSpec, targetSpecId: cpeSpec, componentGroup: 'cpe', name: 'CPE', cardinalityMin: 1, cardinalityMax: 1,
    })
    expect(accessSlot.status).toBe(201)
    expect(cpeSlot.status).toBe(201)

    const fiber = await createOffering(request, token, accessSpec, 'fiber')
    const ont = await createOffering(request, token, cpeSpec, 'ont')
    const bundle = await createOffering(request, token, bundleSpec, 'bundle')
    cleanup.push(del('/api/cpq/product-offerings', fiber.id as string), del('/api/cpq/product-offerings', ont.id as string), del('/api/cpq/product-offerings', bundle.id as string))
    expect(fiber.offeringType).toBe('simple')
    expect(bundle.offeringType).toBe('bundle') // #122: derived from the bundle spec

    // ── #122: remove a component and add it back ────────────────────────────
    const first = await post(request, token, '/api/cpq/offering-components', {
      offeringId: bundle.id, slotId: accessSlot.body.id, childOfferingId: fiber.id, isDefault: true,
    })
    expect(first.status).toBe(201)
    const removed = await apiRequest(request, 'DELETE', '/api/cpq/offering-components', { token, data: { id: first.body.id } })
    expect(removed.ok()).toBeTruthy()
    const again = await post(request, token, '/api/cpq/offering-components', {
      offeringId: bundle.id, slotId: accessSlot.body.id, childOfferingId: fiber.id, isDefault: true,
    })
    expect(again.status, JSON.stringify(again.body)).toBe(201)
    const cpeComponent = await post(request, token, '/api/cpq/offering-components', {
      offeringId: bundle.id, slotId: cpeSlot.body.id, childOfferingId: ont.id, isDefault: true,
    })
    expect(cpeComponent.status).toBe(201)

    const missingSlot = await post(request, token, '/api/cpq/offering-components', {
      offeringId: bundle.id, slotId: '00000000-0000-4000-8000-000000000000', childOfferingId: ont.id,
    })
    expect(missingSlot.status).toBe(404) // was 500

    // ── #123 / #125: add the bundle with its defaults ───────────────────────
    const customerId = await seedCustomer(request, token, `TC-013-Co-${uniq()}`)
    cleanup.push(() => deleteCustomer(request, token, customerId))
    const created = await post(request, token, '/api/cpq/quotes', { customerId })
    expect(created.status).toBe(201)
    const quoteId = created.body.id as string

    const added = await post(request, token, `/api/cpq/quotes/${quoteId}/items`, {
      offeringId: bundle.id, configuration: {}, expandBundleDefaults: true,
    })
    expect(added.status, JSON.stringify(added.body)).toBe(201)
    const quote = added.body as unknown as Quote
    const bundleLine = quote.lines.find((l) => l.offeringId === bundle.id)!
    const children = quote.lines.filter((l) => l.parentLineId === bundleLine.lineId)
    expect(children.map((l) => l.offeringId).sort()).toEqual([fiber.id, ont.id].sort())
    // No charges on any offering: still configured (#125), bundle complete (#124).
    expect(quote.lines.every((l) => l.isConfigured)).toBe(true)
    expect(quote.cpqStatus).toBe('ready')

    // ── #124: remove the required CPE line ──────────────────────────────────
    const ontLine = children.find((l) => l.offeringId === ont.id)!
    const afterRemove = await apiRequest(request, 'DELETE', `/api/cpq/quotes/${quoteId}/items/${ontLine.lineId}`, { token })
    expect(afterRemove.ok()).toBeTruthy()
    const incomplete = (await afterRemove.json()) as Quote
    const bundleAfter = incomplete.lines.find((l) => l.lineId === bundleLine.lineId)!
    expect(incomplete.cpqStatus).toBe('incomplete')
    expect(bundleAfter.isConfigured).toBe(false)
    expect(bundleAfter.validationErrors?.[0]?.message).toMatch(/^V-QBUN-1: CPE requires at least 1/)

    const convert = await post(request, token, '/api/cpq/orders', { quoteId })
    expect(convert.status).toBe(422)
    expect(convert.body.error).toBe('BUNDLE_INCOMPLETE')
  })
})
