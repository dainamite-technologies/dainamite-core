import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { cpqUpdateQuoteSchema } from '../../../data/validators'
import { isQuotingError } from '../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../resolveQuotingService'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveAuditActor } from '../../../lib/auditActor'
import { handleArcError } from '../../_helpers/handleArcError'
import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../../_helpers/quoteMutationGuard'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.getQuote(quoteId, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId].GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const body = cpqUpdateQuoteSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    if (body.quoteType !== undefined) {
      // ARC quote-type one-way transition (XD-250 DD-ARC-9). The service
      // enforces 'new' → 'amend'/'renew'/'cancel' only; subsequent changes
      // return 409.
      const service = resolveQuotingService(ctx)
      const result = await service.setQuoteType(quoteId, body.quoteType, scope)
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId].PATCH')
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_RESOURCE_KIND,
      resourceId: quoteId,
      operation: 'delete',
      mutationPayload: { action: 'delete' },
    })
    if (!guard.ok) return guard.response

    // The service owns the write: aggregate lock, terminal-status refusal, soft-delete and the cancellation of the
    // quote's open supplier cost requests, in one transaction.
    const service = resolveQuotingService(ctx)
    const result = await service.deleteQuote(quoteId, scope, resolveAuditActor(ctx.auth))
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId].DELETE')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    GET: {
      summary: 'Get a CPQ quote',
      responses: [{ status: 200, description: 'The quote with its lines and pricing' }],
      errors: [cpqErrorDoc(401, 'Unauthorized'), cpqErrorDoc(404, 'Quote not found')],
    },
    PATCH: {
      summary: 'Set the ARC quote type (one-way: new to amend / renew / cancel)',
      requestBody: { schema: cpqUpdateQuoteSchema },
      responses: [{ status: 200, description: 'The updated quote' }],
      errors: [cpqErrorDoc(400, 'Validation error or nothing to update'), cpqErrorDoc(404, 'Quote not found'), cpqErrorDoc(409, 'Quote type cannot change')],
    },
    DELETE: {
      summary: 'Delete a CPQ quote',
      description:
        'Soft-deletes the quote, its lines and its sales quote under the quote aggregate lock. Open supplier cost requests are cancelled (`quote_closed`) in the same transaction. Registered mutation guards (resource kind `cpq.quote`, operation `delete`) run first.',
      responses: [{ status: 200, description: '`{ ok: true }`', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'The quote is accepted, rejected or cancelled and cannot be deleted'),
        cpqErrorDoc(422, 'Blocked by a mutation guard'),
      ],
    },
  },
}
