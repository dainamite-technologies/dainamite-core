import { NextResponse } from 'next/server'
import { OptimisticLockError } from '@mikro-orm/core'
import { resolveCpqRouteContext } from '../../../context'
import { OrderError } from '../../../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../../../services/cpqOrderService'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.orders.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orderId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.activateOrder(orderId, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // XD-250 ARC: optimistic-lock collision on subscription.version when two
    // ARC orders touching the same sub race to activate. Spec § Risks:
    // "second activation gets 409, order stays in pending_activation,
    // retryable". Constructor-name fallback survives Turbopack class drift.
    if (
      err instanceof OptimisticLockError ||
      (err &&
        typeof err === 'object' &&
        (err as { constructor?: { name?: string } }).constructor?.name === 'OptimisticLockError')
    ) {
      return NextResponse.json(
        { error: 'Concurrent modification detected', details: (err as Error).message },
        { status: 409 },
      )
    }
    const errObj = err as Record<string, unknown>
    if (typeof errObj?.status === 'number' && typeof errObj?.error === 'string') {
      return NextResponse.json({ error: errObj.error }, { status: errObj.status as number })
    }
    console.error('[cpq/orders/[orderId]/activate.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
