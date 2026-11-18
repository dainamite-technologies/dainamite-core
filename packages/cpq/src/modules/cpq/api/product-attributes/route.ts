import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { CpqProductAttribute, CpqProductSpecification } from '../../data/entities'
import { cpqProductAttributeCreateSchema, cpqProductAttributeUpdateSchema } from '../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_BY_ID_ERRORS } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
}

/**
 * Single source of truth for the attribute API shape. GET, POST and PUT MUST
 * all return this exact projection so the client never sees a partial record.
 * Omitting fields here (notably `resolutionTime`) caused XD-292: a freshly
 * created design-time attribute rendered as "run" until a page refresh, since
 * the create response lacked the field the table reads.
 */
export function serializeAttribute(item: CpqProductAttribute) {
  return {
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
  }
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
    const specId = url.searchParams.get('specId')
    if (specId) filters.specId = specId

    const [items, total] = await ctx.em.findAndCount(CpqProductAttribute, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      items: items.map(serializeAttribute),
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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

    return NextResponse.json(serializeAttribute(entity), { status: 201 })
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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqProductAttributeUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductAttribute, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json(serializeAttribute(entity))
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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Products',
  summary: 'CPQ product attributes',
  methods: {
    GET: {
      summary: 'List configurable attributes of a product or specification',
      description: 'Ordered by sortOrder. Each attribute has a `resolutionTime` of design_time (fixed per offering) or run_time (chosen when quoting).',
      query: cpqPaginationQuery.extend({
        productId: z.string().uuid().optional(),
        specId: z.string().uuid().optional(),
      }),
      responses: [{ status: 200, description: '`{ items, total, page, pageSize, totalPages }`' }],
      errors: [cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Create a product attribute',
      description: '`productId` is derived from `specId` when omitted.',
      requestBody: { schema: cpqProductAttributeCreateSchema },
      responses: [{ status: 201, description: 'Created attribute' }],
      errors: [
        cpqErrorDoc(400, 'Validation error, or neither productId nor a valid specId given'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    PUT: {
      summary: 'Update a product attribute',
      requestBody: { schema: cpqProductAttributeUpdateSchema },
      responses: [{ status: 200, description: 'Updated attribute' }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
    DELETE: {
      summary: 'Soft-delete a product attribute',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
  },
}
