import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { CpqPricingTable, CpqPricingTableEntry } from '../../data/entities'
import { cpqPricingTableCreateSchema, cpqPricingTableUpdateSchema } from '../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqSortDirQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_WRITE_ERRORS, CPQ_CRUD_BY_ID_ERRORS } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.pricing.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const id = url.searchParams.get('id')
    if (id) {
      const item = await ctx.em.findOne(CpqPricingTable, { id, ...scope })
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const entries = await ctx.em.find(CpqPricingTableEntry, {
        pricingTableId: item.id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      })

      return NextResponse.json({
        id: item.id,
        code: item.code,
        name: item.name,
        dimensions: item.dimensions,
        priceColumns: item.priceColumns,
        currencyCodeList: item.currencyCodeList,
        isActive: item.isActive,
        entries: entries.map((e) => ({
          id: e.id,
          dimensionValues: e.dimensionValues,
          tierNumber: e.tierNumber,
          rangeFrom: e.rangeFrom,
          rangeTo: e.rangeTo,
          currencyCode: e.currencyCode,
          prices: e.prices,
        })),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })
    }

    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const filters: Record<string, unknown> = { ...scope }

    const code = url.searchParams.get('code')
    if (code) filters.code = code
    const isActiveParam = url.searchParams.get('isActive')
    if (isActiveParam === 'true') filters.isActive = true
    else if (isActiveParam === 'false') filters.isActive = false

    // Free-text search across code, name (case-insensitive)
    const search = url.searchParams.get('search')?.trim()
    if (search) {
      filters.$or = [
        { code: { $ilike: `%${search}%` } },
        { name: { $ilike: `%${search}%` } },
      ]
    }

    // Configurable sort
    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'code', 'name'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : 'createdAt'
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    const [items, total] = await ctx.em.findAndCount(CpqPricingTable, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
    })

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        dimensions: item.dimensions,
        priceColumns: item.priceColumns,
        currencyCodeList: item.currencyCodeList,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    console.error('[cpq/pricing-tables.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqPricingTableCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const entity = ctx.em.create(CpqPricingTable, { ...body, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        code: entity.code,
        name: entity.name,
        dimensions: entity.dimensions,
        priceColumns: entity.priceColumns,
        currencyCodeList: entity.currencyCodeList,
        isActive: entity.isActive,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/pricing-tables.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqPricingTableUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqPricingTable, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      code: entity.code,
      name: entity.name,
      dimensions: entity.dimensions,
      priceColumns: entity.priceColumns,
      currencyCodeList: entity.currencyCodeList,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/pricing-tables.PUT]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }
    const entity = await ctx.em.findOne(CpqPricingTable, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/pricing-tables.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Pricing',
  summary: 'CPQ pricing tables',
  methods: {
    GET: {
      summary: 'List CPQ pricing tables, or get one by id with all its entries',
      description:
        'A pricing table is a price matrix keyed by dimensions (attribute values) with one or more price columns. With `id` returns the table plus its entries; otherwise a paged list without entries. `search` matches code or name.',
      query: cpqPaginationQuery.extend({
        id: z.string().uuid().optional(),
        code: z.string().optional(),
        isActive: z.enum(['true', 'false']).optional(),
        search: z.string().optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name']).optional(),
        sortDir: cpqSortDirQuery,
      }),
      responses: [{ status: 200, description: 'Pricing table with entries, or paged list of pricing tables' }],
      errors: [cpqErrorDoc(404, 'Pricing table not found'), cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Create a CPQ pricing table',
      requestBody: { schema: cpqPricingTableCreateSchema },
      responses: [{ status: 201, description: 'Created pricing table' }],
      errors: CPQ_CRUD_WRITE_ERRORS,
    },
    PUT: {
      summary: 'Update a CPQ pricing table definition',
      requestBody: { schema: cpqPricingTableUpdateSchema },
      responses: [{ status: 200, description: 'Updated pricing table' }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
    DELETE: {
      summary: 'Soft-delete a CPQ pricing table',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
  },
}
