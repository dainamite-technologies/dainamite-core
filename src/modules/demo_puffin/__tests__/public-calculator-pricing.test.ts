import {
  _resetOfferingAllowlistForTests,
  getListedOfferingIds,
  isOfferingListed,
} from '../lib/public-calculator/offering-allowlist'
import { _resetPuffinAdminSessionForTests } from '../lib/public-calculator/admin-session'

const ADMIN_TOKEN_PAYLOAD = Buffer.from(
  JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 7 * 60 * 60 }),
)
  .toString('base64')
  .replace(/=/g, '')
const FAKE_JWT = `eyJ.${ADMIN_TOKEN_PAYLOAD}.sig`

function makeConfig() {
  return {
    baseUrl: 'http://localhost:3000',
    adminEmail: 'admin@puffin.com',
    adminPassword: 'secret',
    leadJwtSecret: 'a'.repeat(40),
    leadJwtTtlSeconds: 600,
    defaultRegion: 'fra1',
    captcha: { provider: 'disabled' as const },
    rateBudgets: { price: 120, attributes: 60, leads: 5, quotes: 3 },
  }
}

function buildOfferingsPage(items: Array<{ id: string; metadata?: Record<string, unknown>; lifecycleStatus?: string; isActive?: boolean }>): {
  items: typeof items
  total: number
  page: number
  pageSize: number
  totalPages: number
} {
  return { items, total: items.length, page: 1, pageSize: 100, totalPages: 1 }
}

describe('getListedOfferingIds', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    _resetOfferingAllowlistForTests()
    _resetPuffinAdminSessionForTests()
    global.fetch = originalFetch
  })

  it('returns only offerings flagged listedInCalculator and active', async () => {
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify({ ok: true, token: FAKE_JWT }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/cpq/product-offerings')) {
        const offerings = [
          { id: 'a', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true },
          { id: 'b', metadata: {}, lifecycleStatus: 'active', isActive: true },
          { id: 'c', metadata: { listedInCalculator: true }, lifecycleStatus: 'draft', isActive: true },
          { id: 'd', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: false },
        ]
        const idMatch = url.match(/[?&]id=([^&]+)/)
        if (idMatch) {
          const offering = offerings.find((o) => o.id === idMatch[1])
          if (offering) {
            return new Response(JSON.stringify(offering), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
          return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
        }
        return new Response(JSON.stringify(buildOfferingsPage(offerings)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/cpq/product-specifications')) {
        return new Response(
          JSON.stringify({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const ids = await getListedOfferingIds(makeConfig())
    expect(Array.from(ids)).toEqual(['a'])
  })

  it('caches results across concurrent calls (issues one offerings list call)', async () => {
    let listingCalls = 0
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify({ ok: true, token: FAKE_JWT }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/cpq/product-offerings')) {
        // Only count the list call (no `id=` query param) — the new shared
        // catalog cache also makes per-offering detail calls during hydrate,
        // and the test only asserts that the list isn't refetched on each
        // concurrent caller.
        if (!url.includes('id=')) listingCalls += 1
        if (url.includes('id=')) {
          return new Response(
            JSON.stringify({ id: 'a', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify(
            buildOfferingsPage([
              { id: 'a', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true },
            ]),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('/api/cpq/product-specifications')) {
        return new Response(
          JSON.stringify({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const cfg = makeConfig()
    const [a, b, c] = await Promise.all([
      getListedOfferingIds(cfg),
      getListedOfferingIds(cfg),
      isOfferingListed(cfg, 'a'),
    ])
    expect(a.has('a')).toBe(true)
    expect(b.has('a')).toBe(true)
    expect(c).toBe(true)
    expect(listingCalls).toBe(1)
  })
})
