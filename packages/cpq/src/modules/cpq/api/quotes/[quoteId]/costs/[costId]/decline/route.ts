import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../../context'
import { cpqCostDeclineSchema } from '../../../../../../data/cost-sourcing'
import type { CostDeclineWriteResult } from '../../../../../../services/costs/costSourcingService'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_COST_RESOURCE_KIND } from '../../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../../_helpers/quoteRouteOpenApi'
import { sourcingCommandRoute } from '../../../../../_helpers/sourcingCommandRoute'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.costs.view', 'cpq.costs.manage'] },
}
const pathParams = z.object({ quoteId: z.string().uuid(), costId: z.string().uuid() })
type Params = { params: Promise<{ quoteId: string; costId: string }> }
type DeclineBody = z.infer<typeof cpqCostDeclineSchema>

export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, costId } = pathParams.parse(await params)
    const body = cpqCostDeclineSchema.parse(await req.json())
    return await sourcingCommandRoute<DeclineBody, CostDeclineWriteResult>(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.decline', resourceKind: CPQ_QUOTE_LINE_COST_RESOURCE_KIND, resourceId: costId, action: 'decline',
      body, schema: cpqCostDeclineSchema, ownedKeys: [], buildInput: (decline) => ({ quoteId, costId, decline }), respond: (result) => result.response,
      toggleOff: 'skip',
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId]/decline.POST') }
}

const responseSchema = z.object({ outcome: z.literal('declined'), cost: z.record(z.string(), z.unknown()), pricingRevision: z.number().int() })
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  POST: {
    summary: 'Decline an open supplier cost request',
    description: 'Closes the open request as `declined`. Unlocked quote: the value becomes `none` (an estimate moves into the note) and the quote re-prices; locked quote: the amount is kept and its status set to `estimated` (price unchanged). Margin-only costs follow the unlocked rule. Takes the quote lock itself. Mutation guards run with resource kind `cpq.quote_line_cost`, operation `custom`, action `decline`.',
    requestBody: { schema: cpqCostDeclineSchema },
    responses: [{ status: 200, description: 'The declined cost line and the pricing revision', schema: responseSchema }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'), cpqErrorDoc(404, 'Quote or cost line not found'),
      cpqErrorDoc(409, 'QUOTE_CLOSED, QUOTE_CONVERTED (carries orderId), COST_PLUS_DISABLED, COST_REQUEST_SUPERSEDED or REQUEST_NOT_OPEN'),
      cpqErrorDoc(422, 'A mutation-guard rejection')],
  },
} }
