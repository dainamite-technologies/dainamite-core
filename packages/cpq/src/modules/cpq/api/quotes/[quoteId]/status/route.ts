import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqTransitionStatusSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../../../_helpers/quoteMutationGuard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote status',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Transition a CPQ quote to another status',
      description:
        'Operator-driven status change. Registered mutation guards (resource kind `cpq.quote`, action `transition_status`) run first — projects use them to enforce approvals.',
      requestBody: { schema: cpqTransitionStatusSchema },
      responses: [{ status: 200, description: 'Quote with its new status' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Transition not allowed'),
        cpqErrorDoc(422, 'ARC validation failed or blocked by a mutation guard'),
      ],
    },
  },
}
