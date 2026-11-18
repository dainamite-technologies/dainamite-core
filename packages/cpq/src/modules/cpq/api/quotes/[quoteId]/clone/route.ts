import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { isQuotingError } from '../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { resolveAuditActor } from '../../../../lib/auditActor'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'Clone a CPQ quote',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Clone a CPQ quote into a new draft version',
      description: 'Copies the quote and its lines; supplier cost requests and answers are reset on the copy (costs are re-resolved from the catalog).',
      responses: [{ status: 201, description: 'The cloned quote' }],
      errors: [cpqErrorDoc(401, 'Unauthorized'), cpqErrorDoc(404, 'Quote not found'), cpqErrorDoc(409, 'Quote cannot be cloned in its current status'), cpqErrorDoc(500, 'Internal error')],
    },
  },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.cloneQuote(quoteId, scope, resolveAuditActor(ctx.auth))
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/clone.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
