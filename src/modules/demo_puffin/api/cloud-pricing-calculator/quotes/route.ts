import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { proxyClient } from '../../../lib/public-calculator/proxy-client'
import { verifyLeadToken } from '../../../lib/public-calculator/lead-token'
import { reserveNonce, consumeNonce, releaseNonce, NonceConflictError } from '../../../lib/public-calculator/nonce-store'
import { getListedOfferingIds } from '../../../lib/public-calculator/offering-allowlist'
import { enforcePublicRateLimit } from '../../../lib/public-calculator/rate-limit'
import { PUFFIN_PUBLIC_OPENAPI_TAG } from '../../../lib/public-calculator/openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const itemSchema = z.object({
  lineKey: z.string().min(1),
  offeringId: z.string().uuid(),
  configuration: z.record(z.string(), z.unknown()).default({}),
  parentLineKey: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).max(10_000).optional(),
})

const requestSchema = z.object({
  currencyCode: z.string().min(1).default('USD'),
  quoteContext: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  items: z.array(itemSchema).min(1).max(50),
  notes: z.string().max(2000).optional(),
})

type CpqQuoteResponse = {
  id?: string
  quoteId?: string
  quoteNumber?: string
  cpqStatus?: string
  result?: {
    id?: string
    quoteId?: string
    quoteNumber?: string
    cpqStatus?: string
  }
}

function readQuoteId(payload: CpqQuoteResponse): string | null {
  return payload.id ?? payload.quoteId ?? payload.result?.id ?? payload.result?.quoteId ?? null
}

function readQuoteNumber(payload: CpqQuoteResponse): string | null {
  return payload.quoteNumber ?? payload.result?.quoteNumber ?? null
}

export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, { route: 'quotes' })
  if (limited) return limited

  const cfgResult = readPuffinPublicConfig()
  if (!cfgResult.ok) {
    return NextResponse.json({ error: 'public_calculator_not_configured' }, { status: 503 })
  }
  const config = cfgResult.config

  // ─── 1. Verify the visitor's lead JWT ────────────────────────────
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'missing_session_token' }, { status: 401 })
  }
  const verified = verifyLeadToken(token, config.leadJwtSecret)
  if (!verified.ok) {
    return NextResponse.json({ error: 'invalid_session_token', reason: verified.reason }, { status: 401 })
  }
  const { sub: customerId, jti, exp } = verified.payload

  // ─── 2. Reserve nonce ────────────────────────────────────────────
  try {
    reserveNonce(jti, exp - Math.floor(Date.now() / 1000))
  } catch (err) {
    if (err instanceof NonceConflictError) {
      return NextResponse.json({ error: 'session_token_already_used' }, { status: 409 })
    }
    throw err
  }

  // ─── 3. Validate request body ────────────────────────────────────
  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await req.json())
  } catch (err) {
    releaseNonce(jti)
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation_error', details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // ─── 4. Defence-in-depth: verify all offering IDs are in the allowlist
  let allowlist: Set<string>
  try {
    allowlist = await getListedOfferingIds(config)
  } catch {
    releaseNonce(jti)
    return NextResponse.json({ error: 'public_calculator_admin_login_failed' }, { status: 503 })
  }
  for (const item of body.items) {
    if (!allowlist.has(item.offeringId)) {
      releaseNonce(jti)
      return NextResponse.json(
        { error: 'offering_not_listed', lineKey: item.lineKey, offeringId: item.offeringId },
        { status: 400 },
      )
    }
  }

  // ─── 5. Create quote ─────────────────────────────────────────────
  const quoteContextWithBundle = {
    ...body.quoteContext,
    public_calculator: true,
  }

  const createRes = await proxyClient.post<CpqQuoteResponse>(config, '/api/cpq/quotes', {
    customerId,
    currencyCode: body.currencyCode,
    quoteContext: quoteContextWithBundle,
  })
  if (!createRes.ok) {
    releaseNonce(jti)
    return NextResponse.json(
      { error: 'public_calculator_quote_create_failed', details: createRes.details },
      { status: 502 },
    )
  }
  const quoteId = readQuoteId(createRes.data)
  if (!quoteId) {
    releaseNonce(jti)
    return NextResponse.json({ error: 'quote_id_missing_from_response' }, { status: 502 })
  }

  // ─── 6. Add items ────────────────────────────────────────────────
  const lineKeyToServerLineId = new Map<string, string>()
  for (const item of body.items) {
    const parentLineId = item.parentLineKey ? lineKeyToServerLineId.get(item.parentLineKey) ?? undefined : undefined

    const itemRes = await proxyClient.post<{ result?: { lineId?: string }; lineId?: string }>(
      config,
      `/api/cpq/quotes/${quoteId}/items`,
      {
        offeringId: item.offeringId,
        configuration: { ...quoteContextWithBundle, ...item.configuration },
        quantity: item.quantity ?? 1,
        action: 'add',
        ...(parentLineId ? { parentLineId } : {}),
      },
    )
    if (!itemRes.ok) {
      releaseNonce(jti)
      return NextResponse.json(
        {
          error: 'public_calculator_quote_item_failed',
          lineKey: item.lineKey,
          details: itemRes.details,
        },
        { status: 502 },
      )
    }
    const lineId = itemRes.data.lineId ?? itemRes.data.result?.lineId
    if (lineId) lineKeyToServerLineId.set(item.lineKey, lineId)
  }

  // ─── 7. Transition to with_customer ──────────────────────────────
  // CPQ auto-manages new → incomplete → ready as items land via the
  // recalculate pass on every /items POST. So the quote is normally
  // already in 'ready' by now — explicitly transitioning to 'ready' would
  // hit the `ready → ready` guard and 409. Best-effort the 'ready' bump
  // (covers the rare case where the quote stuck in 'incomplete' because
  // validation flagged something), then drive the final 'with_customer'.
  const readyAttempt = await proxyClient.post<CpqQuoteResponse>(
    config,
    `/api/cpq/quotes/${quoteId}/status`,
    { targetStatus: 'ready' },
  )
  if (!readyAttempt.ok && readyAttempt.status !== 409) {
    releaseNonce(jti)
    return NextResponse.json(
      {
        error: 'public_calculator_quote_transition_failed',
        targetStatus: 'ready',
        details: readyAttempt.details,
      },
      { status: 502 },
    )
  }

  const finalAttempt = await proxyClient.post<CpqQuoteResponse>(
    config,
    `/api/cpq/quotes/${quoteId}/status`,
    { targetStatus: 'with_customer' },
  )
  if (!finalAttempt.ok) {
    releaseNonce(jti)
    return NextResponse.json(
      {
        error: 'public_calculator_quote_transition_failed',
        targetStatus: 'with_customer',
        details: finalAttempt.details,
      },
      { status: 502 },
    )
  }

  consumeNonce(jti)

  const quoteNumber = readQuoteNumber(createRes.data) ?? quoteId
  return NextResponse.json({
    quoteId,
    quoteNumber,
    status: 'with_customer',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: PUFFIN_PUBLIC_OPENAPI_TAG,
  summary: 'Public calculator quote conversion',
  methods: {
    POST: {
      summary: 'Create a CpqQuoteConfiguration in `with_customer` status from the visitor cart. Single-use, JWT-bound.',
      tags: [PUFFIN_PUBLIC_OPENAPI_TAG],
      requestBody: { schema: requestSchema },
      responses: [
        {
          status: 200,
          schema: z.object({ quoteId: z.string(), quoteNumber: z.string(), status: z.string() }),
        },
      ],
      errors: [
        { status: 400, schema: z.object({ error: z.string() }), description: 'Validation error' },
        { status: 401, schema: z.object({ error: z.string() }), description: 'Missing or invalid session token' },
        { status: 409, schema: z.object({ error: z.string() }), description: 'Session token already used' },
        { status: 429, schema: z.object({ error: z.string() }), description: 'Rate limit exceeded' },
        { status: 502, schema: z.object({ error: z.string() }), description: 'Upstream proxy error' },
        { status: 503, schema: z.object({ error: z.string() }), description: 'Public calculator not configured or admin login failed' },
      ],
    },
  },
}
