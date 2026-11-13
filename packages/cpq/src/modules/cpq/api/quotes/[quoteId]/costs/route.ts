import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../context'
import type { CpqQuoteCostService } from '../../../../services/costs/quoteCostService'
import { canViewCosts } from '../../../_helpers/costAccess'
import { costPlusEnabled, costToggleOff } from '../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../_helpers/handleArcError'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}
type Params = { params: Promise<{ quoteId: string }> }

export async function GET(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const service = ctx.container.resolve<CpqQuoteCostService>('cpqQuoteCostService')
    return NextResponse.json(await service.read(quoteId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }, await canViewCosts(ctx)))
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs.GET') }
}

const toggleOff = cpqErrorDoc(404, 'Quote not found — also returned while the tenant toggle cpq.cost_plus is off')
const redactedCost = z.object({ id: z.string().uuid(), costKey: z.string(), name: z.string(), role: z.string(), valueStatus: z.string(), expired: z.boolean(), error: z.string().optional() })
const readResponse = z.object({
  lines: z.array(z.object({ quoteLineId: z.string().uuid(), costs: z.array(redactedCost.passthrough()) })),
  pricingRevision: z.number(),
  markupOverrides: z.array(z.record(z.string(), z.unknown())).optional(),
  margin: z.record(z.string(), z.unknown()).optional(),
}).describe('Without cpq.costs.view only id, costKey, name, role, valueStatus, expired and error per cost; with it also values, currency, supplier, validity, markupOverrides and margin (incl. marginHash)')
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqQuoteIdPathParams, methods: {
  GET: { summary: 'Read the cost lines of a quote (status only without cpq.costs.view)', responses: [{ status: 200, description: 'Cost lines per quote line and the pricing revision', schema: readResponse }], errors: [cpqErrorDoc(403, 'Missing permission'), toggleOff] },
} }
