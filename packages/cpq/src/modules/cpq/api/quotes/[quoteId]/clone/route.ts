import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { isQuotingError } from '../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { resolveAuditActor } from '../../../../lib/auditActor'

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
