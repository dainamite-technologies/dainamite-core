import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqUpdateQuoteItemSchema } from '../../../../../data/validators'
import { QuotingError } from '../../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../../resolveQuotingService'

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

    const service = resolveQuotingService(ctx)
    const result = await service.updateQuoteItem(quoteId, lineId, body, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err instanceof QuotingError) {
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

    const service = resolveQuotingService(ctx)
    const result = await service.removeQuoteItem(quoteId, lineId, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof QuotingError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/items/[lineId].DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
