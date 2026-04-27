import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { QuotingError } from '../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../resolveQuotingService'

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
    if (err instanceof QuotingError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/clone.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
