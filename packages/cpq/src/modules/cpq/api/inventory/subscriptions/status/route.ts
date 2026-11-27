import { NextResponse } from 'next/server'
import { handleArcError } from '../../../_helpers/handleArcError'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { cpqInventoryStatusTransitionSchema } from '../../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqInventoryStatusTransitionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    // D6: suspend / pause / grace / resume / terminate go through the status
    // actions and emit their event; other moves are plain transitions.
    const { id, targetStatus, ...options } = body
    const result = await service.changeSubscriptionStatus(id, targetStatus, scope, {
      ...options,
      performedByUserId: typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null,
    })
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions/status.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ subscription status',
  methods: {
    POST: {
      summary: 'Transition an inventory subscription to another status',
      description: 'Validates the transition against the subscription state machine (statuses: pending, active, paused, suspended, grace, terminated, expired, superseded). Moves to paused / suspended / grace, back to active from those, and to terminated run as the matching status action of POST /api/cpq/inventory/subscriptions/actions (dates, charge behaviour, reason; emits cpq.subscription_item.status_changed or cpq.subscription.terminated). Prefer that route; it also acts on one item.',
      requestBody: { schema: cpqInventoryStatusTransitionSchema },
      responses: [{ status: 200, description: 'Subscription with its new status' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(409, 'Transition not allowed'),
        cpqErrorDoc(404, 'Subscription not found'), cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
