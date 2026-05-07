import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readPuffinPublicConfig } from '../../../lib/public-calculator/env'
import { proxyClient } from '../../../lib/public-calculator/proxy-client'
import { getListedOfferingIds } from '../../../lib/public-calculator/offering-allowlist'
import { getOfferingCodeMap } from '../../../lib/public-calculator/catalog-cache'
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
  items: z.array(itemSchema).max(50),
})

export type PublicPriceRequest = z.infer<typeof requestSchema>

type CpqResolvedCharge = {
  chargeCode: string
  chargeName: string
  chargeType: string
  pricingMethod: string
  unitPrice: number | null
  quantity?: number
  totalPrice: number | null
  note?: string
}

type CpqPriceResponse = {
  primaryCharges: CpqResolvedCharge[]
  childItems: Array<{ offeringId: string | null; productId: string | null; charges: CpqResolvedCharge[] }>
  totals: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number | null; note: string }>
  }
  currencyCode: string
}

type LineResult = {
  lineKey: string
  offeringId: string
  parentLineKey: string | null
  quantity: number
  charges: CpqResolvedCharge[]
  nrcTotal: number
  mrcTotal: number
  usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number | null; note: string }>
}

function sumCharges(charges: CpqResolvedCharge[]): { nrc: number; mrc: number; usage: LineResult['usageCharges'] } {
  let nrc = 0
  let mrc = 0
  const usage: LineResult['usageCharges'] = []
  for (const c of charges) {
    if (c.chargeType === 'nrc' && typeof c.totalPrice === 'number') nrc += c.totalPrice
    else if (c.chargeType === 'mrc' && typeof c.totalPrice === 'number') mrc += c.totalPrice
    else if (c.chargeType === 'usage') {
      usage.push({
        chargeCode: c.chargeCode,
        chargeName: c.chargeName,
        unitPrice: c.unitPrice ?? null,
        note: c.note ?? 'Usage-based charge — billed on actual consumption.',
      })
    }
  }
  return { nrc, mrc, usage }
}

export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, { route: 'price' })
  if (limited) return limited

  const cfgResult = readPuffinPublicConfig()
  if (!cfgResult.ok) {
    return NextResponse.json({ error: 'public_calculator_not_configured' }, { status: 503 })
  }
  const config = cfgResult.config

  let body: PublicPriceRequest
  try {
    body = requestSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation_error', details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Defence in depth: visitor cannot price unlisted offerings.
  let allowlist: Set<string>
  let offeringCodes: Map<string, string>
  try {
    allowlist = await getListedOfferingIds(config)
    offeringCodes = await getOfferingCodeMap(config)
  } catch (err) {
    console.error('[puffin-public-calculator] /price allowlist fetch failed:', err)
    return NextResponse.json({ error: 'public_calculator_admin_login_failed' }, { status: 503 })
  }
  const validationErrors: Array<{ lineKey: string; reason: string }> = []
  for (const item of body.items) {
    if (!allowlist.has(item.offeringId)) {
      validationErrors.push({ lineKey: item.lineKey, reason: 'offering_not_listed' })
    }
  }
  const allowedItems = body.items.filter((i) => allowlist.has(i.offeringId))

  if (allowedItems.length === 0) {
    return NextResponse.json({
      currencyCode: body.currencyCode,
      lines: [],
      totals: { nrcTotal: 0, mrcTotal: 0, usageCharges: [] },
      validationErrors,
    })
  }

  const startedAt = Date.now()

  // Translate the public flat list (with optional parentLineKey) into the
  // CPQ price request shape. CPQ accepts one `primaryItem` + `childItems[]`,
  // both resolved independently — no special "primary" semantics. We pick the
  // first item as primary and treat the rest as siblings.
  const [primary, ...rest] = allowedItems
  const mergedQuoteContext = { ...body.quoteContext, public_calculator: true }

  // Inject server-side synthetic attributes:
  //   - `offering_code` — lets dimensioned pricing tables (Workspace per-seat,
  //     Block Storage per-GB) match a row by offering.
  //   - `seat_volume_tier` — bucketises `seat_count` so Workspace volume-tier
  //     rules can match via `attribute = seat_volume_tier, operator = eq`.
  //     CPQ's evaluator only supports `eq`/`neq`; `gte` falls through and
  //     would otherwise fire every tier.
  // Item-supplied values never override these canonical attributes.
  const seatVolumeTier = (seatCount: unknown): string | null => {
    const n = Number(seatCount)
    if (!Number.isFinite(n) || n <= 0) return null
    if (n >= 501) return 'tier3'
    if (n >= 101) return 'tier2'
    if (n >= 26) return 'tier1'
    return 'tier0'
  }
  const buildItem = (item: PublicPriceRequest['items'][number]) => {
    const code = offeringCodes.get(item.offeringId)
    const tier = seatVolumeTier(item.configuration?.seat_count)
    return {
      offeringId: item.offeringId,
      configuration: {
        ...mergedQuoteContext,
        ...item.configuration,
        ...(code ? { offering_code: code } : {}),
        ...(tier ? { seat_volume_tier: tier } : {}),
      },
    }
  }

  const cpqBody = {
    currencyCode: body.currencyCode,
    primaryItem: buildItem(primary),
    childItems: rest.map(buildItem),
  }

  console.log('[puffin-public-calculator] /price → CPQ request:', JSON.stringify({
    currencyCode: cpqBody.currencyCode,
    primaryItemOffering: cpqBody.primaryItem.offeringId,
    primaryConfig: cpqBody.primaryItem.configuration,
    childCount: cpqBody.childItems.length,
    childOfferings: cpqBody.childItems.map((c) => c.offeringId),
  }))

  const proxied = await proxyClient.post<CpqPriceResponse>(
    config,
    '/api/cpq/quotes/price',
    cpqBody,
  )

  if (!proxied.ok) {
    console.warn('[puffin-public-calculator] /price ← CPQ error:', JSON.stringify({
      status: proxied.status,
      error: proxied.error,
      details: proxied.details,
    }))
    const status = proxied.status === 401 ? 503 : proxied.status === 502 ? 502 : 502
    const errorCode =
      proxied.status === 503 || proxied.status === 401
        ? 'public_calculator_admin_login_failed'
        : 'public_calculator_price_failed'
    return NextResponse.json({ error: errorCode, details: proxied.details }, { status })
  }

  const { primaryCharges, childItems, currencyCode } = proxied.data
  console.log('[puffin-public-calculator] /price ← CPQ response:', JSON.stringify({
    currencyCode,
    primaryChargesCount: primaryCharges?.length ?? 0,
    primaryChargeSummary: (primaryCharges ?? []).map((c) => ({
      code: c.chargeCode,
      type: c.chargeType,
      method: c.pricingMethod,
      unit: c.unitPrice,
      total: c.totalPrice,
    })),
    childItemsCount: childItems?.length ?? 0,
    childItemsSummary: (childItems ?? []).map((c) => ({
      offeringId: c.offeringId,
      chargesCount: c.charges?.length ?? 0,
      chargeTotals: (c.charges ?? []).map((ch) => ({
        code: ch.chargeCode,
        type: ch.chargeType,
        total: ch.totalPrice,
      })),
    })),
  }))
  const lines: LineResult[] = []

  // Match the response back to the public lineKeys. Order matters — CPQ
  // returns childItems in the same order they were sent.
  const primarySum = sumCharges(primaryCharges)
  lines.push({
    lineKey: primary.lineKey,
    offeringId: primary.offeringId,
    parentLineKey: primary.parentLineKey ?? null,
    quantity: primary.quantity ?? 1,
    charges: primaryCharges,
    nrcTotal: primarySum.nrc,
    mrcTotal: primarySum.mrc,
    usageCharges: primarySum.usage,
  })
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i]
    const childCharges = childItems[i]?.charges ?? []
    const sums = sumCharges(childCharges)
    lines.push({
      lineKey: item.lineKey,
      offeringId: item.offeringId,
      parentLineKey: item.parentLineKey ?? null,
      quantity: item.quantity ?? 1,
      charges: childCharges,
      nrcTotal: sums.nrc,
      mrcTotal: sums.mrc,
      usageCharges: sums.usage,
    })
  }

  const totals = lines.reduce(
    (acc, line) => {
      acc.nrcTotal += line.nrcTotal
      acc.mrcTotal += line.mrcTotal
      for (const usage of line.usageCharges) acc.usageCharges.push(usage)
      return acc
    },
    {
      nrcTotal: 0,
      mrcTotal: 0,
      usageCharges: [] as LineResult['usageCharges'],
    },
  )

  const durationMs = Date.now() - startedAt

  return NextResponse.json({
    currencyCode,
    lines,
    totals,
    validationErrors,
    meta: {
      durationMs,
      lineCount: lines.length,
    },
  })
}

const lineResponseSchema = z.object({
  lineKey: z.string(),
  offeringId: z.string().uuid(),
  parentLineKey: z.string().nullable(),
  quantity: z.number(),
  nrcTotal: z.number(),
  mrcTotal: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: PUFFIN_PUBLIC_OPENAPI_TAG,
  summary: 'Public live pricing endpoint',
  methods: {
    POST: {
      summary: 'Compute live prices for a public-calculator cart by proxying the authenticated CPQ /quotes/price API as admin@puffin.com.',
      tags: [PUFFIN_PUBLIC_OPENAPI_TAG],
      requestBody: { schema: requestSchema },
      responses: [
        {
          status: 200,
          schema: z.object({
            currencyCode: z.string(),
            lines: z.array(lineResponseSchema),
            totals: z.object({
              nrcTotal: z.number(),
              mrcTotal: z.number(),
            }),
          }),
        },
      ],
      errors: [
        { status: 400, schema: z.object({ error: z.string() }), description: 'Validation error' },
        { status: 429, schema: z.object({ error: z.string() }), description: 'Rate limit exceeded' },
        { status: 502, schema: z.object({ error: z.string() }), description: 'Upstream proxy error' },
        { status: 503, schema: z.object({ error: z.string() }), description: 'Public calculator not configured or admin login failed' },
      ],
    },
  },
}
