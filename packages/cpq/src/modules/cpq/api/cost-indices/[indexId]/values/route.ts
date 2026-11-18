import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../context'
import {
  COST_INDEX_READ_FEATURES,
  COST_INDEX_WRITE_FEATURES,
  cpqCostIndexIdPathParams,
  cpqCostIndexValueCreateSchema,
  cpqCostIndexValuesQuerySchema,
} from '../../../../data/cost-indices'
import type { CostIndexValueView } from '../../../../services/costs/costIndexService'
import { costIndexCommandRoute, enabledIndexService, indexScope, indexToggleOff } from '../../../_helpers/costIndexRoute'
import { handleArcError } from '../../../_helpers/handleArcError'
import { CPQ_COST_INDEX_VALUE_RESOURCE_KIND } from '../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [...COST_INDEX_READ_FEATURES] },
  POST: { requireAuth: true, requireFeatures: [...COST_INDEX_WRITE_FEATURES] },
}
type Params = { params: Promise<{ indexId: string }> }

export async function GET(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { indexId } = cpqCostIndexIdPathParams.parse(await params)
    const service = await enabledIndexService(ctx)
    if (!service) return indexToggleOff()
    const query = cpqCostIndexValuesQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    return NextResponse.json(await service.listValues(indexId, indexScope(ctx), query))
  } catch (error) { return handleArcError(error, 'cpq/cost-indices/[indexId]/values.GET') }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { indexId } = cpqCostIndexIdPathParams.parse(await params)
    const body = cpqCostIndexValueCreateSchema.parse(await req.json())
    return await costIndexCommandRoute<z.infer<typeof cpqCostIndexValueCreateSchema>, { value: CostIndexValueView }>(req, ctx, {
      commandId: 'cpq.cost_index_value.append', resourceKind: CPQ_COST_INDEX_VALUE_RESOURCE_KIND, resourceId: indexId, operation: 'create',
      body, schema: cpqCostIndexValueCreateSchema, buildInput: (value) => ({ indexId, value }), respond: ({ value }) => ({ value }), status: 201,
    })
  } catch (error) { return handleArcError(error, 'cpq/cost-indices/[indexId]/values.POST') }
}

const valueSchema = z.object({
  id: z.string().uuid(), effectiveDate: z.string(), value: z.string(), revision: z.number(), sourceNote: z.string().nullable(),
  createdByUserId: z.string().uuid().nullable(), createdAt: z.string().or(z.date()),
}).passthrough()
const listResponse = z.object({
  items: z.array(valueSchema.extend({ inForceToday: z.boolean(), superseded: z.boolean(), future: z.boolean() })),
  total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number(),
})
const toggleOff = cpqErrorDoc(404, 'Index not found — also returned while the tenant toggle cpq.cost_plus is off')
export const openApi: OpenApiRouteDoc = { tag: 'CPQ cost indices', pathParams: cpqCostIndexIdPathParams, methods: {
  GET: { summary: 'List the values of a cost index, newest first (effectiveDate desc, revision desc); superseded corrections are hidden unless includeSuperseded', query: cpqCostIndexValuesQuerySchema,
    responses: [{ status: 200, description: 'Page of values with inForceToday / superseded / future flags', schema: listResponse }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing cpq.pricing.view or cpq.costs.view'), toggleOff] },
  POST: { summary: 'Append a dated value (append-only: the server assigns revision = highest revision for that date + 1; a same-date entry is a correction)',
    requestBody: { schema: cpqCostIndexValueCreateSchema }, responses: [{ status: 201, description: 'The stored value with its revision', schema: z.object({ value: valueSchema }) }],
    errors: [cpqErrorDoc(400, 'Validation error (value must be > 0, date YYYY-MM-DD)'), cpqErrorDoc(403, 'Missing cpq.pricing.manage or cpq.costs.view'), toggleOff,
      cpqErrorDoc(409, 'CONCURRENT_INDEX_WRITE: a racing writer took the revision; retry'), cpqErrorDoc(422, 'INDEX_INACTIVE (reactivate the index first) or a mutation-guard rejection')] },
} }
