import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqProductCharge, CpqProductOffering, CpqProductSpecification } from '../../data/entities'
import { cpqProductChargeCreateSchema, cpqProductChargeUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const filters: Record<string, unknown> = { ...scope }

    const productId = url.searchParams.get('productId')
    if (productId) filters.productId = productId
    const offeringId = url.searchParams.get('offeringId')
    if (offeringId) filters.offeringId = offeringId

    const [items, total] = await ctx.em.findAndCount(CpqProductCharge, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        offeringId: item.offeringId,
        code: item.code,
        name: item.name,
        description: item.description,
        chargeType: item.chargeType,
        pricingMethod: item.pricingMethod,
        pricingTableId: item.pricingTableId,
        priceColumnKey: item.priceColumnKey,
        fixedPrice: item.fixedPrice,
        currencyCode: item.currencyCode,
        quantityAttributeCode: item.quantityAttributeCode,
        applicabilityCondition: item.applicabilityCondition,
        sortOrder: item.sortOrder,
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
    console.error('[cpq/product-charges.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductChargeCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    // Resolve productId from offering if not provided
    let productId = body.productId
    if (!productId && body.offeringId) {
      const offering = await ctx.em.findOne(CpqProductOffering, { id: body.offeringId, ...scope, deletedAt: null })
      if (offering) {
        const spec = await ctx.em.findOne(CpqProductSpecification, { id: offering.specId, ...scope, deletedAt: null })
        if (spec) productId = spec.productId
      }
    }
    if (!productId) {
      return NextResponse.json({ error: 'productId or offeringId with valid offering required' }, { status: 400 })
    }

    const entity = ctx.em.create(CpqProductCharge, { ...body, productId, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        productId: entity.productId,
        code: entity.code,
        name: entity.name,
        chargeType: entity.chargeType,
        pricingMethod: entity.pricingMethod,
        pricingTableId: entity.pricingTableId,
        priceColumnKey: entity.priceColumnKey,
        quantityAttributeCode: entity.quantityAttributeCode,
        applicabilityCondition: entity.applicabilityCondition,
        sortOrder: entity.sortOrder,
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
    console.error('[cpq/product-charges.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductChargeUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductCharge, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      productId: entity.productId,
      code: entity.code,
      name: entity.name,
      chargeType: entity.chargeType,
      pricingMethod: entity.pricingMethod,
      pricingTableId: entity.pricingTableId,
      priceColumnKey: entity.priceColumnKey,
      quantityAttributeCode: entity.quantityAttributeCode,
      applicabilityCondition: entity.applicabilityCondition,
      sortOrder: entity.sortOrder,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/product-charges.PUT]', err)
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
    const entity = await ctx.em.findOne(CpqProductCharge, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/product-charges.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
