import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../context'
import { cpqCostPreviewSchema } from '../../data/quote-costs'
import type { CpqQuoteCostService } from '../../services/costs/quoteCostService'
import { handleArcError } from '../_helpers/handleArcError'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

/** Cost preview of a configuration: costs, markup and list price per charge. Persists nothing. */
export const metadata = { POST: { requireAuth: true, requireFeatures: ['cpq.pricing.view', 'cpq.costs.view'] } }

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = cpqCostPreviewSchema.parse(await req.json())
    const service = ctx.container.resolve<CpqQuoteCostService>('cpqQuoteCostService')
    return NextResponse.json(await service.preview(body, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }))
  } catch (error) { return handleArcError(error, 'cpq/cost-preview.POST') }
}

const previewCost = z.object({ costKey: z.string(), name: z.string(), role: z.string(), source: z.string(), valueStatus: z.string(), unitAmount: z.string().nullable(), instanceAmount: z.string().nullable(), currencyCode: z.string().nullable(), error: z.string().optional() })
const previewCharge = z.object({
  chargeCode: z.string(), pricingMethod: z.string(), costs: z.array(previewCost), costTotal: z.string(),
  markupRule: z.string().nullable(), markupValue: z.string().nullable(), listTotalPrice: z.number().nullable(), error: z.string().optional(),
})
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Pricing', methods: { POST: {
  summary: 'Preview the costs and list price of a configuration (no persistence)', requestBody: { schema: cpqCostPreviewSchema },
  responses: [{ status: 200, description: 'Costs, cost total, markup and list total per charge', schema: z.object({ currencyCode: z.string(), charges: z.array(previewCharge) }) }],
  errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'), cpqErrorDoc(404, 'Offering not found — also returned while the tenant toggle cpq.cost_plus is off')],
} } }
