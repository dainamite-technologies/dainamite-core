import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { CpqProductOffering, CpqProductCharge, CpqProductSpecification, CpqOfferingComponent, CpqBundleSlot } from '../../data/entities'
import { cpqProductOfferingCreateSchema, cpqProductOfferingUpdateSchema } from '../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqSortDirQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_BY_ID_ERRORS } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.offerings.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    // Detail view — load offering with spec and charges
    const id = url.searchParams.get('id')
    if (id) {
      const offering = await ctx.em.findOne(CpqProductOffering, { id, ...scope })
      if (!offering) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const [spec, charges] = await Promise.all([
        ctx.em.findOne(CpqProductSpecification, { id: offering.specId, ...scope }),
        ctx.em.find(CpqProductCharge, { offeringId: offering.id, ...scope }, { orderBy: { sortOrder: 'asc' } }),
      ])

      // Load components for bundle offerings
      let componentsData: Array<Record<string, unknown>> = []
      if (offering.offeringType === 'bundle') {
        const components = await ctx.em.find(CpqOfferingComponent, { offeringId: offering.id, ...scope }, { orderBy: { sortOrder: 'asc' } })
        if (components.length > 0) {
          const slotIds = [...new Set(components.map((c) => c.slotId))]
          const childOfferingIds = [...new Set(components.map((c) => c.childOfferingId))]
          const [slots, childOfferings] = await Promise.all([
            ctx.em.find(CpqBundleSlot, { id: { $in: slotIds }, ...scope }),
            ctx.em.find(CpqProductOffering, { id: { $in: childOfferingIds }, ...scope }),
          ])
          const slotMap = new Map(slots.map((s) => [s.id, s]))
          const offeringMap = new Map(childOfferings.map((o) => [o.id, o]))
          componentsData = components.map((c) => {
            const sl = slotMap.get(c.slotId)
            const ch = offeringMap.get(c.childOfferingId)
            return {
              id: c.id,
              slotId: c.slotId,
              slot: sl ? { id: sl.id, componentGroup: sl.componentGroup, name: sl.name, cardinalityMin: sl.cardinalityMin, cardinalityMax: sl.cardinalityMax } : null,
              childOfferingId: c.childOfferingId,
              childOffering: ch ? { id: ch.id, code: ch.code, name: ch.name, offeringType: ch.offeringType, specId: ch.specId, isSellable: ch.isSellable } : null,
              isDefault: c.isDefault,
              sortOrder: c.sortOrder,
              isActive: c.isActive,
            }
          })
        }
      }

      return NextResponse.json({
        id: offering.id,
        specId: offering.specId,
        catalogOfferId: offering.catalogOfferId,
        code: offering.code,
        name: offering.name,
        description: offering.description,
        offeringType: offering.offeringType,
        designTimeValues: offering.designTimeValues,
        lifecycleStatus: offering.lifecycleStatus,
        isSellable: offering.isSellable,
        effectiveFrom: offering.effectiveFrom,
        effectiveTo: offering.effectiveTo,
        metadata: offering.metadata,
        isActive: offering.isActive,
        createdAt: offering.createdAt,
        updatedAt: offering.updatedAt,
        specification: spec
          ? {
              id: spec.id,
              code: spec.code,
              name: spec.name,
              productId: spec.productId,
              specType: spec.specType,
              defaultOfferingSellable: spec.defaultOfferingSellable,
            }
          : null,
        charges: charges.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          chargeType: c.chargeType,
          chargeModel: c.chargeModel,
          pricingMethod: c.pricingMethod,
          pricingTableId: c.pricingTableId,
          priceColumnKey: c.priceColumnKey,
          fixedPrice: c.fixedPrice,
          currencyCode: c.currencyCode,
          quantityAttributeCode: c.quantityAttributeCode,
          applicabilityCondition: c.applicabilityCondition,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
        })),
        ...(offering.offeringType === 'bundle' ? { components: componentsData } : {}),
      })
    }

    // List view
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const filters: Record<string, unknown> = { ...scope }
    const specId = url.searchParams.get('specId')
    if (specId) filters.specId = specId
    const lifecycleStatus = url.searchParams.get('lifecycleStatus')
    if (lifecycleStatus) filters.lifecycleStatus = lifecycleStatus
    const code = url.searchParams.get('code')
    if (code) filters.code = code
    const offeringType = url.searchParams.get('offeringType')
    if (offeringType) filters.offeringType = offeringType
    const isActiveParam = url.searchParams.get('isActive')
    if (isActiveParam === 'true') filters.isActive = true
    else if (isActiveParam === 'false') filters.isActive = false
    // #133: quote pickers pass `isSellable=true` to hide component-only offerings.
    const isSellableParam = url.searchParams.get('isSellable')
    if (isSellableParam === 'true') filters.isSellable = true
    else if (isSellableParam === 'false') filters.isSellable = false

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
    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'code', 'name', 'lifecycleStatus', 'offeringType'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : 'createdAt'
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    const [items, total] = await ctx.em.findAndCount(CpqProductOffering, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
    })

    // Batch-load charges for all visible offerings in a single query
    // (replaces an N+1 pattern where the UI fetched each offering's detail separately).
    const offeringIds = items.map((item) => item.id)
    const chargesByOffering = new Map<string, Array<Record<string, unknown>>>()
    if (offeringIds.length > 0) {
      const allCharges = await ctx.em.find(
        CpqProductCharge,
        { offeringId: { $in: offeringIds }, ...scope },
        { orderBy: { sortOrder: 'asc' } },
      )
      for (const c of allCharges) {
        if (!c.offeringId) continue
        const list = chargesByOffering.get(c.offeringId) ?? []
        list.push({
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          chargeType: c.chargeType,
          chargeModel: c.chargeModel,
          pricingMethod: c.pricingMethod,
          pricingTableId: c.pricingTableId,
          priceColumnKey: c.priceColumnKey,
          fixedPrice: c.fixedPrice,
          currencyCode: c.currencyCode,
          quantityAttributeCode: c.quantityAttributeCode,
          applicabilityCondition: c.applicabilityCondition,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
        })
        chargesByOffering.set(c.offeringId, list)
      }
    }

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        specId: item.specId,
        catalogOfferId: item.catalogOfferId,
        code: item.code,
        name: item.name,
        description: item.description,
        offeringType: item.offeringType,
        designTimeValues: item.designTimeValues,
        lifecycleStatus: item.lifecycleStatus,
        isSellable: item.isSellable,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        charges: chargesByOffering.get(item.id) ?? [],
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    console.error('[cpq/product-offerings.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqProductOfferingCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    // Validate that the spec exists
    const spec = await ctx.em.findOne(CpqProductSpecification, {
      id: body.specId,
      ...scope,
      deletedAt: null,
    })
    if (!spec) return NextResponse.json({ error: 'Specification not found' }, { status: 400 })

    // V-OFF-7: offeringType must match spec's specType. When the caller omits
    // it, the offering takes the specification's type.
    const offeringType = body.offeringType ?? (spec.specType === 'bundle' ? 'bundle' : 'simple')
    if (offeringType !== spec.specType) {
      return NextResponse.json(
        { error: `V-OFF-7: offeringType '${offeringType}' must match specification's specType '${spec.specType}'` },
        { status: 400 },
      )
    }

    // #133: when the caller omits `isSellable`, the spec's default pre-fills it.
    const isSellable = body.isSellable ?? spec.defaultOfferingSellable ?? true
    const entity = ctx.em.create(CpqProductOffering, { ...body, offeringType, isSellable, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        specId: entity.specId,
        catalogOfferId: entity.catalogOfferId,
        code: entity.code,
        name: entity.name,
        description: entity.description,
        offeringType: entity.offeringType,
        designTimeValues: entity.designTimeValues,
        lifecycleStatus: entity.lifecycleStatus,
        isSellable: entity.isSellable,
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
    console.error('[cpq/product-offerings.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqProductOfferingUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductOffering, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // V-OFF-7 on update: when the spec or the offering type changes, the
    // resulting offeringType must still match the specification's specType.
    // The detail page always resends both fields, so only a value that differs
    // from the stored one counts as a change; legacy rows stay editable.
    const specChanged = updates.specId !== undefined && updates.specId !== entity.specId
    const typeChanged = updates.offeringType !== undefined && updates.offeringType !== entity.offeringType
    if (specChanged || typeChanged) {
      const spec = await ctx.em.findOne(CpqProductSpecification, {
        id: updates.specId ?? entity.specId,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      })
      if (!spec) return NextResponse.json({ error: 'Specification not found' }, { status: 400 })
      const offeringType = updates.offeringType ?? entity.offeringType ?? 'simple'
      if (offeringType !== spec.specType) {
        return NextResponse.json(
          { error: `V-OFF-7: offeringType '${offeringType}' must match specification's specType '${spec.specType}'` },
          { status: 400 },
        )
      }
    }

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      specId: entity.specId,
      catalogOfferId: entity.catalogOfferId,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      offeringType: entity.offeringType,
      designTimeValues: entity.designTimeValues,
      lifecycleStatus: entity.lifecycleStatus,
      isSellable: entity.isSellable,
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
    console.error('[cpq/product-offerings.PUT]', err)
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
    const entity = await ctx.em.findOne(CpqProductOffering, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/product-offerings.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Products',
  summary: 'CPQ product offerings',
  methods: {
    GET: {
      summary: 'List CPQ product offerings, or get one by id with its specification and charges',
      description:
        'With `id` returns the offering plus its specification, charges and (for bundles) components with slots and child offerings. Otherwise a paged list with charges per offering; `search` matches code, name or description. `isSellable=true` lists only offerings that can be quoted on their own; an offering with `isSellable: false` can only be quoted as a bundle component.',
      query: cpqPaginationQuery.extend({
        id: z.string().uuid().optional(),
        specId: z.string().uuid().optional(),
        lifecycleStatus: z.enum(['draft', 'active', 'deprecated']).optional(),
        code: z.string().optional(),
        offeringType: z.enum(['simple', 'bundle']).optional(),
        isActive: z.enum(['true', 'false']).optional(),
        isSellable: z.enum(['true', 'false']).optional().describe('`true` hides component-only offerings (only sold inside a bundle)'),
        search: z.string().optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name', 'lifecycleStatus', 'offeringType']).optional(),
        sortDir: cpqSortDirQuery,
      }),
      responses: [{ status: 200, description: 'Offering detail, or paged list of offerings' }],
      errors: [cpqErrorDoc(404, 'Offering not found'), cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Create a CPQ product offering for a specification',
      description: "`offeringType` is optional: when omitted it is taken from the specification's `specType`. When sent, it must match `specType` (V-OFF-7). `isSellable` is optional: when omitted it is taken from the specification's `defaultOfferingSellable`.",
      requestBody: { schema: cpqProductOfferingCreateSchema },
      responses: [{ status: 201, description: 'Created offering' }],
      errors: [
        cpqErrorDoc(400, 'Validation error, specification not found, or offeringType does not match specType'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    PUT: {
      summary: 'Update a CPQ product offering',
      requestBody: { schema: cpqProductOfferingUpdateSchema },
      responses: [{ status: 200, description: 'Updated offering' }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
    DELETE: {
      summary: 'Soft-delete a CPQ product offering',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
  },
}
