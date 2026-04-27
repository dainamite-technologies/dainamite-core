import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqPricingTableEntry } from '../../data/entities'
import { cpqPricingTableEntryCreateSchema, cpqPricingTableEntryUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.pricing.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
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
    console.error('[cpq/pricing-table-entries.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
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
      const entries = rawBody.map((item) => {
        const parsed = cpqPricingTableEntryCreateSchema.parse(item)
        return ctx.em.create(CpqPricingTableEntry, mapEntry(parsed) as any)
      })
      await ctx.em.flush()

      return NextResponse.json({ items: entries.map(serializeEntry) }, { status: 201 })
    }

    const body = cpqPricingTableEntryCreateSchema.parse(rawBody)
    const entity = ctx.em.create(CpqPricingTableEntry, mapEntry(body) as any)
    await ctx.em.flush()

    return NextResponse.json(serializeEntry(entity), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/pricing-table-entries.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
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
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updates: Record<string, unknown> = { ...rawUpdates }
    if (rawUpdates.rangeFrom !== undefined) updates.rangeFrom = rawUpdates.rangeFrom != null ? String(rawUpdates.rangeFrom) : null
    if (rawUpdates.rangeTo !== undefined) updates.rangeTo = rawUpdates.rangeTo != null ? String(rawUpdates.rangeTo) : null
    ctx.em.assign(entity, updates as any)
    await ctx.em.flush()

    return NextResponse.json(serializeEntry(entity))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/pricing-table-entries.PUT]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
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
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/pricing-table-entries.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
