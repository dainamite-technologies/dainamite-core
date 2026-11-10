import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqAddQuoteItemSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_RESOURCE_KIND, runCpqMutationGuards } from '../../../_helpers/quoteMutationGuard'
import { QUOTE_ITEM_REQUEST_SCHEMA } from '../../../_helpers/quoteItemOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const body = cpqAddQuoteItemSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_LINE_RESOURCE_KIND,
      operation: 'create',
      mutationPayload: { quoteId, ...body },
    })
    if (!guard.ok) return guard.response
    const effective = guard.modifiedPayload
      ? cpqAddQuoteItemSchema.parse({ ...body, ...guard.modifiedPayload })
      : body

    const service = resolveQuotingService(ctx)
    const result = await service.addQuoteItem(quoteId, effective, scope)
    await guard.runAfterSuccess()
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/items.POST')
  }
}

export const openApi = {
  '/api/cpq/quotes/{quoteId}/items': {
    parameters: [
      { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    post: {
      tags: ['CPQ Quotes'],
      summary: 'Add a configured line to a CPQ quote',
      description: 'Prices the line and recalculates the quote. Guarded as resource kind `cpq.quote_line` (create).',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: QUOTE_ITEM_REQUEST_SCHEMA } },
      },
      responses: {
        '201': { description: 'Quote after the line was added' },
        '400': { description: 'Validation error' },
        '404': { description: 'Quote or offering not found' },
        '409': { description: 'Quote is in a terminal status' },
        '422': { description: 'Blocked by a mutation guard' },
      },
    },
  },
}
