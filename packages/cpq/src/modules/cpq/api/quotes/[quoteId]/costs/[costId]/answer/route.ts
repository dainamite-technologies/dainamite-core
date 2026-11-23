import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../../context'
import { COST_ANSWER_OUTCOMES, cpqCostAnswerSchema } from '../../../../../../data/cost-sourcing'
import type { CostAnswerWriteResult } from '../../../../../../services/costs/costSourcingService'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_COST_RESOURCE_KIND } from '../../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../../_helpers/quoteRouteOpenApi'
import { sourcingCommandRoute } from '../../../../../_helpers/sourcingCommandRoute'

// The answer carries amounts, so it needs cost visibility AND management (Q13); it needs no quote-write feature.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.costs.view', 'cpq.costs.manage'] },
}
const pathParams = z.object({ quoteId: z.string().uuid(), costId: z.string().uuid() })
type Params = { params: Promise<{ quoteId: string; costId: string }> }
type AnswerBody = z.infer<typeof cpqCostAnswerSchema>

export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, costId } = pathParams.parse(await params)
    const body = cpqCostAnswerSchema.parse(await req.json())
    return await sourcingCommandRoute<AnswerBody, CostAnswerWriteResult>(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.answer', resourceKind: CPQ_QUOTE_LINE_COST_RESOURCE_KIND, resourceId: costId, action: 'answer',
      body, schema: cpqCostAnswerSchema, ownedKeys: [], buildInput: (answer) => ({ quoteId, costId, answer }), respond: (result) => result.response,
      // The service answers `409 COST_PLUS_DISABLED` (retryable) after the closed / converted checks.
      toggleOff: 'skip',
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId]/answer.POST') }
}

const responseSchema = z.object({
  outcome: z.enum(COST_ANSWER_OUTCOMES), cost: z.record(z.string(), z.unknown()), lineReady: z.boolean(), pricingRevision: z.number().int(),
})
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  POST: {
    summary: 'Answer an open supplier cost request',
    description: 'Idempotent on `supplierQuoteRef` + payload hash (a retry returns `outcome: noop` with no write, revision or event). Takes the quote lock itself (no `expectedRevision`). Unlocked quote: the value is applied and the quote re-prices (`applied`). Locked quote: the same amount and currency is confirmed without a price change (`confirmed_unchanged`), a different value is stored as a proposal only (`proposed`; apply it with `apply-answer`). Margin-only costs are lock-exempt and always apply. Check order: cost line 404, QUOTE_CLOSED, QUOTE_CONVERTED, COST_PLUS_DISABLED, LINE_NOT_ELIGIBLE, COST_REQUEST_SUPERSEDED, noop, SUPPLIER_QUOTE_REF_CONFLICT, REQUEST_NOT_OPEN. Mutation guards run with resource kind `cpq.quote_line_cost`, operation `custom`, action `answer`.',
    requestBody: { schema: cpqCostAnswerSchema },
    responses: [{ status: 200, description: 'Outcome, the cost line, whether the quote line is ready and the pricing revision', schema: responseSchema }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'), cpqErrorDoc(404, 'Quote or cost line not found'),
      cpqErrorDoc(409, 'QUOTE_CLOSED, QUOTE_CONVERTED (carries orderId), COST_PLUS_DISABLED, COST_REQUEST_SUPERSEDED (stale request id or inactive cost element), SUPPLIER_QUOTE_REF_CONFLICT or REQUEST_NOT_OPEN'),
      cpqErrorDoc(422, 'LINE_NOT_ELIGIBLE, INVALID_CURRENCY_CODE (ISO 4217 format), VALID_UNTIL_IN_PAST or a mutation-guard rejection')],
  },
} }
