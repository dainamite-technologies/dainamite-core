import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqUpdateTargetSubscriptionSchema } from '../../../../../data/validators'
import { resolveQuotingService } from '../../../../resolveQuotingService'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

/**
 * Manage a single attached ARC target.
 *
 *   PATCH  /api/cpq/quotes/[quoteId]/target-subscriptions/[targetId]
 *     → update mergeAction or term fields (renew only).
 *
 *   DELETE /api/cpq/quotes/[quoteId]/target-subscriptions/[targetId]
 *     → detach the target. Drops associated quote lines.
 */
export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ quoteId: string; targetId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, targetId } = await params
    const body = cpqUpdateTargetSubscriptionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveQuotingService(ctx)
    const result = await service.updateTargetSubscription(
      quoteId,
      targetId,
      {
        mergeAction: body.mergeAction,
        newTermStart: body.newTermStart ?? null,
        newTermEnd: body.newTermEnd ?? null,
        newTermMonths: body.newTermMonths ?? null,
      },
      scope,
    )
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/target-subscriptions/[targetId].PATCH')
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ quoteId: string; targetId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, targetId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveQuotingService(ctx)
    const result = await service.detachTargetSubscription(quoteId, targetId, scope)
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/target-subscriptions/[targetId].DELETE')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ ARC quote target subscription',
  pathParams: z.object({ quoteId: z.string().uuid(), targetId: z.string().uuid() }),
  methods: {
    PATCH: {
      summary: 'Update an ARC quote target (mergeAction or renewal term)',
      requestBody: { schema: cpqUpdateTargetSubscriptionSchema },
      responses: [{ status: 200, description: 'Updated target' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Quote or target not found'),
        cpqErrorDoc(409, 'Quote no longer editable'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    DELETE: {
      summary: 'Detach a target subscription from an ARC quote',
      description: 'Also drops the quote lines that belong to that target.',
      responses: [{ status: 200, description: 'Target detached' }],
      errors: [
        cpqErrorDoc(404, 'Quote or target not found'),
        cpqErrorDoc(409, 'Quote no longer editable'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
