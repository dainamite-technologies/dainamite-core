import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { enforcePublicRateLimit } from '../../../lib/public-calculator/rate-limit'
import { PUFFIN_PUBLIC_OPENAPI_TAG } from '../../../lib/public-calculator/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

const configResponseSchema = z.object({
  currencyCode: z.string(),
  defaultRegion: z.string(),
  pricingDebounceMs: z.number(),
  captcha: z.object({
    provider: z.enum(['disabled', 'recaptcha_v3']),
    siteKey: z.string().optional(),
  }),
})

const configErrorSchema = z.object({
  error: z.string(),
  missing: z.array(z.string()).optional(),
  invalid: z.array(z.string()).optional(),
})

export async function GET(req: Request) {
  const limited = await enforcePublicRateLimit(req, { route: 'config' })
  if (limited) return limited

  const result = readPuffinPublicConfig()
  if (!result.ok) {
    return NextResponse.json(
      { error: 'public_calculator_not_configured', missing: result.error.missing, invalid: result.error.invalid },
      { status: 503 },
    )
  }

  const { config } = result
  return NextResponse.json({
    currencyCode: 'USD',
    defaultRegion: config.defaultRegion,
    pricingDebounceMs: 250,
    captcha:
      config.captcha.provider === 'recaptcha_v3'
        ? { provider: 'recaptcha_v3' as const, siteKey: config.captcha.siteKey }
        : { provider: 'disabled' as const },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: PUFFIN_PUBLIC_OPENAPI_TAG,
  summary: 'Public calculator configuration',
  methods: {
    GET: {
      summary: 'Frontend-safe configuration for the Puffin public pricing calculator',
      tags: [PUFFIN_PUBLIC_OPENAPI_TAG],
      responses: [{ status: 200, schema: configResponseSchema }],
      errors: [
        { status: 429, schema: z.object({ error: z.string() }), description: 'Rate limit exceeded' },
        { status: 503, schema: configErrorSchema, description: 'Public calculator not configured' },
      ],
    },
  },
}
