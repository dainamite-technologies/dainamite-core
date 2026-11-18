import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../context'
import { cpqCostRequestListQuerySchema } from '../../data/costRequests'
import type { CpqCostRequestQueueService } from '../../services/costs/costRequestQueue'
import { costPlusEnabled, costToggleOff } from '../_helpers/costCommandRoute'
import { handleArcError } from '../_helpers/handleArcError'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'
import { costRequestItemSchema } from '../_helpers/costRequestOpenApi'

/** Q13: the quotes view plus the costs view (reps hold both by default). The list carries no amounts. */
export const metadata = { GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view', 'cpq.costs.view'] } }

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const query = cpqCostRequestListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const queue = ctx.container.resolve<CpqCostRequestQueueService>('cpqCostRequestQueueService')
    return NextResponse.json(await queue.list({ organizationId: ctx.organizationId, tenantId: ctx.tenantId }, query))
  } catch (error) { return handleArcError(error, 'cpq/cost-requests.GET') }
}

const listResponse = z.object({
  items: z.array(costRequestItemSchema), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number(),
  overdueThresholdWorkingDays: z.number(),
})

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', methods: { GET: {
  summary: 'Supplier cost request queue across quotes (no amounts)',
  description: 'Rows of deleted quotes are hidden. Default status is requested, oldest first. overdue=true keeps open requests older than the tenant threshold (toggle cpq.cost_requests.overdue_working_days, default 5 working days).',
  query: cpqCostRequestListQuerySchema,
  responses: [{ status: 200, description: 'Page of cost requests', schema: listResponse }],
  errors: [cpqErrorDoc(400, 'Validation error (pageSize above 100, unknown status)'), cpqErrorDoc(403, 'Missing permission'),
    cpqErrorDoc(404, 'The tenant toggle cpq.cost_plus is off')],
} } }
