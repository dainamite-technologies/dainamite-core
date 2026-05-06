import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { proxyClient } from '../../../lib/public-calculator/proxy-client'
import { signLeadToken } from '../../../lib/public-calculator/lead-token'
import { createCaptchaVerifier } from '../../../lib/public-calculator/captcha'
import { enforcePublicRateLimit } from '../../../lib/public-calculator/rate-limit'
import { PUFFIN_PUBLIC_OPENAPI_TAG } from '../../../lib/public-calculator/openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const requestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  company: z.string().trim().min(1).max(200),
  captchaToken: z.string().optional(),
})

type CompanyCreateResponse = {
  id?: string
  data?: { id?: string }
  item?: { id?: string }
}

function extractCompanyId(payload: CompanyCreateResponse): string | null {
  return payload.id ?? payload.data?.id ?? payload.item?.id ?? null
}

export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, { route: 'leads' })
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

  const captcha = createCaptchaVerifier(config)
  const captchaResult = await captcha.verify(body.captchaToken, 'lead_submit')
  if (!captchaResult.ok) {
    return NextResponse.json(
      { error: 'captcha_failed', reason: captchaResult.reason, score: captchaResult.score },
      { status: 400 },
    )
  }

  // Create or upsert the lead via the authenticated customers API. The route
  // uses `withScopedPayload` so tenant/organization come from the admin
  // token automatically — we don't pass them explicitly.
  const customerPayload: Record<string, unknown> = {
    displayName: body.company,
    primaryEmail: body.email,
    lifecycleStage: 'lead',
    source: 'public_calculator',
    description: `Public calculator lead. Contact: ${body.name} <${body.email}>`,
  }

  const created = await proxyClient.post<CompanyCreateResponse>(
    config,
    '/api/customers/companies',
    customerPayload,
  )

  if (!created.ok) {
    if (created.status === 409) {
      // Duplicate email — treat as success and re-issue a token. The customer
      // service should idempotently return the existing record. The path here
      // depends on what the customer route returns; for now we surface 409.
      return NextResponse.json({ error: 'duplicate_lead' }, { status: 409 })
    }
    if (created.status === 401 || created.status === 503) {
      return NextResponse.json({ error: 'public_calculator_admin_login_failed' }, { status: 503 })
    }
    return NextResponse.json(
      { error: 'public_calculator_lead_failed', details: created.details },
      { status: 502 },
    )
  }

  const customerId = extractCompanyId(created.data)
  if (!customerId) {
    return NextResponse.json({ error: 'lead_id_missing_from_response' }, { status: 502 })
  }

  const { token, expiresAt } = signLeadToken({
    customerId,
    ttlSeconds: config.leadJwtTtlSeconds,
    secret: config.leadJwtSecret,
  })

  return NextResponse.json({
    quoteSessionToken: token,
    expiresAt: expiresAt.toISOString(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: PUFFIN_PUBLIC_OPENAPI_TAG,
  summary: 'Public calculator lead capture',
  methods: {
    POST: {
      summary: 'Create or upsert a lead from the public calculator and issue a short-lived quoteSessionToken.',
      tags: [PUFFIN_PUBLIC_OPENAPI_TAG],
      requestBody: { schema: requestSchema },
      responses: [
        {
          status: 200,
          schema: z.object({
            quoteSessionToken: z.string(),
            expiresAt: z.string(),
          }),
        },
      ],
      errors: [
        { status: 400, schema: z.object({ error: z.string() }), description: 'Validation or captcha error' },
        { status: 409, schema: z.object({ error: z.string() }), description: 'Duplicate lead' },
        { status: 429, schema: z.object({ error: z.string() }), description: 'Rate limit exceeded' },
        { status: 502, schema: z.object({ error: z.string() }), description: 'Upstream proxy error' },
        { status: 503, schema: z.object({ error: z.string() }), description: 'Public calculator not configured or admin login failed' },
      ],
    },
  },
}
