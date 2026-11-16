import { NextResponse } from 'next/server'
import { OptimisticLockError } from '@mikro-orm/core'
import { resolveCpqRouteContext } from '../../../context'
import { isOrderError } from '../../../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../../../services/cpqOrderService'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

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
    if (isOrderError(err)) {
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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Orders',
  summary: 'Activate a CPQ order',
  pathParams: z.object({ orderId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Activate a CPQ order and provision customer inventory',
      description:
        'Moves the order to active and creates or updates the customer subscriptions and assets. For ARC quotes (amend, renew, cancel) the change is applied to the target subscriptions. A concurrent activation touching the same subscription returns 409 and the order stays retryable.',
      responses: [{ status: 200, description: 'Activated order' }],
      errors: [
        cpqErrorDoc(404, 'Order not found'),
        cpqErrorDoc(409, 'Order cannot be activated in its status, or concurrent modification detected'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
