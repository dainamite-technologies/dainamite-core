import { NextResponse } from 'next/server'
import { z } from 'zod'
import { handleArcError } from '../../../_helpers/handleArcError'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { cpqSubscriptionStatusActionSchema } from '../../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'
import type { DefaultCpqInventoryService } from '../../../../services/cpqInventoryService'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
}

/**
 * Spec 2026-11-26 line status (D6): pause / suspend / grace / resume /
 * terminate a whole subscription or one item. Emits
 * `cpq.subscription_item.status_changed` (or `cpq.subscription.terminated`)
 * after commit, which the billing connector turns into status periods / end dates.
 */
export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqSubscriptionStatusActionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as DefaultCpqInventoryService
    const result = await service.applyStatusAction(
      { ...body, performedByUserId: typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null },
      scope,
    )
    return NextResponse.json({
      subscription: result.subscription,
      subscriptionItemIds: result.subscriptionItemIds,
      event: result.event,
    })
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions/actions.POST')
  }
}

const statusActionResponse = z.object({
  subscription: z.record(z.string(), z.unknown()).describe('The subscription after the action'),
  subscriptionItemIds: z.array(z.string().uuid()).describe('Every affected item'),
  event: z.object({
    id: z.enum(['cpq.subscription_item.status_changed', 'cpq.subscription.terminated']),
    payload: z.record(z.string(), z.unknown()),
  }).describe('The event emitted after commit (contract C2)'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ subscription status actions',
  methods: {
    POST: {
      summary: 'Pause, suspend, put in grace, resume or terminate a subscription or one item',
      description:
        'Whole subscription (omit subscriptionItemId: every item the action applies to) or one item (the subscription must be active or in grace). ' +
        'Pause / suspend / grace take fromDate (default today), an optional inclusive toDate (null = open-ended) and chargeBehavior ' +
        '(default paused → no_charge, suspended / grace → charge). Resume sets status active from fromDate. Terminate ends the items on fromDate; ' +
        'the last item terminated also terminates the subscription. Every action except terminate emits cpq.subscription_item.status_changed; ' +
        'terminate emits cpq.subscription.terminated. Billing applies both to the subscription\'s billing items.',
      requestBody: { schema: cpqSubscriptionStatusActionSchema },
      responses: [{ status: 200, description: 'Subscription after the action, the affected item ids and the emitted event', schema: statusActionResponse }],
      errors: [
        cpqErrorDoc(400, 'Validation error (dates, options not allowed for the action)'),
        cpqErrorDoc(404, 'Subscription or item not found'),
        cpqErrorDoc(409, 'Action not allowed from the current status (XD-215 state machine)'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
