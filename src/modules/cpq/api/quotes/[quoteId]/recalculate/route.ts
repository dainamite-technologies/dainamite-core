import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../context'
import { cpqRecalculateSchema } from '../../../../data/validators'
import { QuotingError } from '../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../resolveQuotingService'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const body = cpqRecalculateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.recalculate(quoteId, body, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err instanceof QuotingError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/recalculate.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
