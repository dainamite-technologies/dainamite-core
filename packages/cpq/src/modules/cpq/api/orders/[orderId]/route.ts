import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'
import { orderAdjustmentDocSchema } from '../../_helpers/adjustmentOpenApi'
import { cpqContextError, resolveCpqRouteContext } from '../../context'
import { isOrderError } from '../../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../../services/cpqOrderService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.orders.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { orderId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.getOrder(orderId, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (isOrderError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/orders/[orderId].GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Orders',
  summary: 'CPQ order',
  pathParams: z.object({ orderId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get a CPQ order with its lines and pricing summary',
      description:
        '`pricingSummary` carries NRC / MRC totals plus the source quote\'s waterfall figures (`listNrcTotal`, `listMrcTotal`, `standard*Total`, `ruleDiscountTotal`, `manualDiscountTotal`, `dealValue`, `discountDepth`), computed from the line charges copied at conversion. ARC lines carry `arcSource` (the subscription item before the change). ' +
        '`priceAdjustments` lists the source quote\'s manual price adjustments (frozen at conversion, read-only): target (`level`, `quoteLineId`, `chargeCode`, `chargeTypeFilter`), months (`fromMonth`, `toMonth`), `phaseName`, type and value, reason (`reasonCode`, `reasonLabel`, `reasonNote`) and author (`createdByName`, `createdByEmail`, `createdByUserId`). Empty when the order has no source quote.',
      responses: [{ status: 200, description: 'The order', schema: z.object({ priceAdjustments: z.array(orderAdjustmentDocSchema) }).passthrough() }],
      errors: [cpqErrorDoc(401, 'Unauthorized'), cpqErrorDoc(404, 'Order not found')],
    },
  },
}
