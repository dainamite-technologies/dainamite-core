import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { isQuotingError } from '../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../resolveQuotingService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.cloneQuote(quoteId, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/clone.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'Clone a CPQ quote',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Clone a CPQ quote with its lines',
      description: 'Creates a new quote (sales quote header plus CPQ configuration) copied from the source quote, then reprices it.',
      responses: [{ status: 201, description: 'The newly created quote' }],
      errors: [cpqErrorDoc(404, 'Quote not found'), cpqErrorDoc(500, 'Internal error')],
    },
  },
}
