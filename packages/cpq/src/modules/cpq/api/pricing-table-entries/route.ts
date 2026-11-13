import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext, type CpqRouteContext } from '../context'
import { CpqPricingTable, CpqPricingTableEntry } from '../../data/entities'
import { cpqPricingTableEntryCreateSchema, cpqPricingTableEntryUpdateSchema } from '../../data/validators'
import { canViewCosts } from '../_helpers/costAccess'
import { handleArcError } from '../_helpers/handleArcError'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.pricing.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/**
 * Whether every given table is visible to the caller. Entries of a cost table
 * (`purpose = cost`) exist only for `cpq.costs.view` holders; for everyone
 * else the route answers `404` as if the table did not exist. The RBAC lookup
 * runs only when a cost table is involved.
 */
async function tablesVisible(ctx: CpqRouteContext, tableIds: string[]): Promise<boolean> {
  const ids = [...new Set(tableIds)]
  if (ids.length === 0) return true
  const costTables = await ctx.em.count(CpqPricingTable, {
    id: { $in: ids }, organizationId: ctx.organizationId, tenantId: ctx.tenantId, purpose: 'cost',
  })
  return costTables === 0 || await canViewCosts(ctx)
}

function serializeEntry(e: CpqPricingTableEntry) {
  return {
    id: e.id,
    pricingTableId: e.pricingTableId,
    dimensionValues: e.dimensionValues,
    tierNumber: e.tierNumber,
    rangeFrom: e.rangeFrom,
    rangeTo: e.rangeTo,
    currencyCode: e.currencyCode,
    prices: e.prices,
    isActive: e.isActive,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const pricingTableId = url.searchParams.get('pricingTableId')
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!pricingTableId || !uuidRegex.test(pricingTableId)) {
      return NextResponse.json({ error: 'pricingTableId is required and must be a valid UUID' }, { status: 400 })
    }

    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    if (!(await tablesVisible(ctx, [pricingTableId]))) return notFound()

    const filters: Record<string, unknown> = { ...scope, pricingTableId }

    const [items, total] = await ctx.em.findAndCount(CpqPricingTableEntry, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      items: items.map(serializeEntry),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-table-entries.GET')
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const rawBody = await req.json()

    const mapEntry = (parsed: ReturnType<typeof cpqPricingTableEntryCreateSchema.parse>) => ({
      ...scope,
      pricingTableId: parsed.pricingTableId,
      dimensionValues: parsed.dimensionValues as Record<string, string>,
      tierNumber: parsed.tierNumber ?? null,
      rangeFrom: parsed.rangeFrom != null ? String(parsed.rangeFrom) : null,
      rangeTo: parsed.rangeTo != null ? String(parsed.rangeTo) : null,
      currencyCode: parsed.currencyCode,
      prices: parsed.prices as Record<string, number>,
      isActive: parsed.isActive,
    })

    if (Array.isArray(rawBody)) {
      const parsedEntries = rawBody.map((item) => cpqPricingTableEntryCreateSchema.parse(item))
      if (!(await tablesVisible(ctx, parsedEntries.map((entry) => entry.pricingTableId)))) return notFound()
      const entries = parsedEntries.map((parsed) => ctx.em.create(CpqPricingTableEntry, mapEntry(parsed) as any))
      await ctx.em.flush()

      return NextResponse.json({ items: entries.map(serializeEntry) }, { status: 201 })
    }

    const body = cpqPricingTableEntryCreateSchema.parse(rawBody)
    if (!(await tablesVisible(ctx, [body.pricingTableId]))) return notFound()
    const entity = ctx.em.create(CpqPricingTableEntry, mapEntry(body) as any)
    await ctx.em.flush()

    return NextResponse.json(serializeEntry(entity), { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-table-entries.POST')
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqPricingTableEntryUpdateSchema.parse(await req.json())
    const { id, ...rawUpdates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqPricingTableEntry, { id, ...scope })
    if (!entity) return notFound()
    const touched = rawUpdates.pricingTableId ? [entity.pricingTableId, rawUpdates.pricingTableId] : [entity.pricingTableId]
    if (!(await tablesVisible(ctx, touched))) return notFound()

    const updates: Record<string, unknown> = { ...rawUpdates }
    if (rawUpdates.rangeFrom !== undefined) updates.rangeFrom = rawUpdates.rangeFrom != null ? String(rawUpdates.rangeFrom) : null
    if (rawUpdates.rangeTo !== undefined) updates.rangeTo = rawUpdates.rangeTo != null ? String(rawUpdates.rangeTo) : null
    ctx.em.assign(entity, updates as any)
    await ctx.em.flush()

    return NextResponse.json(serializeEntry(entity))
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-table-entries.PUT')
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }
    const entity = await ctx.em.findOne(CpqPricingTableEntry, { id, ...scope })
    if (!entity) return notFound()
    if (!(await tablesVisible(ctx, [entity.pricingTableId]))) return notFound()

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    return handleArcError(err, 'cpq/pricing-table-entries.DELETE')
  }
}

const entrySchema = z.object({
  id: z.string().uuid(),
  pricingTableId: z.string().uuid(),
  dimensionValues: z.record(z.string(), z.string()),
  tierNumber: z.number().nullable(),
  rangeFrom: z.string().nullable(),
  rangeTo: z.string().nullable(),
  currencyCode: z.string(),
  prices: z.record(z.string(), z.number()),
  isActive: z.boolean(),
}).passthrough()
const hidden = 'Entries of a cost table (purpose = cost) require cpq.costs.view; without it every method answers 404.'
const hiddenError = cpqErrorDoc(404, 'Entry or table not found, or a hidden cost table')

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Pricing',
  methods: {
    GET: {
      summary: 'List the entries of a pricing table',
      description: hidden,
      query: z.object({
        pricingTableId: z.string().uuid(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }),
      responses: [{ status: 200, description: 'Paged entries', schema: z.object({ items: z.array(entrySchema), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number() }) }],
      errors: [cpqErrorDoc(400, 'pricingTableId missing or invalid'), hiddenError],
    },
    POST: {
      summary: 'Create one entry, or several from an array body',
      description: hidden,
      requestBody: { schema: z.union([cpqPricingTableEntryCreateSchema, z.array(cpqPricingTableEntryCreateSchema)]) },
      responses: [{ status: 201, description: 'Created entry, or `{ items }` for an array body' }],
      errors: [cpqErrorDoc(400, 'Validation error'), hiddenError],
    },
    PUT: {
      summary: 'Update a pricing table entry',
      description: hidden,
      requestBody: { schema: cpqPricingTableEntryUpdateSchema },
      responses: [{ status: 200, description: 'Updated entry', schema: entrySchema }],
      errors: [cpqErrorDoc(400, 'Validation error'), hiddenError],
    },
    DELETE: {
      summary: 'Soft-delete a pricing table entry',
      description: hidden,
      requestBody: { schema: z.object({ id: z.string().uuid() }) },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ success: z.boolean() }) }],
      errors: [cpqErrorDoc(400, 'Missing id'), hiddenError],
    },
  },
}
