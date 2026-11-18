import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { CpqPricingTable, CpqPricingTableEntry } from '../../data/entities'
import { cpqPricingTableCreateSchema, cpqPricingTableUpdateSchema } from '../../data/validators'
import { PRICING_TABLE_PURPOSES, isCostTable } from '../../data/costs'
import { assertPurposeChangeAllowed } from '../../services/costs/pricingTablePurpose'
import { canViewCosts } from '../_helpers/costAccess'
import { handleArcError } from '../_helpers/handleArcError'
import { cpqErrorDoc, cpqDeleteByIdBody, cpqSuccessResponseSchema } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.pricing.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
}

// Cost tables (`purpose = cost`) and their entries exist only for holders of
// `cpq.costs.view`: everyone else gets them filtered from lists and `404` on
// reads and writes, exactly as if they did not exist (App Spec §1.4.10).
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

function serializeTable(item: CpqPricingTable) {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    purpose: item.purpose,
    dimensions: item.dimensions,
    priceColumns: item.priceColumns,
    currencyCodeList: item.currencyCodeList,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

const listQuery = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  code: z.string().optional(),
  purpose: z.enum(PRICING_TABLE_PURPOSES).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

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
      if (!item) return notFound()
      if (isCostTable(item) && !(await canViewCosts(ctx))) return notFound()

      const entries = await ctx.em.find(CpqPricingTableEntry, {
        pricingTableId: item.id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      })

      return NextResponse.json({
        ...serializeTable(item),
        entries: entries.map((e) => ({
          id: e.id,
          dimensionValues: e.dimensionValues,
          tierNumber: e.tierNumber,
          rangeFrom: e.rangeFrom,
          rangeTo: e.rangeTo,
          currencyCode: e.currencyCode,
          prices: e.prices,
        })),
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

    const purposeParam = url.searchParams.get('purpose')
    if (purposeParam === 'price' || purposeParam === 'cost') filters.purpose = purposeParam
    if (!(await canViewCosts(ctx))) {
      if (filters.purpose === 'cost') return NextResponse.json({ items: [], total: 0, page, pageSize, totalPages: 0 })
      filters.purpose = 'price'
    }

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
      items: items.map(serializeTable),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-tables.GET')
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqPricingTableCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    if (isCostTable(body) && !(await canViewCosts(ctx))) {
      return NextResponse.json({ error: 'COSTS_VIEW_REQUIRED' }, { status: 403 })
    }

    const entity = ctx.em.create(CpqPricingTable, { ...body, ...scope })
    await ctx.em.flush()

    return NextResponse.json(serializeTable(entity), { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-tables.POST')
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
    if (!entity) return notFound()
    if ((isCostTable(entity) || isCostTable(updates)) && !(await canViewCosts(ctx))) {
      // Hidden table → 404; turning a visible table into a cost table needs the grant.
      return isCostTable(entity) ? notFound() : NextResponse.json({ error: 'COSTS_VIEW_REQUIRED' }, { status: 403 })
    }
    await assertPurposeChangeAllowed(ctx.em, entity, updates.purpose, { organizationId: ctx.organizationId, tenantId: ctx.tenantId })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json(serializeTable(entity))
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-tables.PUT')
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
    if (!entity) return notFound()
    if (isCostTable(entity) && !(await canViewCosts(ctx))) return notFound()

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-tables.DELETE')
  }
}

const tableResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  purpose: z.enum(PRICING_TABLE_PURPOSES),
  dimensions: z.array(z.object({ key: z.string(), label: z.string() })),
  priceColumns: z.array(z.object({ key: z.string(), label: z.string() })),
  currencyCodeList: z.array(z.string()),
  isActive: z.boolean(),
}).passthrough()
const hidden = 'Cost tables (purpose = cost) require cpq.costs.view: filtered from lists, 404 on reads and writes.'
const internalError = cpqErrorDoc(500, 'Internal error')

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Pricing',
  summary: 'CPQ pricing tables',
  methods: {
    GET: {
      summary: 'List CPQ pricing tables, or get one by id with all its entries',
      description:
        `A pricing table is a price matrix keyed by dimensions (attribute values) with one or more price columns. With \`id\` returns the table plus its entries; otherwise a paged list without entries. \`search\` matches code or name. ${hidden}`,
      query: listQuery,
      responses: [{ status: 200, description: 'Pricing table with entries, or paged list of pricing tables' }],
      errors: [cpqErrorDoc(404, 'Pricing table not found or hidden'), internalError],
    },
    POST: {
      summary: 'Create a CPQ pricing table',
      description: hidden,
      requestBody: { schema: cpqPricingTableCreateSchema },
      responses: [{ status: 201, description: 'Created pricing table', schema: tableResponseSchema }],
      errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'COSTS_VIEW_REQUIRED for purpose = cost'), internalError],
    },
    PUT: {
      summary: 'Update a CPQ pricing table definition',
      description: `${hidden} \`purpose\` is immutable while a charge or cost element references the table.`,
      requestBody: { schema: cpqPricingTableUpdateSchema },
      responses: [{ status: 200, description: 'Updated pricing table', schema: tableResponseSchema }],
      errors: [cpqErrorDoc(400, 'Validation error or missing id'), cpqErrorDoc(403, 'COSTS_VIEW_REQUIRED for purpose = cost'), cpqErrorDoc(404, 'Pricing table not found or hidden'), cpqErrorDoc(422, 'PURPOSE_LOCKED'), internalError],
    },
    DELETE: {
      summary: 'Soft-delete a CPQ pricing table',
      description: hidden,
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: [cpqErrorDoc(400, 'Missing id'), cpqErrorDoc(404, 'Pricing table not found or hidden'), internalError],
    },
  },
}
