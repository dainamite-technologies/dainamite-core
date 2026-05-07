import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { cpqCreateQuoteFromSubscriptionSchema } from '../../../data/validators'
import { resolveQuotingService } from '../../resolveQuotingService'
import { handleArcError } from '../../_helpers/handleArcError'

/**
 * POST /api/cpq/quotes/from-subscription
 *
 * Create a fresh ARC quote pre-filled with one subscription's items.
 *
 * Body (validated):
 *   {
 *     subscriptionId: uuid,
 *     type: 'amend' | 'renew' | 'cancel',
 *     renewTerm?: { newTermStart, newTermEnd, newTermMonths? }
 *   }
 *
 * Returns: { quoteId, cpqConfigId }
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqCreateQuoteFromSubscriptionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.createQuoteFromSubscription(
      {
        subscriptionId: body.subscriptionId,
        type: body.type,
        renewTerm: body.renewTerm,
      },
      scope,
    )
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/from-subscription.POST')
  }
}

export const openApi = {
  '/api/cpq/quotes/from-subscription': {
    post: {
      tags: ['CPQ ARC'],
      summary: 'Create an ARC quote pre-filled from a subscription',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['subscriptionId', 'type'],
              properties: {
                subscriptionId: { type: 'string', format: 'uuid' },
                type: { type: 'string', enum: ['amend', 'renew', 'cancel'] },
                renewTerm: {
                  type: 'object',
                  properties: {
                    newTermStart: { type: 'string' },
                    newTermEnd: { type: 'string' },
                    newTermMonths: { type: 'integer', minimum: 1 },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'Quote created', content: { 'application/json': {} } },
        '400': { description: 'Validation error' },
        '401': { description: 'Unauthorized' },
        '404': { description: 'Subscription not found' },
        '409': { description: 'Subscription not in eligible status / concurrent ARC quote' },
      },
    },
  },
}
