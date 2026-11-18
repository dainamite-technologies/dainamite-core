import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../context'
import {
  COST_INDEX_READ_FEATURES,
  COST_INDEX_WRITE_FEATURES,
  cpqCostIndexIdPathParams,
  cpqCostIndexUpdateSchema,
} from '../../../data/cost-indices'
import type { CostIndexView } from '../../../services/costs/costIndexService'
import { costIndexCommandRoute, enabledIndexService, indexScope, indexToggleOff } from '../../_helpers/costIndexRoute'
import { handleArcError } from '../../_helpers/handleArcError'
import { CPQ_COST_INDEX_RESOURCE_KIND } from '../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'
import { costIndexCurrentSchema, costIndexItemSchema } from '../../_helpers/costIndexOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [...COST_INDEX_READ_FEATURES] },
  PATCH: { requireAuth: true, requireFeatures: [...COST_INDEX_WRITE_FEATURES] },
  DELETE: { requireAuth: true, requireFeatures: [...COST_INDEX_WRITE_FEATURES] },
}
type Params = { params: Promise<{ indexId: string }> }

export async function GET(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { indexId } = cpqCostIndexIdPathParams.parse(await params)
    const service = await enabledIndexService(ctx)
    if (!service) return indexToggleOff()
    return NextResponse.json(await service.get(indexId, indexScope(ctx)))
  } catch (error) { return handleArcError(error, 'cpq/cost-indices/[indexId].GET') }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { indexId } = cpqCostIndexIdPathParams.parse(await params)
    const body = cpqCostIndexUpdateSchema.parse(await req.json())
    return await costIndexCommandRoute<z.infer<typeof cpqCostIndexUpdateSchema>, { item: CostIndexView }>(req, ctx, {
      commandId: 'cpq.cost_index.update', resourceKind: CPQ_COST_INDEX_RESOURCE_KIND, resourceId: indexId, operation: 'update',
      body, schema: cpqCostIndexUpdateSchema, buildInput: (patch) => ({ indexId, patch }), respond: ({ item }) => ({ item }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/cost-indices/[indexId].PATCH') }
}

const noBody = z.object({}).strict()
export async function DELETE(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { indexId } = cpqCostIndexIdPathParams.parse(await params)
    return await costIndexCommandRoute<Record<string, never>, unknown>(req, ctx, {
      commandId: 'cpq.cost_index.delete', resourceKind: CPQ_COST_INDEX_RESOURCE_KIND, resourceId: indexId, operation: 'delete',
      body: {}, schema: noBody as z.ZodType<Record<string, never>>, buildInput: () => ({ indexId }), respond: () => ({ success: true }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/cost-indices/[indexId].DELETE') }
}

const elementRef = z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), role: z.string(), productChargeId: z.string().uuid(), chargeCode: z.string().nullable(), isActive: z.boolean() })
const detailResponse = z.object({ item: costIndexItemSchema, current: costIndexCurrentSchema, futureValueCount: z.number(), elements: z.array(elementRef) })
const toggleOff = cpqErrorDoc(404, 'Not found — also returned while the tenant toggle cpq.cost_plus is off')
const writeForbidden = cpqErrorDoc(403, 'Missing cpq.pricing.manage or cpq.costs.view')
export const openApi: OpenApiRouteDoc = { tag: 'CPQ cost indices', pathParams: cpqCostIndexIdPathParams, methods: {
  GET: { summary: 'Read a cost index with its value in force today, the number of future-dated values and the cost elements that use it',
    responses: [{ status: 200, description: 'The index', schema: detailResponse }],
    errors: [cpqErrorDoc(403, 'Missing cpq.pricing.view or cpq.costs.view'), toggleOff] },
  PATCH: { summary: 'Update a cost index (code is immutable; the currency is locked once values or elements exist; deactivating needs no active element on it)',
    requestBody: { schema: cpqCostIndexUpdateSchema }, responses: [{ status: 200, description: 'Updated index', schema: z.object({ item: costIndexItemSchema }) }],
    errors: [cpqErrorDoc(400, 'Validation error'), writeForbidden, toggleOff,
      cpqErrorDoc(422, 'INDEX_IN_USE (with elements), INDEX_CURRENCY_LOCKED, CODE_IMMUTABLE, UNKNOWN_CURRENCY or a mutation-guard rejection')] },
  DELETE: { summary: 'Soft-delete a cost index (its values are kept for quote snapshots); refused while any cost element references it',
    responses: [{ status: 200, description: 'Deleted', schema: z.object({ success: z.literal(true) }) }],
    errors: [writeForbidden, toggleOff, cpqErrorDoc(422, 'INDEX_IN_USE (with elements) or a mutation-guard rejection')] },
} }
