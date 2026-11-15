import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { COST_REQUEST_NOTIFICATION, notificationTypes } from '../notifications'
import { answeredBodyKey, notifyCostUser } from '../lib/costNotifications'
import { loadCostNotificationNames } from '../lib/costNotificationContext'

/**
 * `cpq.quote.cost_valued` -> requester notifications (Q5): `answered` (cause answer, nothing pending), `answer_pending`
 * (a different-value answer on a locked quote) and `declined`. The recipient is `requestedByUserId`; none = no
 * notification. `valueStatus`, `errorCode` and `lineReady` travel in the notification `data` (never an amount).
 * Persistent; one side effect. A failure is logged and rethrown so the persistent queue retries.
 */
export const metadata = {
  event: 'cpq.quote.cost_valued',
  persistent: true,
  id: 'cpq-cost-request-notifications',
}

type Payload = {
  tenantId?: string | null; organizationId?: string | null; quoteId?: string | null; salesQuoteId?: string | null; quoteLineId?: string | null
  costLineId?: string | null; costRequestId?: string | null; costName?: string | null; cause?: string | null; answerPending?: boolean | null
  valueStatus?: string | null; errorCode?: string | null; lineReady?: boolean | null; requestedByUserId?: string | null
}
type Ctx = { resolve: <T = unknown>(name: string) => T }

/** Which notification a `cost_valued` event produces, if any. */
export function costValuedNotificationType(payload: Pick<Payload, 'cause' | 'answerPending'>): string | null {
  if (payload.answerPending === true) return COST_REQUEST_NOTIFICATION.answerPending
  if (payload.cause === 'answer') return COST_REQUEST_NOTIFICATION.answered
  if (payload.cause === 'decline') return COST_REQUEST_NOTIFICATION.declined
  return null
}

export default async function handler(payload: Payload, ctx: Ctx): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId || !payload.quoteId || !payload.costLineId) return
  if (!payload.requestedByUserId) return
  const type = costValuedNotificationType(payload)
  const typeDef = type ? notificationTypes.find((entry) => entry.type === type) : undefined
  if (!type || !typeDef) return
  try {
    const em = ctx.resolve<EntityManager>('em').fork()
    const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    const names = await loadCostNotificationNames(em, scope, payload)
    await notifyCostUser(scope, payload.organizationId, payload.requestedByUserId, {
      typeDef,
      ...(type === COST_REQUEST_NOTIFICATION.answered ? { bodyKey: answeredBodyKey(payload) } : {}),
      bodyVariables: { quoteNumber: names.quoteNumber, costName: payload.costName ?? '', productName: names.productName },
      linkHref: `/backend/cpq/quotes/${encodeURIComponent(payload.quoteId)}`,
      sourceEntityType: 'cpq:cpq_quote_line_cost',
      sourceEntityId: payload.costLineId,
      groupKey: `${type}:${payload.costRequestId ?? payload.costLineId}`,
      data: {
        quoteId: payload.quoteId, costLineId: payload.costLineId, costRequestId: payload.costRequestId ?? '',
        valueStatus: payload.valueStatus ?? '', errorCode: payload.errorCode ?? '', lineReady: String(payload.lineReady === true), cause: payload.cause ?? '',
      },
    }, { notificationService: resolveNotificationService(ctx as never) })
  } catch (error) {
    console.error(`[cpq] cost request notification failed for quote ${payload.quoteId}`, error)
    throw error
  }
}
