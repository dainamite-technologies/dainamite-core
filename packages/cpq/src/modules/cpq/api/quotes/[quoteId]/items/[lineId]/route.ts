import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqUpdateQuoteItemSchema } from '../../../../../data/validators'
import { isQuotingError } from '../../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../../resolveQuotingService'
import { CPQ_QUOTE_LINE_RESOURCE_KIND, runCpqMutationGuards } from '../../../../_helpers/quoteMutationGuard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CPQ_GUARDED_WRITE_ERRORS, CPQ_LINE_WRITE_ERRORS } from '../../../../_helpers/quoteRouteOpenApi'
import { resolveAuditActor } from '../../../../../lib/auditActor'

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
    const result = await service.updateQuoteItem(quoteId, lineId, effective, scope, resolveAuditActor(ctx.auth))
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
    const result = await service.removeQuoteItem(quoteId, lineId, scope, resolveAuditActor(ctx.auth))
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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote line',
  pathParams: z.object({ quoteId: z.string().uuid(), lineId: z.string().uuid() }),
  methods: {
    PUT: {
      summary: 'Update a quote line (configuration, quantity, term)',
      description:
        'Re-prices the line unless it is a frozen Amend mirror line whose pricing inputs are unchanged. Mutation guards run first (resource kind `cpq.quote_line`, update). `_arc*` configuration keys are server-owned and ignored.',
      requestBody: { schema: cpqUpdateQuoteItemSchema },
      responses: [{ status: 200, description: 'Quote after the update' }],
      errors: CPQ_LINE_WRITE_ERRORS,
    },
    DELETE: {
      summary: 'Remove a quote line',
      description:
        'On an Amend / Renew quote, a line mirroring a live subscription item is not deleted: it (and its mirrored components) becomes a `cancel` line with zero totals, and activation terminates the item; lines this quote added under it are deleted. 409 when the item is already marked for removal — use `POST .../restore` to undo. Other lines are deleted with their descendants. Mutation guards run first (resource kind `cpq.quote_line`, delete).',
      responses: [{ status: 200, description: 'Quote after the removal' }],
      errors: CPQ_GUARDED_WRITE_ERRORS.filter((doc) => doc.status !== 400),
    },
  },
}
