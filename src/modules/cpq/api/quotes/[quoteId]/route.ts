import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { cpqUpdateQuoteSchema } from '../../../data/validators'
import { QuotingError } from '../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../resolveQuotingService'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration } from '../../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { handleArcError } from '../../_helpers/handleArcError'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = resolveQuotingService(ctx)
    const result = await service.getQuote(quoteId, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof QuotingError) {
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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    for (const lc of lineConfigs) {
      lc.deletedAt = now
      const salesLine = await em.findOne(SalesQuoteLine, { id: lc.quoteLineId })
      if (salesLine) salesLine.deletedAt = now
    }

    cpqConfig.deletedAt = now

    const salesQuote = await em.findOne(SalesQuote, { id: cpqConfig.quoteId })
    if (salesQuote) salesQuote.deletedAt = now

    await em.flush()

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[cpq/quotes/[quoteId].DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
