import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqCreateQuoteSchema } from '../../data/validators'
import { QuotingError } from '../../services/cpqQuotingService'
import { resolveQuotingService } from '../resolveQuotingService'
import { CpqQuoteConfiguration } from '../../data/entities'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqCreateQuoteSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.createQuote(body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleError(err, 'cpq/quotes.POST')
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const configs = await ctx.em.find(
      CpqQuoteConfiguration,
      { ...scope, deletedAt: null },
      { orderBy: { createdAt: 'desc' }, limit: 100 },
    )

    return NextResponse.json({ items: configs })
  } catch (err) {
    return handleError(err, 'cpq/quotes.GET')
  }
}

function handleError(err: unknown, context: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
  }
  if (err instanceof QuotingError) {
    const body: Record<string, unknown> = { error: err.message }
    if (err.cpqStatus) body.cpqStatus = err.cpqStatus
    return NextResponse.json(body, { status: err.status })
  }
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
