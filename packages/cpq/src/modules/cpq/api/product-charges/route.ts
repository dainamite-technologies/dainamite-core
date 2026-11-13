import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext, type CpqRouteContext } from '../context'
import { CpqProductCharge, CpqProductOffering, CpqProductSpecification } from '../../data/entities'
import { chargePricingShapeIssues, cpqProductChargeCreateSchema, cpqProductChargeUpdateSchema } from '../../data/validators'
import { normalizeChargePricing } from '../../data/charge-pricing'
import { anyChargeHasMarkup, chargeMarkupFields } from '../../lib/chargeView'
import type { CpqCostService } from '../../services/costs/costService'
import { QuotingError } from '../../services/cpqQuotingService'
import { assertPriceTable } from '../../services/costs/pricingTablePurpose'
import { canViewCosts } from '../_helpers/costAccess'
import { handleArcError } from '../_helpers/handleArcError'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.products.manage'] },
}

const COST_PLUS = 'cost_plus'

/** The one charge serializer; markup only with `cpq.costs.view` (lib/chargeView.ts). */
function serializeCharge(item: CpqProductCharge, showCosts: boolean) {
  return {
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
    ...chargeMarkupFields(item, showCosts),
    applicabilityCondition: item.applicabilityCondition,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

/**
 * Cost-plus writes need `cpq.costs.view` (markup is confidential), the tenant
 * toggle, and an engine that can price them (CpqCostService gate).
 */
async function assertCostPlusWrite(ctx: CpqRouteContext): Promise<void> {
  if (!(await canViewCosts(ctx))) throw new QuotingError(403, 'COSTS_VIEW_REQUIRED')
  await costService(ctx).assertCostPlusChargeWritable(ctx.tenantId)
}

const costService = (ctx: CpqRouteContext) => ctx.container.resolve<CpqCostService>('cpqCostService')

const touchesMarkup = (body: { markupRule?: unknown; markupValue?: unknown }) =>
  body.markupRule !== undefined || body.markupValue !== undefined

const markupColumn = (value: number | null | undefined) =>
  value === undefined ? undefined : value === null ? null : String(value)

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  productId: z.string().uuid().optional(),
  offeringId: z.string().uuid().optional(),
})

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
    // Only pay for the RBAC lookup when a row actually carries markup.
    const showCosts = anyChargeHasMarkup(items) && await canViewCosts(ctx)

    return NextResponse.json({
      items: items.map((item) => serializeCharge(item, showCosts)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    return handleArcError(err, 'cpq/product-charges.GET')
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductChargeCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const isCostPlus = body.pricingMethod === COST_PLUS
    if (isCostPlus) {
      await assertCostPlusWrite(ctx)
      // A new charge has no cost elements yet: an active cost-plus charge is
      // refused (NO_PRICE_BASIS_ELEMENT) — create it inactive, add elements, activate.
      await costService(ctx).assertCostPlusChargeHasPriceBasis(ctx.em, { pricingMethod: COST_PLUS, isActive: body.isActive }, scope)
    }

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
    if (!isCostPlus && source === 'table') await assertPriceTable(ctx.em, body.pricingTableId, scope)
    const entity = ctx.em.create(CpqProductCharge, {
      ...body,
      markupValue: markupColumn(body.markupValue),
      chargeModel: model,
      pricingMethod: isCostPlus ? COST_PLUS : source,
      productId,
      ...scope,
    })
    await ctx.em.flush()

    return NextResponse.json(serializeCharge(entity, isCostPlus), { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/product-charges.POST')
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

    const pricingChanged = updates.pricingMethod !== undefined || updates.chargeModel !== undefined
    const nextMethod = updates.pricingMethod ?? entity.pricingMethod
    const toCostPlus = nextMethod === COST_PLUS
    const markupChanged = touchesMarkup(updates)

    // Re-derive the canonical split shape when pricing fields are being changed,
    // and clear the opposite axis' fields so a partial PATCH can't leave a
    // stale pricingTableId on a fixed charge (or a stale fixedPrice on a table
    // charge, or a stale markup on a non-cost-plus charge) that the patch-only
    // validator never sees.
    const normalizedUpdates: Record<string, unknown> = { ...updates, markupValue: markupColumn(updates.markupValue) }
    if (normalizedUpdates.markupValue === undefined) delete normalizedUpdates.markupValue
    if (pricingChanged) {
      const { model, source } = normalizeChargePricing({ ...entity, ...updates })
      const sideCleared = toCostPlus
        ? { pricingTableId: null, priceColumnKey: null }
        : source === 'fixed'
          ? { pricingTableId: null, priceColumnKey: null, markupRule: null, markupValue: null }
          : { fixedPrice: null, markupRule: null, markupValue: null }
      Object.assign(normalizedUpdates, { chargeModel: model, pricingMethod: toCostPlus ? COST_PLUS : source, ...sideCleared })
    }

    // A partial update only refines the patched fields; validate the merged
    // charge whenever it is (or becomes) cost-plus or its markup changes.
    if (toCostPlus || markupChanged) {
      const issues = chargePricingShapeIssues({ ...entity, ...normalizedUpdates } as Parameters<typeof chargePricingShapeIssues>[0])
      if (issues.length) return NextResponse.json({ error: 'Validation error', details: issues }, { status: 400 })
    }
    const activating = updates.isActive === true && !entity.isActive
    if (toCostPlus && (updates.pricingMethod === COST_PLUS || markupChanged || activating)) {
      await assertCostPlusWrite(ctx)
      await costService(ctx).assertCostPlusChargeHasPriceBasis(ctx.em,
        { id: entity.id, pricingMethod: COST_PLUS, isActive: updates.isActive ?? entity.isActive }, scope)
    }
    if (updates.pricingTableId && updates.pricingTableId !== entity.pricingTableId) {
      await assertPriceTable(ctx.em, updates.pricingTableId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId })
    }

    // Leaving cost-plus: `price_basis` is only valid on cost-plus charges, so
    // its price-basis elements are deactivated in the same flush.
    if (entity.pricingMethod === COST_PLUS && !toCostPlus) await costService(ctx).deactivatePriceBasisElements(ctx.em, entity.id, scope)
    ctx.em.assign(entity, normalizedUpdates)
    await ctx.em.flush()

    const showCosts = anyChargeHasMarkup([entity]) && await canViewCosts(ctx)
    return NextResponse.json(serializeCharge(entity, showCosts))
  } catch (err) {
    return handleArcError(err, 'cpq/product-charges.PUT')
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
    await costService(ctx).deleteChargeElements(ctx.em, entity.id, scope)
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    return handleArcError(err, 'cpq/product-charges.DELETE')
  }
}

const chargeResponseSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  offeringId: z.string().uuid().nullable(),
  code: z.string(),
  name: z.string(),
  chargeType: z.string(),
  chargeModel: z.string().nullable(),
  pricingMethod: z.string().describe('fixed | table | cost_plus'),
  pricingTableId: z.string().uuid().nullable(),
  priceColumnKey: z.string().nullable(),
  fixedPrice: z.string().nullable(),
  currencyCode: z.string().nullable(),
  quantityAttributeCode: z.string().nullable(),
  markupRule: z.string().nullable().optional().describe('Only with cpq.costs.view'),
  markupValue: z.string().nullable().optional().describe('Only with cpq.costs.view'),
  sortOrder: z.number(),
  isActive: z.boolean(),
}).passthrough()
const writeErrors = [
  cpqErrorDoc(400, 'Validation error (V-CHG-1)'),
  cpqErrorDoc(403, 'COSTS_VIEW_REQUIRED — cost-plus pricing and markup need cpq.costs.view'),
  cpqErrorDoc(404, 'Charge not found'),
  cpqErrorDoc(422, 'COST_PLUS_DISABLED (tenant toggle off), COST_PLUS_NOT_AVAILABLE, NO_PRICE_BASIS_ELEMENT (activating a cost-plus charge without an active price-basis cost element), or WRONG_TABLE_PURPOSE (a price charge referencing a cost table)'),
]

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Products',
  methods: {
    GET: {
      summary: 'List product charges',
      description: 'Markup fields are omitted for users without cpq.costs.view.',
      query: listQuery,
      responses: [{ status: 200, description: 'Paged charges', schema: z.object({ items: z.array(chargeResponseSchema), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number() }) }],
      errors: [cpqErrorDoc(401, 'Unauthorized')],
    },
    POST: {
      summary: 'Create a product charge',
      requestBody: { schema: cpqProductChargeCreateSchema },
      responses: [{ status: 201, description: 'Created charge', schema: chargeResponseSchema }],
      errors: writeErrors,
    },
    PUT: {
      summary: 'Update a product charge',
      requestBody: { schema: cpqProductChargeUpdateSchema },
      responses: [{ status: 200, description: 'Updated charge', schema: chargeResponseSchema }],
      errors: writeErrors,
    },
    DELETE: {
      summary: 'Soft-delete a product charge',
      requestBody: { schema: z.object({ id: z.string().uuid() }) },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ success: z.boolean() }) }],
      errors: [cpqErrorDoc(400, 'Missing id'), cpqErrorDoc(404, 'Charge not found')],
    },
  },
}
