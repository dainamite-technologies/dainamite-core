import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { OrderError } from '../../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../../services/cpqOrderService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.orders.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orderId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.getOrder(orderId, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/orders/[orderId].GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
