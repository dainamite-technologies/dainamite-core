import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../context'
import { cpqUpdateQuoteSchema } from '../../../data/validators'
import { isQuotingError } from '../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../resolveQuotingService'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration } from '../../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { handleArcError } from '../../_helpers/handleArcError'
import { buildCpqCommandContext, commandErrorResponse, resolveCommandBus } from '../../_helpers/commandContext'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const em = ctx.em
    const now = new Date()

    let cpqConfig = await em.findOne(CpqQuoteConfiguration, {
      id: quoteId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
    })
    if (!cpqConfig) {
      cpqConfig = await em.findOne(CpqQuoteConfiguration, {
        quoteId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
      })
    }
    if (!cpqConfig) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const terminalStatuses = ['accepted', 'rejected', 'cancelled']
    if (terminalStatuses.includes(cpqConfig.cpqStatus)) {
      return NextResponse.json({ error: `Cannot delete a quote in '${cpqConfig.cpqStatus}' status` }, { status: 409 })
    }

    const lineConfigs = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: cpqConfig.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
    })
    const salesQuote = await em.findOne(SalesQuote, {
      id: cpqConfig.quoteId, organizationId: scope.organizationId, tenantId: scope.tenantId,
    })

    // The sales quote and its lines belong to the sales module, so they are
    // removed through its `sales.quotes.delete` command (sales events, audit
    // log, undo, search/index side effects). That command runs on its own
    // forked EM and transaction, so it cannot share one with the CPQ rows.
    // Order: sales command first, CPQ soft-delete second. If the command
    // fails, nothing has changed. If the CPQ flush fails afterwards, the
    // configuration still points at a missing sales quote; a retried DELETE
    // skips the command (quote already gone) and finishes the cleanup.
    if (salesQuote) {
      await resolveCommandBus(ctx).execute('sales.quotes.delete', {
        input: { body: { id: salesQuote.id } },
        ctx: buildCpqCommandContext(ctx, req),
      })
    }

    for (const lc of lineConfigs) lc.deletedAt = now
    cpqConfig.deletedAt = now
    await em.flush()

    return NextResponse.json({ ok: true })
  } catch (err) {
    const commandError = commandErrorResponse(err)
    if (commandError) return commandError
    console.error('[cpq/quotes/[quoteId].DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    GET: {
      summary: 'Get a CPQ quote with its lines and totals',
      responses: [{ status: 200, description: 'Quote with lines, charges and totals' }],
      errors: [cpqErrorDoc(404, 'Quote not found'), cpqErrorDoc(500, 'Internal error')],
    },
    PATCH: {
      summary: 'Change the quote type of a CPQ quote (ARC)',
      description:
        'Only `quoteType` is updatable. The transition is one-way: `new` to `amend`, `renew` or `cancel`; any later change returns 409.',
      requestBody: { schema: cpqUpdateQuoteSchema },
      responses: [{ status: 200, description: 'Quote with its new type' }],
      errors: [
        cpqErrorDoc(400, 'Validation error, nothing to update, or transition back to `new`'),
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Quote type is immutable'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    DELETE: {
      summary: 'Soft-delete a CPQ quote',
      description:
        'Soft-deletes the CPQ quote and its line configurations, and deletes the underlying sales quote and its lines through the sales module command `sales.quotes.delete` (sales events, audit log and undo apply). `quoteId` may be the CPQ configuration id or the sales quote id. Quotes in a terminal status (accepted, rejected, cancelled) cannot be deleted.',
      responses: [{ status: 200, description: '`{ ok: true }`', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Quote is in a terminal status'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
