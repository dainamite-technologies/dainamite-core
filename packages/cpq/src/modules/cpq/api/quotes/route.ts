import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqCreateQuoteSchema } from '../../data/validators'
import { QuotingError } from '../../services/cpqQuotingService'
import { resolveQuotingService } from '../resolveQuotingService'
import { CpqQuoteConfiguration } from '../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

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

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const filters: Record<string, unknown> = { ...scope }

    const cpqStatus = url.searchParams.get('cpqStatus')
    if (cpqStatus) filters.cpqStatus = cpqStatus
    const currencyCode = url.searchParams.get('currencyCode')
    if (currencyCode) filters.currencyCode = currencyCode
    const customerId = url.searchParams.get('customerId')
    if (customerId) filters.customerId = customerId

    // Free-text search across quoteId, customerId (case-insensitive)
    const search = url.searchParams.get('search')?.trim()
    if (search) {
      filters.$or = [
        { quoteId: { $ilike: `%${search}%` } },
        { customerId: { $ilike: `%${search}%` } },
      ]
    }

    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'cpqStatus', 'version', 'currencyCode'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : 'createdAt'
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    const [items, total] = await ctx.em.findAndCount(CpqQuoteConfiguration, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
    })

    // Enrich rows with `quoteNumber` (e.g. "QUOTE-20260512-00005") so the
    // list shows human-meaningful identifiers instead of truncated UUIDs.
    // Batched lookup keeps the cost flat regardless of page size.
    const salesQuoteIds = [...new Set(items.map((i) => i.quoteId).filter(Boolean))]
    const salesQuotes = salesQuoteIds.length > 0
      ? await ctx.em.find(SalesQuote, {
          id: { $in: salesQuoteIds },
          organizationId: ctx.organizationId,
          tenantId: ctx.tenantId,
        })
      : []
    const quoteNumberById = new Map<string, string | null>(
      salesQuotes.map((q) => [q.id, q.quoteNumber ?? null]),
    )

    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        quoteNumber: quoteNumberById.get(item.quoteId) ?? null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
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
