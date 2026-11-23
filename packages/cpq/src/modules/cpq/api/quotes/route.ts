import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { cpqCreateQuoteSchema } from '../../data/validators'
import { isQuotingError } from '../../services/cpqQuotingService'
import { resolveQuotingService } from '../resolveQuotingService'
import { CpqQuoteConfiguration } from '../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqSortDirQuery } from '../_helpers/quoteRouteOpenApi'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Upper bound on sales quotes a quote-number search expands to. A search
 * string that matches more quotes than this is too broad to be useful; the
 * newest matches win.
 */
const QUOTE_NUMBER_SEARCH_LIMIT = 1000

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

    // Search by quote number (case-insensitive substring, e.g. "00003" or
    // "QUOTE-20261123-00003") or by an exact id (quote configuration id,
    // sales quote id or customer id). The id columns are uuid, so a substring
    // `$ilike` on them is a Postgres error (500); quote numbers live on the
    // sales quote, so they are matched there first.
    const search = url.searchParams.get('search')?.trim()
    if (search) {
      const searchFilters: Record<string, unknown>[] = []
      if (UUID_PATTERN.test(search)) {
        searchFilters.push({ id: search }, { quoteId: search }, { customerId: search })
      }
      const numberMatches = await ctx.em.find(
        SalesQuote,
        {
          organizationId: ctx.organizationId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          quoteNumber: { $ilike: buildIlikeTerm(search) },
        },
        { fields: ['id'], orderBy: { createdAt: 'desc' }, limit: QUOTE_NUMBER_SEARCH_LIMIT },
      )
      if (numberMatches.length > 0) searchFilters.push({ quoteId: { $in: numberMatches.map((q) => q.id) } })
      if (searchFilters.length === 0) {
        return NextResponse.json({ items: [], total: 0, page, pageSize, totalPages: 0 })
      }
      filters.$or = searchFilters
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
  if (isQuotingError(err)) {
    const body: Record<string, unknown> = { error: err.message }
    if (err.cpqStatus) body.cpqStatus = err.cpqStatus
    return NextResponse.json(body, { status: err.status })
  }
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quotes',
  methods: {
    POST: {
      summary: 'Create a CPQ quote for a customer',
      description:
        'Creates the CPQ quote configuration and its sales quote header (or links an existing sales quote via `quoteId`). Lines are added afterwards via `POST /api/cpq/quotes/{quoteId}/items`.',
      requestBody: { schema: cpqCreateQuoteSchema },
      responses: [{ status: 201, description: 'Created quote' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Customer or sales quote not found'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    GET: {
      summary: 'List CPQ quotes',
      description: 'Paged list of CPQ quote configurations, each enriched with the sales `quoteNumber`. `search` matches the quote number (case-insensitive substring) or an exact quote, sales quote or customer id.',
      query: cpqPaginationQuery.extend({
        cpqStatus: z.string().optional(),
        currencyCode: z.string().optional(),
        customerId: z.string().uuid().optional(),
        search: z.string().optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'cpqStatus', 'version', 'currencyCode']).optional(),
        sortDir: cpqSortDirQuery,
      }),
      responses: [{ status: 200, description: '`{ items, total, page, pageSize, totalPages }`' }],
      errors: [cpqErrorDoc(500, 'Internal error')],
    },
  },
}
