import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqMergeMetaSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'

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

export const openApi = {
  '/api/cpq/quotes/{quoteId}/merge-meta': {
    parameters: [
      { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    post: {
      tags: ['CPQ ARC'],
      summary: 'Stamp the new contract term + optional code/name on a merge-renew quote',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['newTermStart', 'newTermEnd'],
              properties: {
                newTermStart: { type: 'string' },
                newTermEnd: { type: 'string' },
                newTermMonths: { type: 'integer', minimum: 1 },
                newSubCode: { type: 'string' },
                newSubName: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Merge meta stamped' },
        '404': { description: 'Quote not found' },
        '409': { description: 'Quote not renew-type or no longer editable' },
      },
    },
  },
}
