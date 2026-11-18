import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../../context'
import { cpqCostCancelRequestSchema, cpqCostRequestResponseSchema } from '../../../../../../data/cost-sourcing'
import type { CostRequestWriteResult } from '../../../../../../services/costs/costSourcingService'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_COST_RESOURCE_KIND } from '../../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../../_helpers/quoteRouteOpenApi'
import { sourcingCommandRoute } from '../../../../../_helpers/sourcingCommandRoute'

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
    const body = cpqCostCancelRequestSchema.parse(await req.json())
    return await sourcingCommandRoute<z.infer<typeof cpqCostCancelRequestSchema>, CostRequestWriteResult>(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.cancel_request', resourceKind: CPQ_QUOTE_LINE_COST_RESOURCE_KIND, resourceId: costId, action: 'cancel_request',
      body, schema: cpqCostCancelRequestSchema, ownedKeys: [], buildInput: (cancel) => ({ quoteId, costId, cancel }), respond: (result) => result.response,
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId]/cancel-request.POST') }
}

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  POST: {
    summary: 'Cancel the open supplier cost request of a quote cost line',
    description: 'Closes the current request as cancelled (`cancelled_by_user`) without touching the cost value. Only the current `costRequestId` can be cancelled. Allowed on locked quotes. The response carries ids and statuses only. Mutation guards run with resource kind `cpq.quote_line_cost`, operation `custom`, action `cancel_request`.',
    requestBody: { schema: cpqCostCancelRequestSchema },
    responses: [{ status: 200, description: 'The cost line (sourcingStatus cancelled) and the new pricing revision', schema: cpqCostRequestResponseSchema }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'),
      cpqErrorDoc(404, 'Quote or cost line not found — also returned while the tenant toggle cpq.cost_plus is off'),
      cpqErrorDoc(409, 'COST_REQUEST_SUPERSEDED (not the current request id), REQUEST_NOT_OPEN, QUOTE_CLOSED, QUOTE_CONVERTED (carries orderId) or STALE_REVISION'),
      cpqErrorDoc(422, 'A mutation-guard rejection')],
  },
} }
