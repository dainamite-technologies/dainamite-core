import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqAttachTargetSubscriptionSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

/**
 * Manage ARC target subscriptions on a quote.
 *
 *   GET  /api/cpq/quotes/[quoteId]/target-subscriptions
 *     → list attached targets with per-target context (current items, term).
 *
 *   POST /api/cpq/quotes/[quoteId]/target-subscriptions
 *     → attach a subscription to the quote (multi-target / merge case).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveQuotingService(ctx)
    const items = await service.listTargetSubscriptions(quoteId, scope)
    return NextResponse.json({ items })
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/target-subscriptions.GET')
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = await params
    const body = cpqAttachTargetSubscriptionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveQuotingService(ctx)
    const result = await service.attachTargetSubscription(
      quoteId,
      {
        subscriptionId: body.subscriptionId,
        quoteType: body.quoteType,
        mergeAction: body.mergeAction,
        newTermStart: body.newTermStart ?? null,
        newTermEnd: body.newTermEnd ?? null,
        newTermMonths: body.newTermMonths ?? null,
      },
      scope,
    )
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/target-subscriptions.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ ARC quote target subscriptions',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    GET: {
      summary: 'List the subscriptions an ARC quote targets',
      description: 'Each target includes its context (current items and term).',
      responses: [{ status: 200, description: '`{ items }` attached targets' }],
      errors: [cpqErrorDoc(404, 'Quote not found'), cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Attach a subscription as a target of an ARC quote',
      description:
        'Supports multi-target quotes. For renew quotes `mergeAction=absorb` merges the subscription into the renewal. The subscription must share the quote customer and currency.',
      requestBody: { schema: cpqAttachTargetSubscriptionSchema },
      responses: [{ status: 201, description: 'Target attached' }],
      errors: [
        cpqErrorDoc(400, 'Validation error, or subscription customer or currency does not match the quote'),
        cpqErrorDoc(404, 'Quote or subscription not found'),
        cpqErrorDoc(409, 'Quote type is `new`, quote no longer editable, or concurrent modification detected'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
