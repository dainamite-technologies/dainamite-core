import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../context'
import {
  COST_INDEX_READ_FEATURES,
  COST_INDEX_WRITE_FEATURES,
  cpqCostIndexCreateSchema,
  cpqCostIndexListQuerySchema,
} from '../../data/cost-indices'
import type { CostIndexView } from '../../services/costs/costIndexService'
import { costIndexCommandRoute, enabledIndexService, indexScope, indexToggleOff } from '../_helpers/costIndexRoute'
import { handleArcError } from '../_helpers/handleArcError'
import { CPQ_COST_INDEX_RESOURCE_KIND } from '../_helpers/quoteMutationGuard'
import { costIndexCurrentSchema, costIndexItemSchema } from '../_helpers/costIndexOpenApi'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

/** Cost indices (index-costs spec Q13): confidential cost data. Read = pricing.view + costs.view; write = pricing.manage + costs.view. */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: [...COST_INDEX_READ_FEATURES] },
  POST: { requireAuth: true, requireFeatures: [...COST_INDEX_WRITE_FEATURES] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const service = await enabledIndexService(ctx)
    if (!service) return indexToggleOff()
    const query = cpqCostIndexListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    return NextResponse.json(await service.list(indexScope(ctx), query))
  } catch (error) { return handleArcError(error, 'cpq/cost-indices.GET') }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = cpqCostIndexCreateSchema.parse(await req.json())
    return await costIndexCommandRoute<z.infer<typeof cpqCostIndexCreateSchema>, { item: CostIndexView }>(req, ctx, {
      commandId: 'cpq.cost_index.create', resourceKind: CPQ_COST_INDEX_RESOURCE_KIND, operation: 'create',
      body, schema: cpqCostIndexCreateSchema, buildInput: (index) => ({ index }), respond: ({ item }) => ({ item }), status: 201,
    })
  } catch (error) { return handleArcError(error, 'cpq/cost-indices.POST') }
}

const listItem = costIndexItemSchema.extend({ current: costIndexCurrentSchema, elementCount: z.number() })
const listResponse = z.object({ items: z.array(listItem), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number() })
const toggleOff = cpqErrorDoc(404, 'Not found — also returned while the tenant toggle cpq.cost_plus is off')
export const openApi: OpenApiRouteDoc = { tag: 'CPQ cost indices', methods: {
  GET: { summary: 'List cost indices with the value in force today and the number of referencing cost elements', query: cpqCostIndexListQuerySchema,
    responses: [{ status: 200, description: 'Page of cost indices', schema: listResponse }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing cpq.pricing.view or cpq.costs.view'), toggleOff] },
  POST: { summary: 'Create a cost index (code is unique per tenant and immutable)', requestBody: { schema: cpqCostIndexCreateSchema },
    responses: [{ status: 201, description: 'Created index', schema: z.object({ item: costIndexItemSchema }) }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing cpq.pricing.manage or cpq.costs.view'), toggleOff,
      cpqErrorDoc(422, 'DUPLICATE_CODE, UNKNOWN_CURRENCY or a mutation-guard rejection')] },
} }
