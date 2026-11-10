import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqPriceAdjustmentPreviewSchema } from '../../../../../data/price-adjustments'
import type { CpqAdjustmentService } from '../../../../../services/priceAdjustments/adjustmentService'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../../_helpers/quoteRouteOpenApi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.quotes.adjust_price'] } }
export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const body = cpqPriceAdjustmentPreviewSchema.parse(await req.json())
    const service = ctx.container.resolve<CpqAdjustmentService>('cpqAdjustmentService')
    return NextResponse.json(await service.preview(quoteId, body.draft, body.replaceAdjustmentId, { tenantId: ctx.tenantId, organizationId: ctx.organizationId }))
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments/preview.POST') }
}
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqQuoteIdPathParams, methods: { POST: {
  summary: 'Preview a draft adjustment without saving or emitting events', requestBody: { schema: cpqPriceAdjustmentPreviewSchema },
  responses: [{ status: 200, description: 'Draft quote and adjustment errors; nothing persisted' }],
  errors: [cpqErrorDoc(400, 'Invalid draft'), cpqErrorDoc(403, 'Missing permission or disabled feature'), cpqErrorDoc(404, 'Quote, line or replaced adjustment not found'), cpqErrorDoc(409, 'Adjustment locked or stale revision'), cpqErrorDoc(422, 'Ineligible target or invalid reason')],
} } }
