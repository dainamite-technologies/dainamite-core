import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqUpdateQuoteItemSchema } from '../../../../../data/validators'
import { isQuotingError } from '../../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../../resolveQuotingService'
import { CPQ_QUOTE_LINE_RESOURCE_KIND, runCpqMutationGuards } from '../../../../_helpers/quoteMutationGuard'
import { QUOTE_ITEM_UPDATE_SCHEMA } from '../../../../_helpers/quoteItemOpenApi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function PUT(req: Request, { params }: { params: Promise<{ quoteId: string; lineId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId, lineId } = await params
    const body = cpqUpdateQuoteItemSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_LINE_RESOURCE_KIND,
      resourceId: lineId,
      operation: 'update',
      mutationPayload: { quoteId, ...body },
    })
    if (!guard.ok) return guard.response
    const effective = guard.modifiedPayload
      ? cpqUpdateQuoteItemSchema.parse({ ...body, ...guard.modifiedPayload })
      : body

    const service = resolveQuotingService(ctx)
    const result = await service.updateQuoteItem(quoteId, lineId, effective, scope)
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/items/[lineId].PUT]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ quoteId: string; lineId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId, lineId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_LINE_RESOURCE_KIND,
      resourceId: lineId,
      operation: 'delete',
      mutationPayload: { quoteId },
    })
    if (!guard.ok) return guard.response

    const service = resolveQuotingService(ctx)
    const result = await service.removeQuoteItem(quoteId, lineId, scope)
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/items/[lineId].DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

const PATH_PARAMETERS = [
  { name: 'quoteId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  { name: 'lineId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
]

export const openApi = {
  '/api/cpq/quotes/{quoteId}/items/{lineId}': {
    parameters: PATH_PARAMETERS,
    put: {
      tags: ['CPQ Quotes'],
      summary: 'Update a quote line (configuration, quantity, term)',
      description:
        'Re-prices the line unless it is a frozen Amend mirror line whose pricing inputs are unchanged. Guarded as resource kind `cpq.quote_line` (update).',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: QUOTE_ITEM_UPDATE_SCHEMA } },
      },
      responses: {
        '200': { description: 'Quote after the update' },
        '400': { description: 'Validation error' },
        '404': { description: 'Quote or line not found' },
        '409': { description: 'Quote is in a terminal status' },
        '422': { description: 'Blocked by a mutation guard' },
      },
    },
    delete: {
      tags: ['CPQ Quotes'],
      summary: 'Remove a quote line',
      description: 'Guarded as resource kind `cpq.quote_line` (delete).',
      responses: {
        '200': { description: 'Quote after the removal' },
        '404': { description: 'Quote or line not found' },
        '409': { description: 'Quote is in a terminal status' },
        '422': { description: 'Blocked by a mutation guard' },
      },
    },
  },
}
