import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqContextError, resolveCpqRouteContext } from '../../../../../context'
import { cpqTargetPriceInputSchema } from '../../../../../../data/price-adjustments'
import type { CpqTargetPriceService } from '../../../../../../services/priceAdjustments/targetPriceService'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../../../_helpers/quoteRouteOpenApi'
import { targetPreviewResponseSchema } from '../../../../../_helpers/adjustmentOpenApi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.quotes.adjust_price'] } }

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const body = cpqTargetPriceInputSchema.parse(await req.json())
    const service = ctx.container.resolve<CpqTargetPriceService>('cpqTargetPriceService')
    return NextResponse.json(await service.previewTarget(quoteId, body, { tenantId: ctx.tenantId, organizationId: ctx.organizationId }))
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments/target/preview.POST') }
}

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqQuoteIdPathParams, methods: { POST: {
  summary: 'Preview one target\'s price without saving or emitting events',
  description: 'Same body as PUT /price-adjustments/target. The draft rows get temporary ids (unchanged rows keep theirs); their errors block a save. ' +
    'ADJUSTMENT_OVERLAP with another target is reported in `errors` (with `conflictsWith`), not thrown.',
  requestBody: { schema: cpqTargetPriceInputSchema },
  responses: [{ status: 200, description: 'Draft quote and the draft rows\' errors; nothing persisted', schema: targetPreviewResponseSchema }],
  errors: [
    cpqErrorDoc(400, 'Invalid body'),
    cpqErrorDoc(403, 'Missing feature, or manual price adjustments are turned off'),
    cpqErrorDoc(404, 'Quote, line or charge not found'),
    cpqErrorDoc(409, 'ADJUSTMENT_LOCKED or STALE_REVISION'),
    cpqErrorDoc(422, 'Ineligible line, invalid reason or a structural error of the steps (PHASE_*, INVALID_*)'),
  ],
} } }
