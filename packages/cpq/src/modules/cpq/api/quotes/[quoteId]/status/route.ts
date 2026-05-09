import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqTransitionStatusSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const body = cpqTransitionStatusSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.transitionStatus(quoteId, body.targetStatus, scope)
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/status.POST')
  }
}
