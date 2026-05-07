import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqUpdateTargetSubscriptionSchema } from '../../../../../data/validators'
import { resolveQuotingService } from '../../../../resolveQuotingService'
import { handleArcError } from '../../../../_helpers/handleArcError'

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

export const openApi = {
  '/api/cpq/quotes/{quoteId}/target-subscriptions/{targetId}': {
    parameters: [
      { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'targetId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    patch: {
      tags: ['CPQ ARC'],
      summary: 'Update an ARC target (mergeAction / term fields)',
      responses: {
        '200': { description: 'Updated' },
        '404': { description: 'Target not found' },
        '409': { description: 'Quote no longer editable' },
      },
    },
    delete: {
      tags: ['CPQ ARC'],
      summary: 'Detach an ARC target',
      responses: {
        '200': { description: 'Detached' },
        '404': { description: 'Target not found' },
        '409': { description: 'Quote no longer editable' },
      },
    },
  },
}
