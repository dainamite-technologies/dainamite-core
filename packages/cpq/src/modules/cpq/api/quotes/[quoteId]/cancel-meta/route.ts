import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqCancelMetaSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

/**
 * POST /api/cpq/quotes/[quoteId]/cancel-meta
 *
 * Stamp ETF + reason on a `quote_type='cancel'` quote. Required before the
 * quote can transition through the approval lifecycle (validateArcQuote).
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.arc.cancel.manage'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = await params
    const body = cpqCancelMetaSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveQuotingService(ctx)
    const result = await service.setCancelMeta(
      quoteId,
      {
        reasonCode: body.reasonCode,
        reasonText: body.reasonText ?? null,
        etfAmount: body.etfAmount ?? null,
        etfCurrency: body.etfCurrency ?? null,
      },
      scope,
    )
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/cancel-meta.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ cancel quote meta',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Set cancellation reason and early termination fee (ETF) on a cancel quote',
      description: 'Required on a `quoteType=cancel` quote before it can move through the approval lifecycle.',
      requestBody: { schema: cpqCancelMetaSchema },
      responses: [{ status: 200, description: 'Quote with the cancel meta stamped' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Quote is not a cancel quote or is no longer editable'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
