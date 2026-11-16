import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqMergeMetaSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

/**
 * POST /api/cpq/quotes/[quoteId]/merge-meta
 *
 * Stamp the new contract term + optional code/name on a renew quote that
 * has entered merge mode (≥2 absorb targets). Required before activation.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.arc.renew.manage'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = await params
    const body = cpqMergeMetaSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveQuotingService(ctx)
    const result = await service.setMergeMeta(
      quoteId,
      {
        newTermStart: body.newTermStart,
        newTermEnd: body.newTermEnd,
        newTermMonths: body.newTermMonths ?? null,
        newSubCode: body.newSubCode ?? null,
        newSubName: body.newSubName ?? null,
      },
      scope,
    )
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/merge-meta.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ merge-renew quote meta',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Set the new contract term and optional code/name on a merge-renew quote',
      description:
        'For a `quoteType=renew` quote that merges two or more subscriptions (absorb targets) into one. Required before activation.',
      requestBody: { schema: cpqMergeMetaSchema },
      responses: [{ status: 200, description: 'Quote with the merge meta stamped' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Quote is not a renew quote or is no longer editable'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
