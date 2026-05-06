/**
 * Direct route-handler tests for /api/demo_puffin/cloud-pricing-calculator/price.
 * Exercises the items[]→primaryItem+childItems translation, quoteContext
 * merging, the offering allowlist gate, and the validationErrors output for
 * unlisted offerings.
 */

// `@open-mercato/core/bootstrap` transitively pulls meilisearch (ESM) which
// Jest can't parse. We don't exercise rate-limit logic in route tests, so a
// no-op mock is sufficient.
jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: () => null,
}))

import { _resetOfferingAllowlistForTests } from '../lib/public-calculator/offering-allowlist'
import { _resetPuffinAdminSessionForTests } from '../lib/public-calculator/admin-session'

const FAKE_JWT_PAYLOAD = Buffer.from(
  JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 7 * 60 * 60 }),
)
  .toString('base64')
  .replace(/=/g, '')
const FAKE_JWT = `eyJ.${FAKE_JWT_PAYLOAD}.sig`

const VPS_ATLANTIC_ID = '11111111-1111-4111-8111-111111111111'
const CDN_ID = '22222222-2222-4222-8222-222222222222'
const UNLISTED_ID = '33333333-3333-4333-8333-333333333333'

function postBody(body: unknown): Request {
  return new Request('http://localhost:3000/api/demo_puffin/cloud-pricing-calculator/price', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type CapturedCpqRequest = {
  url: string
  body: unknown
}

type FetchMockOptions = {
  capturePriceRequest: (req: CapturedCpqRequest) => void
  priceResponse?: unknown
  loginShouldFail?: boolean
}

function installFetchMock(opts: FetchMockOptions) {
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/auth/login')) {
      if (opts.loginShouldFail) {
        return new Response(JSON.stringify({ ok: false, error: 'Bad creds' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: true, token: FAKE_JWT }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/cpq/product-offerings')) {
      const offerings = [
        { id: VPS_ATLANTIC_ID, metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true },
        { id: CDN_ID, metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true },
        { id: UNLISTED_ID, metadata: {}, lifecycleStatus: 'active', isActive: true },
      ]
      // Detail-by-id (used by the shared catalog cache hydrate pass).
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
    if (url.includes('/api/cpq/quotes/price')) {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      opts.capturePriceRequest({ url, body })
      const response = opts.priceResponse ?? {
        primaryCharges: [
          { chargeCode: 'mrc_flat', chargeName: 'MRC', chargeType: 'mrc', pricingMethod: 'flat', unitPrice: 24, totalPrice: 24 },
          { chargeCode: 'nrc_setup', chargeName: 'Setup', chargeType: 'nrc', pricingMethod: 'flat', unitPrice: 5, totalPrice: 5 },
        ],
        childItems: [
          {
            offeringId: CDN_ID,
            productId: null,
            charges: [
              { chargeCode: 'cdn_egress', chargeName: 'CDN Egress', chargeType: 'usage', pricingMethod: 'tiered', unitPrice: 0.05, totalPrice: null, note: 'Per GB' },
            ],
          },
        ],
        totals: { nrcTotal: 5, mrcTotal: 24, usageCharges: [] },
        currencyCode: 'USD',
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

describe('POST /api/demo_puffin/cloud-pricing-calculator/price', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    _resetOfferingAllowlistForTests()
    _resetPuffinAdminSessionForTests()
    process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET = 'a'.repeat(40)
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  it('translates items[] into CPQ primaryItem + childItems and merges quoteContext.public_calculator', async () => {
    let capturedBody: unknown = null
    installFetchMock({
      capturePriceRequest: (req) => {
        capturedBody = req.body
      },
    })

    const { POST } = await import('../api/cloud-pricing-calculator/price/route')
    const response = await POST(
      postBody({
        currencyCode: 'USD',
        quoteContext: { contract_model: 'on_demand' },
        items: [
          {
            lineKey: 'l-vps',
            offeringId: VPS_ATLANTIC_ID,
            configuration: { region: 'fra1' },
          },
          {
            lineKey: 'l-cdn',
            offeringId: CDN_ID,
            configuration: { tier: 'standard' },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as { lines: Array<{ lineKey: string; mrcTotal: number; nrcTotal: number }> }
    expect(json.lines).toHaveLength(2)
    expect(json.lines[0]).toMatchObject({ lineKey: 'l-vps', mrcTotal: 24, nrcTotal: 5 })

    const cpq = capturedBody as {
      currencyCode: string
      primaryItem: { offeringId: string; configuration: Record<string, unknown> }
      childItems: Array<{ offeringId: string; configuration: Record<string, unknown> }>
    }
    expect(cpq.currencyCode).toBe('USD')
    expect(cpq.primaryItem.offeringId).toBe(VPS_ATLANTIC_ID)
    expect(cpq.primaryItem.configuration).toMatchObject({
      region: 'fra1',
      contract_model: 'on_demand',
      public_calculator: true,
    })
    expect(cpq.childItems).toHaveLength(1)
    expect(cpq.childItems[0].offeringId).toBe(CDN_ID)
    expect(cpq.childItems[0].configuration).toMatchObject({
      tier: 'standard',
      contract_model: 'on_demand',
      public_calculator: true,
    })
  })

  it('rejects unlisted offerings with validationErrors instead of forwarding them', async () => {
    let capturedBody: unknown = null
    installFetchMock({
      capturePriceRequest: (req) => {
        capturedBody = req.body
      },
    })

    const { POST } = await import('../api/cloud-pricing-calculator/price/route')
    const response = await POST(
      postBody({
        items: [
          {
            lineKey: 'l-vps',
            offeringId: VPS_ATLANTIC_ID,
            configuration: { region: 'fra1' },
          },
          {
            lineKey: 'l-bad',
            offeringId: UNLISTED_ID,
            configuration: {},
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      lines: Array<{ lineKey: string }>
      validationErrors: Array<{ lineKey: string; reason: string }>
    }
    expect(json.lines.map((l) => l.lineKey)).toEqual(['l-vps'])
    expect(json.validationErrors).toContainEqual({ lineKey: 'l-bad', reason: 'offering_not_listed' })

    // Unlisted offering must NOT have been forwarded to CPQ at all.
    const cpq = capturedBody as { childItems: unknown[] }
    expect(cpq.childItems).toEqual([])
  })

  it('returns 503 when the calculator is not configured', async () => {
    delete process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET
    const { POST } = await import('../api/cloud-pricing-calculator/price/route')
    const response = await POST(
      postBody({
        items: [{ lineKey: 'l-1', offeringId: VPS_ATLANTIC_ID }],
      }),
    )
    expect(response.status).toBe(503)
  })

  it('returns 400 on invalid body', async () => {
    const { POST } = await import('../api/cloud-pricing-calculator/price/route')
    const response = await POST(postBody({ items: [{ lineKey: 'x' }] }))
    expect(response.status).toBe(400)
  })
})
