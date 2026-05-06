import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { proxyClient } from '../../../lib/public-calculator/proxy-client'
import { getListedOfferingIds } from '../../../lib/public-calculator/offering-allowlist'
import { enforcePublicRateLimit } from '../../../lib/public-calculator/rate-limit'
import { PUFFIN_PUBLIC_OPENAPI_TAG } from '../../../lib/public-calculator/openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const requestSchema = z.object({
  offeringId: z.string().uuid(),
  configuration: z.record(z.string(), z.unknown()).default({}),
})

type AttributeOption = { value: string; label: string }
type Attribute = {
  id: string
  code: string
  name: string
  attributeType: string
  resolutionTime?: string
  isRequired: boolean
  options: AttributeOption[] | null
  constraints: Record<string, unknown> | null
  defaultValue: unknown
  helpText: string | null
}

export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, { route: 'attributes' })
  if (limited) return limited

  const cfgResult = readPuffinPublicConfig()
  if (!cfgResult.ok) {
    return NextResponse.json({ error: 'public_calculator_not_configured' }, { status: 503 })
  }
  const config = cfgResult.config

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation_error', details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  let allowlist: Set<string>
  try {
    allowlist = await getListedOfferingIds(config)
  } catch {
    return NextResponse.json({ error: 'public_calculator_admin_login_failed' }, { status: 503 })
  }
  if (!allowlist.has(body.offeringId)) {
    return NextResponse.json({ error: 'offering_not_listed' }, { status: 404 })
  }

  const proxied = await proxyClient.get<{ attributes: Attribute[] }>(
    config,
    '/api/cpq/quotes/attributes',
    {
      offeringId: body.offeringId,
      configuration: JSON.stringify(body.configuration),
    },
  )
  if (!proxied.ok) {
    const status = proxied.status === 401 ? 503 : 502
    return NextResponse.json(
      {
        error: status === 503 ? 'public_calculator_admin_login_failed' : 'public_calculator_attributes_failed',
        details: proxied.details,
      },
      { status },
    )
  }

  // Filter to run-time attributes only — design-time values are baked into
  // designTimeValues on the offering already and shouldn't be exposed for the
  // visitor to override.
  const attributes = (proxied.data.attributes ?? []).filter(
    (a) => !a.resolutionTime || a.resolutionTime === 'run_time',
  )

  return NextResponse.json({ attributes })
}

export const openApi: OpenApiRouteDoc = {
  tag: PUFFIN_PUBLIC_OPENAPI_TAG,
  summary: 'Public attribute resolution',
  methods: {
    POST: {
      summary: 'Resolve dependent run-time attributes for a partial configuration.',
      tags: [PUFFIN_PUBLIC_OPENAPI_TAG],
      requestBody: { schema: requestSchema },
      responses: [
        {
          status: 200,
          schema: z.object({
            attributes: z.array(z.record(z.string(), z.unknown())),
          }),
        },
      ],
      errors: [
        { status: 400, schema: z.object({ error: z.string() }), description: 'Validation error' },
        { status: 404, schema: z.object({ error: z.string() }), description: 'Offering not listed in calculator' },
        { status: 429, schema: z.object({ error: z.string() }), description: 'Rate limit exceeded' },
        { status: 502, schema: z.object({ error: z.string() }), description: 'Upstream proxy error' },
        { status: 503, schema: z.object({ error: z.string() }), description: 'Public calculator not configured or admin login failed' },
      ],
    },
  },
}
