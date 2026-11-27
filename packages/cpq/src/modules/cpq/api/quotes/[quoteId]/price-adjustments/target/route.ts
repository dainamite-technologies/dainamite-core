import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { cpqContextError, resolveCpqRouteContext } from '../../../../context'
import { cpqTargetPriceInputSchema } from '../../../../../data/price-adjustments'
import type { TargetWriteResult } from '../../../../../services/priceAdjustments/targetPriceService'
import { runCpqMutationGuards } from '../../../../_helpers/quoteMutationGuard'
import { buildCpqCommandContext, resolveCommandBus } from '../../../../_helpers/commandContext'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../../_helpers/quoteRouteOpenApi'
import { targetWriteResponseSchema } from '../../../../_helpers/adjustmentOpenApi'

export const metadata = { PUT: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.quotes.adjust_price'] } }
const COMMAND_ID = 'cpq.quote_price_adjustment.replace_target'

export async function PUT(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const body = cpqTargetPriceInputSchema.parse(await req.json())
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: 'cpq.quote_price_adjustment', operation: 'update', mutationPayload: { quoteId, ...body },
    })
    if (!guard.ok) return guard.response
    // The quote id belongs to the path, even when a guard returns the full payload.
    const modified = Object.fromEntries(Object.entries(guard.modifiedPayload ?? {}).filter(([key]) => key !== 'quoteId'))
    const effective = cpqTargetPriceInputSchema.parse({ ...body, ...modified })
    const input = { quoteId, body: effective }
    const { result, logEntry } = await resolveCommandBus(ctx).execute<typeof input, TargetWriteResult>(COMMAND_ID, { input, ctx: buildCpqCommandContext(ctx, req) })
    if (!result) throw new Error('Target price command did not return a result')
    await guard.runAfterSuccess()
    const response = NextResponse.json({ adjustments: result.after, quote: result.quote })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set('x-om-operation', serializeOperationMetadata({ id: logEntry.id, undoToken: logEntry.undoToken,
        commandId: logEntry.commandId, actionLabel: logEntry.actionLabel ?? null,
        resourceKind: 'cpq.quote_price_adjustment', resourceId: result.after[0]?.id ?? result.before[0]?.id ?? quoteId,
        executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString()
          : typeof logEntry.createdAt === 'string' ? logEntry.createdAt : new Date().toISOString() }))
    }
    return response
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments/target.PUT') }
}

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqQuoteIdPathParams, methods: { PUT: {
  summary: 'Set one target\'s price: replace every adjustment on it in one undoable write',
  description: 'A target is the whole line (`chargeTypeFilter` mrc = recurring, nrc = one-time, null = all charges) or one charge. ' +
    '`phases` run back to back from month 1 (at most 12, recurring targets only); a `regular` step is a gap at the regular price. ' +
    '`then` is the price after the phases to the end (null = regular price); with no phases it is the One price, every month. Its optional `name` keeps the name a stored row to the end already has. ' +
    '`phases: []` and `then: null` remove everything on the target. Every written row follows the POST rules. ' +
    'Rows that do not change keep their id, author and date; a row over the same months is updated in place. One quote write, one reprice, one undo (`x-om-operation`). ' +
    'Price-adjustment writes are not AI tools on purpose (manuals/cpq-ai-agent.md).',
  requestBody: { schema: cpqTargetPriceInputSchema },
  responses: [{ status: 200, description: 'The target\'s rows after the write and the repriced quote', schema: targetWriteResponseSchema }],
  errors: [
    cpqErrorDoc(400, 'Invalid body'),
    cpqErrorDoc(403, 'Missing feature, or manual price adjustments are turned off'),
    cpqErrorDoc(404, 'Quote, line or charge not found. A removal (`phases: []`, `then: null`) needs only the line, so the rows of a charge that left the line can be removed'),
    cpqErrorDoc(409, 'ADJUSTMENT_LOCKED or STALE_REVISION'),
    cpqErrorDoc(422, 'LINE_NOT_ELIGIBLE, PHASE_RECURRING_ONLY, PHASE_PAST_TERM, PHASE_TOO_MANY, ADJUSTMENT_OVERLAP (adjustmentId = the other target\'s row), REASON_NOT_FOUND, REASON_NOTE_REQUIRED, CHARGE_TYPE_REQUIRED, INVALID_PERCENT, INVALID_AMOUNT, or a pricing error of a written row; `stepIndex` points at the step'),
  ],
} } }
