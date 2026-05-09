import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqPricingTable, CpqPricingTableEntry } from '../../data/entities'
import { cpqPricingTableCreateSchema, cpqPricingTableUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.pricing.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    const [items, total] = await ctx.em.findAndCount(CpqPricingTable, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' },
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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
