import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { getCachedCatalog, getStaleCatalogIfAny } from '../../../lib/public-calculator/catalog-cache'
import { enforcePublicRateLimit } from '../../../lib/public-calculator/rate-limit'
import { PUFFIN_PUBLIC_OPENAPI_TAG } from '../../../lib/public-calculator/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  const limited = await enforcePublicRateLimit(req, { route: 'catalog' })
  if (limited) return limited

  const result = readPuffinPublicConfig()
  if (!result.ok) {
    return NextResponse.json({ error: 'public_calculator_not_configured' }, { status: 503 })
  }
  const { config } = result

  try {
    const catalog = await getCachedCatalog(config)
    return NextResponse.json(catalog, {
      status: 200,
      headers: { 'cache-control': 'public, max-age=60, s-maxage=60' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error'
    if (message.startsWith('admin_login') || message.includes('admin_login')) {
      return NextResponse.json({ error: 'public_calculator_admin_login_failed' }, { status: 503 })
    }

    // Degraded mode: serve any prior cached payload (even expired) so the
    // page stays usable when Postgres is overloaded.
    const stale = getStaleCatalogIfAny()
    if (stale) {
      console.warn('[puffin-public-calculator] catalog refresh failed, serving stale:', message)
      return NextResponse.json(stale, {
        status: 200,
        headers: { 'cache-control': 'public, max-age=10, s-maxage=10', 'x-puffin-stale': 'true' },
      })
    }

    console.error('[puffin-public-calculator] catalog fetch failed:', err)
    return NextResponse.json(
      { error: 'public_calculator_catalog_failed', detail: message },
      { status: 502 },
    )
  }
}

const catalogResponseSchema = z.object({
  tenantSlug: z.literal('puffin'),
  currencyCode: z.string(),
  regions: z.array(z.object({ code: z.string(), label: z.string() })),
  specifications: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      tagline: z.string().nullable(),
      specType: z.string(),
      uiPattern: z.string(),
      offerings: z.array(
        z.object({
          id: z.string(),
          code: z.string(),
          marketingName: z.string(),
          fromPriceMonthly: z.number().nullable(),
        }),
      ),
    }),
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: PUFFIN_PUBLIC_OPENAPI_TAG,
  summary: 'Public catalog feed for the Puffin pricing calculator',
  methods: {
    GET: {
      summary: 'Returns offerings flagged listedInCalculator=true for the Puffin tenant',
      tags: [PUFFIN_PUBLIC_OPENAPI_TAG],
      responses: [{ status: 200, schema: catalogResponseSchema }],
      errors: [
        { status: 429, schema: z.object({ error: z.string() }), description: 'Rate limit exceeded' },
        { status: 502, schema: z.object({ error: z.string() }), description: 'Upstream proxy error' },
        { status: 503, schema: z.object({ error: z.string() }), description: 'Public calculator not configured or admin login failed' },
      ],
    },
  },
}
