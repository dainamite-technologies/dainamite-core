import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqCancelMetaSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'

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

export const openApi = {
  '/api/cpq/quotes/{quoteId}/cancel-meta': {
    parameters: [
      { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    post: {
      tags: ['CPQ ARC'],
      summary: 'Stamp ETF + reason on a cancel quote',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reasonCode'],
              properties: {
                reasonCode: { type: 'string' },
                reasonText: { type: 'string' },
                etfAmount: { type: 'string' },
                etfCurrency: { type: 'string', maxLength: 3 },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Cancel meta stamped' },
        '400': { description: 'Validation error' },
        '404': { description: 'Quote not found' },
        '409': { description: 'Quote not cancel-type or no longer editable' },
      },
    },
  },
}
