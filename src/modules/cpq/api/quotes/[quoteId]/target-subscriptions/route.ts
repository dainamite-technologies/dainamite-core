import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqAttachTargetSubscriptionSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'

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

export const openApi = {
  '/api/cpq/quotes/{quoteId}/target-subscriptions': {
    parameters: [
      { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    get: {
      tags: ['CPQ ARC'],
      summary: 'List target subscriptions attached to an ARC quote',
      responses: { '200': { description: 'Targets' }, '401': { description: 'Unauthorized' } },
    },
    post: {
      tags: ['CPQ ARC'],
      summary: 'Attach a subscription as an ARC target',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['subscriptionId', 'quoteType'],
              properties: {
                subscriptionId: { type: 'string', format: 'uuid' },
                quoteType: { type: 'string', enum: ['amend', 'renew', 'cancel'] },
                mergeAction: { type: 'string', enum: ['standalone', 'absorb'] },
                newTermStart: { type: 'string' },
                newTermEnd: { type: 'string' },
                newTermMonths: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'Target attached' },
        '400': { description: 'Validation error / mismatch' },
        '404': { description: 'Subscription not found' },
        '409': { description: 'Subscription not eligible / concurrent ARC quote' },
      },
    },
  },
}
