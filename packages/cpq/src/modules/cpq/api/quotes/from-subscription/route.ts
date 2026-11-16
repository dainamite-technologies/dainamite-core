import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { cpqCreateQuoteFromSubscriptionSchema } from '../../../data/validators'
import { resolveQuotingService } from '../../resolveQuotingService'
import { handleArcError } from '../../_helpers/handleArcError'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ ARC quote from subscription',
  methods: {
    POST: {
      summary: 'Create an ARC (amend, renew or cancel) quote pre-filled from a subscription',
      description:
        "Creates a new quote of the given ARC type with the subscription's current items as lines. `renewTerm` sets the new contract term for renewals. The subscription must be active or suspended.",
      requestBody: { schema: cpqCreateQuoteFromSubscriptionSchema },
      responses: [
        {
          status: 201,
          description: 'Quote created',
          schema: z.object({ quoteId: z.string(), cpqConfigId: z.string() }).passthrough(),
        },
      ],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Subscription not found'),
        cpqErrorDoc(409, 'Subscription not active or suspended, or concurrent modification detected'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
