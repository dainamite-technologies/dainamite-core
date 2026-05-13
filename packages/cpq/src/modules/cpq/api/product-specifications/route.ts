import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqProductSpecification, CpqProductAttribute, CpqProductOffering, CpqProductRelationship, CpqBundleSlot } from '../../data/entities'
import { cpqProductSpecificationCreateSchema, cpqProductSpecificationUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.specifications.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    // Detail view — load spec with related entities
    const id = url.searchParams.get('id')
    if (id) {
      const spec = await ctx.em.findOne(CpqProductSpecification, { id, ...scope })
      if (!spec) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const [attributes, offerings, relationships, bundleSlots] = await Promise.all([
        ctx.em.find(CpqProductAttribute, { specId: spec.id, ...scope }, { orderBy: { sortOrder: 'asc' } }),
        ctx.em.find(CpqProductOffering, { specId: spec.id, ...scope }, { orderBy: { createdAt: 'asc' } }),
        ctx.em.find(CpqProductRelationship, {
          $or: [{ sourceSpecId: spec.id }, { targetSpecId: spec.id }],
          ...scope,
        }),
        spec.specType === 'bundle'
          ? ctx.em.find(CpqBundleSlot, { specId: spec.id, ...scope }, { orderBy: { sortOrder: 'asc' } })
          : Promise.resolve([]),
      ])

      // Resolve target specs for slots
      let slotsWithTargetSpec: Array<Record<string, unknown>> = []
      if (bundleSlots.length > 0) {
        const targetSpecIds = [...new Set(bundleSlots.map((s) => s.targetSpecId))]
        const targetSpecs = await ctx.em.find(CpqProductSpecification, { id: { $in: targetSpecIds }, ...scope })
        const specMap = new Map(targetSpecs.map((s) => [s.id, s]))
        slotsWithTargetSpec = bundleSlots.map((s) => {
          const ts = specMap.get(s.targetSpecId)
          return {
            id: s.id,
            componentGroup: s.componentGroup,
            name: s.name,
            description: s.description,
            targetSpecId: s.targetSpecId,
            targetSpec: ts ? { id: ts.id, code: ts.code, name: ts.name, specType: ts.specType } : null,
            cardinalityMin: s.cardinalityMin,
            cardinalityMax: s.cardinalityMax,
            sortOrder: s.sortOrder,
            isActive: s.isActive,
          }
        })
      }

      return NextResponse.json({
        id: spec.id,
        productId: spec.productId,
        code: spec.code,
        name: spec.name,
        description: spec.description,
        specType: spec.specType,
        isAssetizable: spec.isAssetizable,
        lifecycleStatus: spec.lifecycleStatus,
        version: spec.version,
        effectiveFrom: spec.effectiveFrom,
        effectiveTo: spec.effectiveTo,
        metadata: spec.metadata,
        isActive: spec.isActive,
        createdAt: spec.createdAt,
        updatedAt: spec.updatedAt,
        attributes: attributes.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          attributeType: a.attributeType,
          resolutionTime: a.resolutionTime,
          options: a.options,
          constraints: a.constraints,
          referenceEntity: a.referenceEntity,
          referenceFilter: a.referenceFilter,
          dependsOn: a.dependsOn,
          defaultValue: a.defaultValue,
          helpText: a.helpText,
          sortOrder: a.sortOrder,
          isRequired: a.isRequired,
          isActive: a.isActive,
        })),
        offerings: offerings.map((o) => ({
          id: o.id,
          code: o.code,
          name: o.name,
          offeringType: o.offeringType,
          designTimeValues: o.designTimeValues,
          lifecycleStatus: o.lifecycleStatus,
          isActive: o.isActive,
        })),
        relationships: relationships.map((r) => ({
          id: r.id,
          sourceSpecId: r.sourceSpecId,
          targetSpecId: r.targetSpecId,
          relationshipType: r.relationshipType,
          cardinalityMin: r.cardinalityMin,
          cardinalityMax: r.cardinalityMax,
          condition: r.condition,
          isActive: r.isActive,
        })),
        ...(spec.specType === 'bundle' ? { slots: slotsWithTargetSpec } : {}),
      })
    }

    // List view
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const filters: Record<string, unknown> = { ...scope }
    const productId = url.searchParams.get('productId')
    if (productId) filters.productId = productId
    const lifecycleStatus = url.searchParams.get('lifecycleStatus')
    if (lifecycleStatus) filters.lifecycleStatus = lifecycleStatus
    const code = url.searchParams.get('code')
    if (code) filters.code = code
    const specType = url.searchParams.get('specType')
    if (specType) filters.specType = specType
    const isActiveParam = url.searchParams.get('isActive')
    if (isActiveParam === 'true') filters.isActive = true
    else if (isActiveParam === 'false') filters.isActive = false
    const isAssetizableParam = url.searchParams.get('isAssetizable')
    if (isAssetizableParam === 'true') filters.isAssetizable = true
    else if (isAssetizableParam === 'false') filters.isAssetizable = false

    // Free-text search across code, name, description (case-insensitive)
    const search = url.searchParams.get('search')?.trim()
    if (search) {
      filters.$or = [
        { code: { $ilike: `%${search}%` } },
        { name: { $ilike: `%${search}%` } },
        { description: { $ilike: `%${search}%` } },
      ]
    }

    // Configurable sort
    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'code', 'name', 'lifecycleStatus', 'specType', 'version'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : 'createdAt'
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    const [items, total] = await ctx.em.findAndCount(CpqProductSpecification, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
    })

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        code: item.code,
        name: item.name,
        description: item.description,
        specType: item.specType,
        isAssetizable: item.isAssetizable,
        lifecycleStatus: item.lifecycleStatus,
        version: item.version,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
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
    console.error('[cpq/product-specifications.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductSpecificationCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    let productId = body.productId
    if (!productId) {
      // Auto-create or reuse a CatalogProduct from the specification properties
      const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')
      const handle = body.code.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      const sku = body.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '-')

      // Check if a product with this handle or SKU already exists
      const existing = await ctx.em.findOne(CatalogProduct, {
        ...scope,
        $or: [{ handle }, { sku }],
        deletedAt: null,
      })

      if (existing) {
        productId = existing.id
      } else {
        const product = ctx.em.create(CatalogProduct, {
          ...scope,
          title: body.name,
          sku,
          handle,
          description: body.description ?? null,
          productType: 'configurable',
          isConfigurable: true,
          isActive: true,
        })
        ctx.em.persist(product)
        await ctx.em.flush()
        productId = product.id
      }
    }

    const entity = ctx.em.create(CpqProductSpecification, { ...body, productId, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        productId: entity.productId,
        code: entity.code,
        name: entity.name,
        description: entity.description,
        specType: entity.specType,
        isAssetizable: entity.isAssetizable,
        lifecycleStatus: entity.lifecycleStatus,
        version: entity.version,
        effectiveFrom: entity.effectiveFrom,
        effectiveTo: entity.effectiveTo,
        metadata: entity.metadata,
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
    console.error('[cpq/product-specifications.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductSpecificationUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductSpecification, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      productId: entity.productId,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      specType: entity.specType,
      isAssetizable: entity.isAssetizable,
      lifecycleStatus: entity.lifecycleStatus,
      version: entity.version,
      effectiveFrom: entity.effectiveFrom,
      effectiveTo: entity.effectiveTo,
      metadata: entity.metadata,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/product-specifications.PUT]', err)
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
    const entity = await ctx.em.findOne(CpqProductSpecification, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/product-specifications.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
