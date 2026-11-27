import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { cpqPriceAdjustmentInputSchema } from '../../../../data/price-adjustments'
import type { CpqAdjustmentService } from '../../../../services/priceAdjustments/adjustmentService'
import { adjustmentCommandRoute } from '../../../_helpers/adjustmentCommandRoute'
import { handleArcError } from '../../../_helpers/handleArcError'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.quotes.adjust_price'] },
}
const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) })
type Params = { params: Promise<{ quoteId: string }> }
export async function GET(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const { page, pageSize } = listQuery.parse(Object.fromEntries(new URL(req.url).searchParams))
    const service = ctx.container.resolve<CpqAdjustmentService>('cpqAdjustmentService')
    return NextResponse.json(await service.list(quoteId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }, page, pageSize))
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments.GET') }
}
export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const body = cpqPriceAdjustmentInputSchema.parse(await req.json())
    return await adjustmentCommandRoute(req, ctx, quoteId, body, cpqPriceAdjustmentInputSchema, 'create')
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments.POST') }
}
const errors = [cpqErrorDoc(400, 'Invalid input'), cpqErrorDoc(403, 'Missing permission or disabled feature'), cpqErrorDoc(404, 'Quote not found'), cpqErrorDoc(409, 'Adjustment locked or stale revision'), cpqErrorDoc(422, 'Invalid adjustment or guard rejection')]
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqQuoteIdPathParams, methods: {
  GET: { summary: 'List quote price adjustments', query: listQuery, responses: [{ status: 200, description: 'Paged adjustments, pricing revision, feature state and the reason options (`reasons: [{ value, label }]`)' }], errors },
  POST: { summary: 'Create a negotiated quote price adjustment',
    description: 'Charge level: Set price (new unit price; the charge total on volume / tiered charges), % off or Amount off the charge total. Line level: % off (all charges, recurring or one-time), or Set price / Amount off for the line\'s recurring (`chargeTypeFilter: mrc`) or one-time (`nrc`) total, spread over its charges in proportion to their standard totals; on a bundle parent it covers the whole bundle. Charge beats line beats bundle parent; a line Set price is spread over the charges left, so the line total equals the typed price. Any price is allowed, also above standard. 422 CHARGE_TYPE_REQUIRED when a line Set price / Amount off has no chargeTypeFilter.',
    requestBody: { schema: cpqPriceAdjustmentInputSchema }, responses: [{ status: 201, description: 'Adjustment and updated quote' }], errors },
} }
