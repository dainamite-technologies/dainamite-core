import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { cpqOrderStatusTransitionSchema } from '../../../../data/validators'
import { isOrderError } from '../../../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../../../services/cpqOrderService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.orders.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { orderId } = await params
    const body = cpqOrderStatusTransitionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.transitionOrderStatus(orderId, body.targetStatus, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (isOrderError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const errObj = err as Record<string, unknown>
    if (typeof errObj?.status === 'number' && typeof errObj?.error === 'string') {
      return NextResponse.json({ error: errObj.error }, { status: errObj.status as number })
    }
    console.error('[cpq/orders/[orderId]/status.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Orders',
  summary: 'CPQ order status',
  pathParams: z.object({ orderId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Transition a CPQ order to another status',
      description: 'Operator-driven order lifecycle change, validated against the order state machine. Transitioning to `active` runs the same activation as the activate endpoint.',
      requestBody: { schema: cpqOrderStatusTransitionSchema },
      responses: [{ status: 200, description: 'Order with its new status' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Order not found'),
        cpqErrorDoc(409, 'Transition not allowed'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
