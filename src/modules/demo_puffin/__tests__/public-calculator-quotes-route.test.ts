/**
 * Direct route-handler tests for /api/demo_puffin/cloud-pricing-calculator/quotes.
 * Focus: JWT verification, nonce single-use enforcement, allowlist gate, and
 * the create→items→ready→with_customer chain. Network calls are mocked.
 */

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: () => null,
}))

import { _resetOfferingAllowlistForTests } from '../lib/public-calculator/offering-allowlist'
import { _resetPuffinAdminSessionForTests } from '../lib/public-calculator/admin-session'
import { _resetNonceStoreForTests } from '../lib/public-calculator/nonce-store'
import { signLeadToken } from '../lib/public-calculator/lead-token'

const SECRET = 'a'.repeat(40)
const VPS_ATLANTIC_ID = '11111111-1111-4111-8111-111111111111'
const CDN_ID = '22222222-2222-4222-8222-222222222222'
const UNLISTED_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444'
const QUOTE_ID = '55555555-5555-5555-5555-555555555555'

const FAKE_ADMIN_PAYLOAD = Buffer.from(
  JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 7 * 60 * 60 }),
)
  .toString('base64')
  .replace(/=/g, '')
const FAKE_ADMIN_JWT = `eyJ.${FAKE_ADMIN_PAYLOAD}.sig`

type ChainCall = { url: string; method?: string; body: unknown }

function installFetchMock(opts: {
  onCall: (call: ChainCall) => void
  itemFails?: boolean
  transitionFailsAt?: 'ready' | 'with_customer'
}) {
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let body: unknown = null
    if (init?.body) {
      const raw = String(init.body)
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    opts.onCall({ url, method, body })

    if (url.includes('/api/auth/login')) {
      return new Response(JSON.stringify({ ok: true, token: FAKE_ADMIN_JWT }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/cpq/product-offerings')) {
      const offerings = [
        { id: VPS_ATLANTIC_ID, metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true },
        { id: CDN_ID, metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true },
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
      return new Response(
        JSON.stringify({
          items: offerings,
          total: offerings.length,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/api/cpq/product-specifications')) {
      return new Response(
        JSON.stringify({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/api/cpq/quotes/') && url.endsWith('/status')) {
      const targetStatus = (body as { targetStatus?: string } | null)?.targetStatus
      if (opts.transitionFailsAt && opts.transitionFailsAt === targetStatus) {
        return new Response(JSON.stringify({ error: `cannot_go_to_${targetStatus}` }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ id: QUOTE_ID, cpqStatus: targetStatus }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/cpq/quotes/') && url.endsWith('/items')) {
      if (opts.itemFails) {
        return new Response(JSON.stringify({ error: 'add_item_failed' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ result: { lineId: `line-${Math.random().toString(36).slice(2)}` } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/api/cpq/quotes')) {
      return new Response(JSON.stringify({ id: QUOTE_ID, quoteNumber: 'Q-2026-00042', cpqStatus: 'new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

function postBody(token: string, body: unknown): Request {
  return new Request('http://localhost:3000/api/demo_puffin/cloud-pricing-calculator/quotes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/demo_puffin/cloud-pricing-calculator/quotes', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    _resetOfferingAllowlistForTests()
    _resetPuffinAdminSessionForTests()
    _resetNonceStoreForTests()
    process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET = SECRET
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  it('rejects requests with no Authorization header (401)', async () => {
    installFetchMock({ onCall: () => undefined })
    const { POST } = await import('../api/cloud-pricing-calculator/quotes/route')
    const res = await POST(
      new Request('http://localhost:3000/api/demo_puffin/cloud-pricing-calculator/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }] }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects an invalid JWT signature', async () => {
    installFetchMock({ onCall: () => undefined })
    const { POST } = await import('../api/cloud-pricing-calculator/quotes/route')
    const { token } = signLeadToken({ customerId: CUSTOMER_ID, ttlSeconds: 600, secret: 'b'.repeat(40) })
    const res = await POST(postBody(token, { items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }] }))
    expect(res.status).toBe(401)
  })

  it('chains create → items → ready → with_customer on the happy path', async () => {
    const calls: ChainCall[] = []
    installFetchMock({ onCall: (c) => calls.push(c) })
    const { POST } = await import('../api/cloud-pricing-calculator/quotes/route')
    const { token } = signLeadToken({ customerId: CUSTOMER_ID, ttlSeconds: 600, secret: SECRET })

    const res = await POST(
      postBody(token, {
        currencyCode: 'USD',
        quoteContext: { contract_model: 'on_demand' },
        items: [
          { lineKey: 'l-vps', offeringId: VPS_ATLANTIC_ID, configuration: { region: 'fra1' } },
          { lineKey: 'l-cdn', offeringId: CDN_ID, configuration: {} },
        ],
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { quoteId: string; quoteNumber: string; status: string }
    expect(json.status).toBe('with_customer')
    expect(json.quoteNumber).toBe('Q-2026-00042')

    const cpqCalls = calls.filter((c) => c.url.includes('/api/cpq'))
    const create = cpqCalls.find((c) => c.url.endsWith('/api/cpq/quotes') && c.method === 'POST')
    expect(create).toBeDefined()
    expect((create!.body as Record<string, unknown>).customerId).toBe(CUSTOMER_ID)

    const items = cpqCalls.filter((c) => c.url.endsWith('/items'))
    expect(items).toHaveLength(2)

    const transitions = cpqCalls.filter((c) => c.url.endsWith('/status'))
    expect(transitions).toHaveLength(2)
    expect((transitions[0].body as Record<string, unknown>).targetStatus).toBe('ready')
    expect((transitions[1].body as Record<string, unknown>).targetStatus).toBe('with_customer')
  })

  it('replays return 409', async () => {
    installFetchMock({ onCall: () => undefined })
    const { POST } = await import('../api/cloud-pricing-calculator/quotes/route')
    const { token } = signLeadToken({ customerId: CUSTOMER_ID, ttlSeconds: 600, secret: SECRET })

    const first = await POST(postBody(token, { items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }] }))
    expect(first.status).toBe(200)

    const second = await POST(postBody(token, { items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }] }))
    expect(second.status).toBe(409)
  })

  it('rejects unlisted offerings even with a valid token', async () => {
    installFetchMock({ onCall: () => undefined })
    const { POST } = await import('../api/cloud-pricing-calculator/quotes/route')
    const { token } = signLeadToken({ customerId: CUSTOMER_ID, ttlSeconds: 600, secret: SECRET })

    const res = await POST(postBody(token, { items: [{ lineKey: 'l-bad', offeringId: UNLISTED_ID }] }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('offering_not_listed')
  })

  it('releases the nonce on item failure so the visitor can retry', async () => {
    installFetchMock({ onCall: () => undefined, itemFails: true })
    const { POST } = await import('../api/cloud-pricing-calculator/quotes/route')
    const { token } = signLeadToken({ customerId: CUSTOMER_ID, ttlSeconds: 600, secret: SECRET })

    const first = await POST(postBody(token, { items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }] }))
    expect(first.status).toBe(502)

    // Same JWT must still be reservable — the nonce was released.
    installFetchMock({ onCall: () => undefined })
    const second = await POST(postBody(token, { items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }] }))
    expect(second.status).toBe(200)
  })
})
