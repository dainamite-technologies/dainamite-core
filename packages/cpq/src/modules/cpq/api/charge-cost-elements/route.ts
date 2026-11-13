import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext, type CpqRouteContext } from '../context'
import {
  AVAILABLE_COST_SOURCES,
  COST_MODELS,
  COST_ROLES,
  COST_TYPES,
  cpqChargeCostElementCreateSchema,
  cpqChargeCostElementUpdateSchema,
} from '../../data/costs'
import type { CpqCostService } from '../../services/costs/costService'
import { handleArcError } from '../_helpers/handleArcError'
import { CPQ_CHARGE_COST_ELEMENT_RESOURCE_KIND, runCpqMutationGuards } from '../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

/** Charge cost elements (App Spec §1.4.4): cost catalog, confidential to `cpq.costs.view`. */
const WRITE_FEATURES = ['cpq.products.manage', 'cpq.pricing.manage', 'cpq.costs.view']
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.products.view', 'cpq.costs.view'] },
  POST: { requireAuth: true, requireFeatures: WRITE_FEATURES },
  PUT: { requireAuth: true, requireFeatures: WRITE_FEATURES },
  DELETE: { requireAuth: true, requireFeatures: WRITE_FEATURES },
}

const listQuery = z.object({
  productChargeId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
const deleteQuery = z.object({ id: z.string().uuid() })

const scopeOf = (ctx: CpqRouteContext) => ({ organizationId: ctx.organizationId, tenantId: ctx.tenantId })
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/**
 * Resolves the service, or null when the tenant toggle is off: every cost
 * endpoint answers `404` then (R14 / feature spec Q8).
 */
async function enabledService(ctx: CpqRouteContext): Promise<CpqCostService | null> {
  const service = ctx.container.resolve<CpqCostService>('cpqCostService')
  return (await service.enabled(ctx.tenantId)) ? service : null
}

/** Guard modifications may not replace identity fields the route owns. */
function guardChanges(modified: Record<string, unknown> | undefined, locked: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(modified ?? {}).filter(([key]) => !locked.includes(key)))
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const service = await enabledService(ctx)
    if (!service) return notFound()
    const { productChargeId, page, pageSize } = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams))
    return NextResponse.json(await service.listElements(productChargeId, scopeOf(ctx), page, pageSize))
  } catch (err) {
    return handleArcError(err, 'cpq/charge-cost-elements.GET')
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const service = await enabledService(ctx)
    if (!service) return notFound()
    const body = cpqChargeCostElementCreateSchema.parse(await req.json())
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_CHARGE_COST_ELEMENT_RESOURCE_KIND, operation: 'create', mutationPayload: body,
    })
    if (!guard.ok) return guard.response
    const effective = cpqChargeCostElementCreateSchema.parse({ ...body, ...guardChanges(guard.modifiedPayload, ['productChargeId']) })
    const item = await service.createElement(effective, scopeOf(ctx))
    await guard.runAfterSuccess()
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/charge-cost-elements.POST')
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const service = await enabledService(ctx)
    if (!service) return notFound()
    const body = cpqChargeCostElementUpdateSchema.parse(await req.json())
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_CHARGE_COST_ELEMENT_RESOURCE_KIND, resourceId: body.id, operation: 'update', mutationPayload: body,
    })
    if (!guard.ok) return guard.response
    const effective = cpqChargeCostElementUpdateSchema.parse({ ...body, ...guardChanges(guard.modifiedPayload, ['id', 'productChargeId', 'code']) })
    const item = await service.updateElement(effective, scopeOf(ctx))
    await guard.runAfterSuccess()
    return NextResponse.json({ item })
  } catch (err) {
    return handleArcError(err, 'cpq/charge-cost-elements.PUT')
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const service = await enabledService(ctx)
    if (!service) return notFound()
    const { id } = deleteQuery.parse(Object.fromEntries(new URL(req.url).searchParams))
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_CHARGE_COST_ELEMENT_RESOURCE_KIND, resourceId: id, operation: 'delete', mutationPayload: { id },
    })
    if (!guard.ok) return guard.response
    await service.deleteElement(id, scopeOf(ctx))
    await guard.runAfterSuccess()
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleArcError(err, 'cpq/charge-cost-elements.DELETE')
  }
}

const elementSchema = z.object({
  id: z.string().uuid(),
  productChargeId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  role: z.enum(COST_ROLES),
  costType: z.enum(COST_TYPES),
  source: z.enum(AVAILABLE_COST_SOURCES),
  costModel: z.enum(COST_MODELS),
  amount: z.string().nullable(),
  currencyCode: z.string().nullable(),
  costTableId: z.string().uuid().nullable(),
  costColumnKey: z.string().nullable(),
  estimateAmount: z.string().nullable(),
  defaultSupplierId: z.string().uuid().nullable(),
  defaultSupplierName: z.string().nullable(),
  defaultValidityDays: z.number().nullable(),
  requiresSourcing: z.boolean(),
  applicabilityCondition: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number(),
  isActive: z.boolean(),
}).passthrough()
const toggleOff = cpqErrorDoc(404, 'Not found — also returned for every method while the tenant toggle cpq.cost_plus is off')
const writeErrors = [
  cpqErrorDoc(400, 'Validation error'),
  toggleOff,
  cpqErrorDoc(422, 'Rule violation: PRICE_BASIS_REQUIRES_COST_PLUS, COST_TYPE_MISMATCH, WRONG_TABLE_PURPOSE, '
    + 'COST_TABLE_NOT_FOUND, COLUMN_NOT_FOUND, DUPLICATE_CODE, MODEL_REQUIRES_TABLE, QUANTITY_ATTRIBUTE_REQUIRED, '
    + 'SOURCE_NOT_AVAILABLE (index), AMOUNT_REQUIRED, CURRENCY_REQUIRED, TABLE_REQUIRED, FIELD_NOT_ALLOWED, '
    + 'NO_PRICE_BASIS_ELEMENT, or a mutation-guard rejection'),
]

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Pricing',
  methods: {
    GET: {
      summary: 'List the cost elements of a product charge',
      query: listQuery,
      responses: [{ status: 200, description: 'Paged cost elements', schema: z.object({ items: z.array(elementSchema), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number() }) }],
      errors: [cpqErrorDoc(400, 'Validation error'), toggleOff],
    },
    POST: {
      summary: 'Create a charge cost element',
      requestBody: { schema: cpqChargeCostElementCreateSchema },
      responses: [{ status: 201, description: 'Created element', schema: z.object({ item: elementSchema }) }],
      errors: writeErrors,
    },
    PUT: {
      summary: 'Update a charge cost element (code and charge are immutable)',
      requestBody: { schema: cpqChargeCostElementUpdateSchema },
      responses: [{ status: 200, description: 'Updated element', schema: z.object({ item: elementSchema }) }],
      errors: writeErrors,
    },
    DELETE: {
      summary: 'Soft-delete a charge cost element',
      query: deleteQuery,
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ success: z.boolean() }) }],
      errors: writeErrors,
    },
  },
}
