import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../context'
import { readOrderCosts } from '../../../../services/costs/orderCostView'
import { canViewCosts } from '../../../_helpers/costAccess'
import { costPlusEnabled, costToggleOff } from '../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../_helpers/handleArcError'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

/** GET /api/cpq/orders/{orderId}/costs: cost lines of an order, status-only without `cpq.costs.view`. */
export const metadata = { GET: { requireAuth: true, requireFeatures: ['cpq.orders.view'] } }

const orderIdPathParams = z.object({ orderId: z.string().uuid() })

export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orderId } = orderIdPathParams.parse(await params)
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const view = await canViewCosts(ctx)
    return NextResponse.json(await readOrderCosts(ctx.em, orderId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }, view))
  } catch (error) { return handleArcError(error, 'cpq/orders/[orderId]/costs.GET') }
}

const statusCost = z.object({ id: z.string().uuid(), costKey: z.string(), name: z.string(), role: z.string(), costType: z.string(), valueStatus: z.string() })
const readResponse = z.object({
  orderId: z.string().uuid(),
  currencyCode: z.string().optional(),
  lines: z.array(z.object({ orderLineId: z.string().uuid(), costs: z.array(statusCost.passthrough()) })),
  margin: z.record(z.string(), z.unknown()).optional(),
}).describe('Without cpq.costs.view only id, costKey, name, role, costType and valueStatus per cost; with it also currencyCode, values (unit / instance / total amount, fx, supplier, validity), inventoryCostId, sourceQuoteLineCostId and the order margin (computed on read, never stored)')

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Costs', pathParams: orderIdPathParams, methods: { GET: {
  summary: 'Read the cost lines of an order (status only without cpq.costs.view)',
  responses: [{ status: 200, description: 'Cost lines per order line, and the margin for cpq.costs.view holders', schema: readResponse }],
  errors: [cpqErrorDoc(401, 'Unauthorized'), cpqErrorDoc(403, 'Missing permission'), cpqErrorDoc(404, 'Order not found, also returned while the tenant toggle cpq.cost_plus is off')],
} } }
