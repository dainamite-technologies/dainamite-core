import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../../context'
import { cpqCostApplyAnswerSchema } from '../../../../../../data/cost-sourcing'
import type { CostApplyAnswerWriteResult } from '../../../../../../services/costs/costSourcingService'
import { canViewCosts } from '../../../../../_helpers/costAccess'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { CPQ_QUOTE_RESOURCE_KIND } from '../../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../../_helpers/quoteRouteOpenApi'
import { sourcingCommandRoute } from '../../../../../_helpers/sourcingCommandRoute'

// Reopens a locked quote, so it needs quote management and cost management.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.costs.manage'] },
}
const pathParams = z.object({ quoteId: z.string().uuid(), costId: z.string().uuid() })
type Params = { params: Promise<{ quoteId: string; costId: string }> }
type ApplyBody = z.infer<typeof cpqCostApplyAnswerSchema>
const REDACTED_COST_KEYS = ['id', 'costKey', 'name', 'role', 'valueStatus', 'expired', 'error'] as const

export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, costId } = pathParams.parse(await params)
    const body = cpqCostApplyAnswerSchema.parse(await req.json())
    return await sourcingCommandRoute<ApplyBody, CostApplyAnswerWriteResult>(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.apply_answer', resourceKind: CPQ_QUOTE_RESOURCE_KIND, resourceId: quoteId, action: 'apply_answer',
      body, schema: cpqCostApplyAnswerSchema, ownedKeys: ['expectedRevision'], buildInput: (apply) => ({ quoteId, costId, apply }),
      // Holders of cpq.costs.manage without cpq.costs.view get the status-only projection of the cost line (App Spec I-4).
      respond: async ({ response }) => {
        if (await canViewCosts(ctx)) return response
        const cost = response.cost as unknown as Record<string, unknown>
        return { ...response, cost: Object.fromEntries(REDACTED_COST_KEYS.filter((key) => key in cost).map((key) => [key, cost[key]])) }
      },
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId]/apply-answer.POST') }
}

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  POST: {
    summary: 'Apply a pending supplier proposal and reopen the quote',
    description: 'One write: the quote moves to `ready` (it settles to `ready` or `incomplete` after re-pricing), the stored proposal is applied under the same request id (`value_origin = supplier`), cleared, and the quote re-prices. `expectedRevision` is required. Emits `status_changed` with cause `manual` when the status moved. The earlier customer acceptance must be repeated. Mutation guards run with resource kind `cpq.quote`, operation `custom`, action `apply_answer`. The cost line carries amounts only for holders of `cpq.costs.view`.',
    requestBody: { schema: cpqCostApplyAnswerSchema },
    responses: [{ status: 200, description: 'The quote result (as the status route) plus the cost line' }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'),
      cpqErrorDoc(404, 'Quote or cost line not found — also returned while the tenant toggle cpq.cost_plus is off'),
      cpqErrorDoc(409, 'STALE_REVISION, NO_PENDING_ANSWER, QUOTE_CLOSED or QUOTE_CONVERTED (carries orderId)'),
      cpqErrorDoc(422, 'A mutation-guard rejection')],
  },
} }
