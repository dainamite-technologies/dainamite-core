import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { COST_REQUEST_NOTIFICATION, notificationTypes } from '../notifications'
import { notifyCostManagers, tryResolveNotificationService } from '../lib/costNotifications'
import { loadCostNotificationNames } from '../lib/costNotificationContext'

/**
 * `cpq.quote.cost_requested` -> `cpq.cost_request.opened` for the cost managers of the quote's organization (Q16).
 * Persistent; one side effect. A failure is logged and rethrown so the persistent queue retries.
 */
export const metadata = {
  event: 'cpq.quote.cost_requested',
  persistent: true,
  id: 'cpq-cost-request-opened-notification',
}

type Payload = {
  tenantId?: string | null; organizationId?: string | null; quoteId?: string | null; salesQuoteId?: string | null; quoteLineId?: string | null
  costLineId?: string | null; costRequestId?: string | null; costName?: string | null; costKey?: string | null
}
type Ctx = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: Payload, ctx: Ctx): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId || !payload.quoteId || !payload.costLineId) return
  const typeDef = notificationTypes.find((type) => type.type === COST_REQUEST_NOTIFICATION.opened)
  if (!typeDef) return
  // Optional peer: without the notifications module there is nothing to do.
  const notificationService = tryResolveNotificationService(ctx)
  if (!notificationService) return
  try {
    const em = ctx.resolve<EntityManager>('em').fork()
    const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    const names = await loadCostNotificationNames(em, scope, payload)
    await notifyCostManagers(scope, payload.organizationId, {
      typeDef,
      bodyVariables: { quoteNumber: names.quoteNumber, costName: payload.costName ?? '', productName: names.productName },
      linkHref: `/backend/cpq/cost-requests?quoteId=${encodeURIComponent(payload.quoteId)}`,
      sourceEntityType: 'cpq:cpq_quote_line_cost',
      sourceEntityId: payload.costLineId,
      groupKey: `${COST_REQUEST_NOTIFICATION.opened}:${payload.costRequestId ?? payload.costLineId}`,
      data: { quoteId: payload.quoteId, costLineId: payload.costLineId, costRequestId: payload.costRequestId ?? '', costKey: payload.costKey ?? '' },
    }, {
      em, notificationService, rbacService: ctx.resolve<RbacService>('rbacService'),
    })
  } catch (error) {
    console.error(`[cpq] cost request opened notification failed for quote ${payload.quoteId}`, error)
    throw error
  }
}
