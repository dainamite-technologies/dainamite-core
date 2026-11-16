import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { CpqProductCharge, CpqProductOffering, CpqProductSpecification } from '../../data/entities'
import { cpqProductChargeCreateSchema, cpqProductChargeUpdateSchema } from '../../data/validators'
import { normalizeChargePricing } from '../../data/charge-pricing'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_BY_ID_ERRORS } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
        chargeModel: item.chargeModel,
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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

    // Persist the canonical split shape regardless of whether the client sent
    // the new fields or a legacy combined pricingMethod.
    const { model, source } = normalizeChargePricing(body)
    const entity = ctx.em.create(CpqProductCharge, { ...body, chargeModel: model, pricingMethod: source, productId, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        productId: entity.productId,
        code: entity.code,
        name: entity.name,
        chargeType: entity.chargeType,
        chargeModel: entity.chargeModel,
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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqProductChargeUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductCharge, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Re-derive the canonical split shape when pricing fields are being changed,
    // and clear the opposite axis' fields so a partial PATCH can't leave a
    // stale pricingTableId on a fixed charge (or a stale fixedPrice on a table
    // charge) that the patch-only validator never sees.
    const normalizedUpdates =
      updates.pricingMethod !== undefined || updates.chargeModel !== undefined
        ? (() => {
            const { model, source } = normalizeChargePricing({ ...entity, ...updates })
            const sideCleared = source === 'fixed'
              ? { pricingTableId: null, priceColumnKey: null }
              : { fixedPrice: null }
            return { ...updates, chargeModel: model, pricingMethod: source, ...sideCleared }
          })()
        : updates
    ctx.em.assign(entity, normalizedUpdates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      productId: entity.productId,
      code: entity.code,
      name: entity.name,
      chargeType: entity.chargeType,
      chargeModel: entity.chargeModel,
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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Products',
  summary: 'CPQ product charges',
  methods: {
    GET: {
      summary: 'List the charges (price components) of a product or offering',
      description: 'Ordered by sortOrder. A charge is priced either from a fixed price or from a pricing table column.',
      query: cpqPaginationQuery.extend({
        productId: z.string().uuid().optional(),
        offeringId: z.string().uuid().optional(),
      }),
      responses: [{ status: 200, description: '`{ items, total, page, pageSize, totalPages }`' }],
      errors: [cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Create a product charge',
      description:
        "`productId` is derived from `offeringId` (via the offering's specification) when omitted. A legacy combined `pricingMethod` is normalized into `chargeModel` plus `pricingMethod` (fixed or table).",
      requestBody: { schema: cpqProductChargeCreateSchema },
      responses: [{ status: 201, description: 'Created charge' }],
      errors: [
        cpqErrorDoc(400, 'Validation error, or neither productId nor a valid offeringId given'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    PUT: {
      summary: 'Update a product charge',
      description: 'Changing `pricingMethod` or `chargeModel` re-normalizes the charge and clears the fields of the other pricing source (fixedPrice vs pricingTableId and priceColumnKey).',
      requestBody: { schema: cpqProductChargeUpdateSchema },
      responses: [{ status: 200, description: 'Updated charge' }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
    DELETE: {
      summary: 'Soft-delete a product charge',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
  },
}
