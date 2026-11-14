import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../../context'
import { cpqCostRequestResponseSchema, cpqCostRequestSchema } from '../../../../../../data/cost-sourcing'
import type { CostRequestWriteResult } from '../../../../../../services/costs/costSourcingService'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_COST_RESOURCE_KIND } from '../../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../../_helpers/quoteRouteOpenApi'
import { sourcingCommandRoute } from '../../../../../_helpers/sourcingCommandRoute'

// A request prices nothing, so it needs the quote-write feature only; reps open requests (Q13).
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}
const pathParams = z.object({ quoteId: z.string().uuid(), costId: z.string().uuid() })
type Params = { params: Promise<{ quoteId: string; costId: string }> }

export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, costId } = pathParams.parse(await params)
    const body = cpqCostRequestSchema.parse(await req.json())
    return await sourcingCommandRoute<z.infer<typeof cpqCostRequestSchema>, CostRequestWriteResult>(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.request', resourceKind: CPQ_QUOTE_LINE_COST_RESOURCE_KIND, resourceId: costId, action: 'request',
      body, schema: cpqCostRequestSchema, ownedKeys: [], buildInput: (request) => ({ quoteId, costId, request }), respond: (result) => result.response,
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId]/request.POST') }
}

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  POST: {
    summary: 'Request a supplier cost for a quote cost line',
    description: 'Opens a cost request (new `costRequestId`, `requestSeq` + 1); an open one is closed as cancelled (`re_requested`). Allowed on locked quotes. The response carries ids and statuses only — no amount — for every caller. Mutation guards run with resource kind `cpq.quote_line_cost`, operation `custom`, action `request`.',
    requestBody: { schema: cpqCostRequestSchema },
    responses: [{ status: 200, description: 'The cost line with its new request and the new pricing revision', schema: cpqCostRequestResponseSchema }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'),
      cpqErrorDoc(404, 'Quote or cost line not found — also returned while the tenant toggle cpq.cost_plus is off'),
      cpqErrorDoc(409, 'QUOTE_CLOSED (rejected / cancelled / deleted quote), QUOTE_CONVERTED (an order exists, carries orderId) or STALE_REVISION'),
      cpqErrorDoc(422, 'LINE_NOT_ELIGIBLE (Cancel line or frozen-unpriceable cost line) or a mutation-guard rejection')],
  },
} }
