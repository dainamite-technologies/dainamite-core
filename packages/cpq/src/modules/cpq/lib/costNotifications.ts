import type { EntityManager } from '@mikro-orm/postgresql'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { buildBatchNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { getRecipientUserIdsForFeature, getScopedNotificationRecipientUserIds } from '@open-mercato/core/modules/notifications/lib/notificationRecipients'
import type { NotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

/** A user sees and works cost requests only with BOTH features (App Spec C11): viewing the amounts and managing them. */
export const COST_MANAGER_FEATURES = ['cpq.costs.view', 'cpq.costs.manage'] as const

/** Message content shared by every cost notification. Never an amount: names, ids and statuses only. */
export type CostNotificationContent = {
  typeDef: NotificationTypeDefinition
  /** Overrides the type's default body key (the `answered` variants). */
  bodyKey?: string
  titleVariables?: Record<string, string>
  bodyVariables?: Record<string, string>
  linkHref: string
  sourceEntityType?: string
  sourceEntityId?: string
  groupKey?: string
  /** Free string map persisted on the notification (statuses and ids only). */
  data?: Record<string, string>
}

export type CostNotificationDeps = {
  em: Pick<EntityManager, 'getKysely'>
  notificationService: Pick<NotificationService, 'createBatch'>
  rbacService: Pick<RbacService, 'userHasAllFeatures'>
}

export function buildCostNotification(recipientUserIds: string[], content: CostNotificationContent) {
  const input = buildBatchNotificationFromType(content.typeDef, {
    recipientUserIds,
    titleVariables: content.titleVariables,
    bodyVariables: content.bodyVariables,
    linkHref: content.linkHref,
    sourceEntityType: content.sourceEntityType,
    sourceEntityId: content.sourceEntityId,
    groupKey: content.groupKey,
  })
  return {
    ...input,
    ...(content.bodyKey ? { bodyKey: content.bodyKey, body: content.bodyKey } : {}),
    ...(content.data ? { data: content.data } : {}),
  }
}

/**
 * Users who may act on cost requests of one organization (sourcing spec Q16): candidates are everyone granted
 * `cpq.costs.manage` in the tenant (`getRecipientUserIdsForFeature`), narrowed to the quote's organization and then to
 * those who also hold `cpq.costs.view` (`rbacService.userHasAllFeatures`, wildcard- and organization-aware). A manager
 * without `cpq.costs.view` could not read what the request is about; a user of another organization is not a recipient.
 */
export async function resolveCostManagerUserIds(scope: { tenantId: string }, organizationId: string, deps: Pick<CostNotificationDeps, 'em' | 'rbacService'>): Promise<string[]> {
  const db = deps.em.getKysely<any>()
  const candidates = await getRecipientUserIdsForFeature(db, scope.tenantId, 'cpq.costs.manage')
  if (candidates.length === 0) return []
  const inOrganization = await getScopedNotificationRecipientUserIds(db, scope.tenantId, organizationId, candidates)
  const allowed: string[] = []
  for (const userId of new Set(inOrganization)) {
    if (await deps.rbacService.userHasAllFeatures(userId, [...COST_MANAGER_FEATURES], { tenantId: scope.tenantId, organizationId })) allowed.push(userId)
  }
  return allowed
}

/**
 * Notifies the cost managers of an organization. Shared with the index / expiry specs (hence the generic content).
 * Returns the number of recipients; nobody eligible = no call to the notification service.
 */
export async function notifyCostManagers(
  scope: { tenantId: string }, organizationId: string, content: CostNotificationContent, deps: CostNotificationDeps,
): Promise<number> {
  const recipients = await resolveCostManagerUserIds(scope, organizationId, deps)
  if (recipients.length === 0) return 0
  await deps.notificationService.createBatch(buildCostNotification(recipients, content), { tenantId: scope.tenantId, organizationId })
  return recipients.length
}

/** One explicit recipient (the requester): same content, same tenant / organization scope. */
export async function notifyCostUser(
  scope: { tenantId: string }, organizationId: string, userId: string, content: CostNotificationContent, deps: Pick<CostNotificationDeps, 'notificationService'>,
): Promise<void> {
  await deps.notificationService.createBatch(buildCostNotification([userId], content), { tenantId: scope.tenantId, organizationId })
}

type AnsweredEvent = { valueStatus?: string | null; errorCode?: string | null; lineReady?: boolean | null }

/** Body key of the `answered` notification: exchange rate missing, then any other not-ready line, then budgetary, else confirmed. */
export function answeredBodyKey(event: AnsweredEvent): string {
  const prefix = 'cpq.notifications.costRequest.answered.body'
  if (event.errorCode === 'CURRENCY_NO_RATE') return `${prefix}.rateMissing`
  if (event.lineReady === false) return `${prefix}.notReady`
  if (event.valueStatus === 'estimated') return `${prefix}.estimated`
  return `${prefix}.confirmed`
}
