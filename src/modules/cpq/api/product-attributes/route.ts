import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqProductAttribute, CpqProductSpecification } from '../../data/entities'
import { cpqProductAttributeCreateSchema, cpqProductAttributeUpdateSchema } from '../../data/validators'

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
    const specId = url.searchParams.get('specId')
    if (specId) filters.specId = specId

    const [items, total] = await ctx.em.findAndCount(CpqProductAttribute, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        specId: item.specId,
        code: item.code,
        name: item.name,
        attributeType: item.attributeType,
        resolutionTime: item.resolutionTime,
        options: item.options,
        constraints: item.constraints,
        referenceEntity: item.referenceEntity,
        referenceFilter: item.referenceFilter,
        dependsOn: item.dependsOn,
        defaultValue: item.defaultValue,
        helpText: item.helpText,
        sortOrder: item.sortOrder,
        isRequired: item.isRequired,
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
    console.error('[cpq/product-attributes.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductAttributeCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    // Resolve productId from spec if not provided
    let productId = body.productId
    if (!productId && body.specId) {
      const spec = await ctx.em.findOne(CpqProductSpecification, { id: body.specId, ...scope, deletedAt: null })
      if (spec) productId = spec.productId
    }
    if (!productId) {
      return NextResponse.json({ error: 'productId or specId with valid specification required' }, { status: 400 })
    }

    const entity = ctx.em.create(CpqProductAttribute, { ...body, productId, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        productId: entity.productId,
        code: entity.code,
        name: entity.name,
        attributeType: entity.attributeType,
        options: entity.options,
        constraints: entity.constraints,
        sortOrder: entity.sortOrder,
        isRequired: entity.isRequired,
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
    console.error('[cpq/product-attributes.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductAttributeUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductAttribute, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      productId: entity.productId,
      code: entity.code,
      name: entity.name,
      attributeType: entity.attributeType,
      options: entity.options,
      constraints: entity.constraints,
      sortOrder: entity.sortOrder,
      isRequired: entity.isRequired,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/product-attributes.PUT]', err)
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
    const entity = await ctx.em.findOne(CpqProductAttribute, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/product-attributes.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
