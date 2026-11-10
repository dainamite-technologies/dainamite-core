import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqTransitionStatusSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../../../_helpers/quoteMutationGuard'
import { CPQ_STATUSES } from '../../../../services/types'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const body = cpqTransitionStatusSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    // Projects enforce approval rules here (e.g. block `ready → with_customer`
    // until a discounted quote is approved).
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_RESOURCE_KIND,
      resourceId: quoteId,
      operation: 'custom',
      mutationPayload: { action: 'transition_status', targetStatus: body.targetStatus },
    })
    if (!guard.ok) return guard.response

    const service = resolveQuotingService(ctx)
    const result = await service.transitionStatus(quoteId, body.targetStatus, scope)
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/status.POST')
  }
}

export const openApi = {
  '/api/cpq/quotes/{quoteId}/status': {
    parameters: [
      { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    post: {
      tags: ['CPQ Quotes'],
      summary: 'Transition a CPQ quote to another status',
      description:
        'Operator-driven status change. Registered mutation guards (resource kind `cpq.quote`, action `transition_status`) can block it — projects use this to enforce approvals.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['targetStatus'],
              properties: { targetStatus: { type: 'string', enum: [...CPQ_STATUSES] } },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Quote with its new status' },
        '400': { description: 'Validation error' },
        '404': { description: 'Quote not found' },
        '409': { description: 'Transition not allowed' },
        '422': { description: 'ARC validation failed or blocked by a mutation guard' },
      },
    },
  },
}
