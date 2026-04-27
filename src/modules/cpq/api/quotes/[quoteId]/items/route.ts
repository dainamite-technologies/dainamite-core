import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../context'
import { cpqAddQuoteItemSchema } from '../../../../data/validators'
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
    const body = cpqAddQuoteItemSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.addQuoteItem(quoteId, body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err instanceof QuotingError) {
      const body: Record<string, unknown> = { error: err.message }
      if (err.cpqStatus) body.cpqStatus = err.cpqStatus
      return NextResponse.json(body, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/items.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
