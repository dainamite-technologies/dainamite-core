import { NextResponse } from 'next/server'
import { z } from 'zod'
import { OptimisticLockError } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { CPQ_ORDER_RESOURCE_KIND, runCpqMutationGuards } from '../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'
import { isOrderError } from '../../../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../../../services/cpqOrderService'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.orders.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { orderId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    // Registered mutation guards run first (resource kind `cpq.order`,
    // action `activate`). CPQ owns no rule here: add-on packages use the hook
    // — e.g. the billing connector blocks activating an amendment before
    // billing of the subscription has started. A blocked guard's body and
    // status are returned as-is.
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_ORDER_RESOURCE_KIND,
      resourceId: orderId,
      operation: 'update',
      mutationPayload: { action: 'activate', orderId },
    })
    if (!guard.ok) return guard.response

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.activateOrder(orderId, scope)
    // Callback failures are caught and logged by the wrapper, so a committed
    // activation still answers 200.
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (isOrderError(err)) {
      // `details` carries the COST_SOURCE_CHANGED lines (same body as conversion).
      return NextResponse.json({ error: err.message, ...err.details }, { status: err.status })
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
      summary: 'Activate a CPQ order: create or update the subscription, items, assets and their inventory costs',
      description:
        'Moves a `draft` / `pending_activation` order to `active` and creates or updates the customer subscriptions and ' +
        'assets: a new-sale order creates its subscription, an ARC order (amend / renew / cancel) applies its changes to ' +
        'the target subscriptions; lifecycle events fire after commit. Atomic: the whole activation commits in one ' +
        'transaction, so a late failure persists nothing and the order stays retryable. Inventory costs are written with ' +
        'the items; the response carries no cost data. Registered mutation guards run first (resource ' +
        'kind `cpq.order`, operation `update`, payload `{ action: "activate", orderId }`). A guard that blocks returns ' +
        'its own status and body, typically 422 `{ error, code, ...details }` — add-on packages use this to enforce ' +
        'rules CPQ does not own (e.g. no activation before a date). A concurrent activation touching the same ' +
        'subscription returns 409 and the order stays retryable.',
      responses: [{ status: 200, description: 'The activated order with the created or updated subscription', schema: z.record(z.string(), z.unknown()) }],
      errors: [
        cpqErrorDoc(400, 'No organization selected'),
        cpqErrorDoc(401, 'Unauthorized'),
        cpqErrorDoc(403, 'Missing permission'),
        cpqErrorDoc(404, 'Order not found'),
        cpqErrorDoc(409, 'Order is not in an activatable status, concurrent modification detected (nothing was persisted, retry), or COST_SOURCE_CHANGED (the subscription item costs of an ARC cost-managed line changed since the quote mirrored them; body `lines: [{ quoteLineId, subscriptionItemId, costKeys }]`, nothing was written)'),
        cpqErrorDoc(422, 'Blocked by a mutation guard (body passed through from the guard: `error`, usually `code` and details)'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
