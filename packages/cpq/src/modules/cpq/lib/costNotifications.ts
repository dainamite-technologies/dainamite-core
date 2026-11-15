import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

/**
 * Notifications are an OPTIONAL peer of CPQ (not in `metadata.requires`): this file imports nothing from the
 * `notifications` module. The subscribers resolve `notificationService` through `tryResolveNotificationService` and
 * no-op when it is absent; the batch input is built here from the type definition (same shape as the notifications
 * module's `buildBatchNotificationFromType`).
 */
export type CostNotificationService = { createBatch: (input: Record<string, unknown>, ctx: { tenantId: string; organizationId: string | null }) => Promise<unknown> }

/** Resolves the notification service from the container, or `undefined` when the notifications module is not installed. */
export function tryResolveNotificationService(ctx: { resolve: <T = unknown>(name: string) => T }): CostNotificationService | undefined {
  try {
    return ctx.resolve<CostNotificationService>('notificationService') ?? undefined
  } catch {
    return undefined
  }
}

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
  em: { getKysely: <T = any>() => any }
  notificationService: CostNotificationService
  rbacService: Pick<RbacService, 'userHasAllFeatures'>
}

export function buildCostNotification(recipientUserIds: string[], content: CostNotificationContent): Record<string, unknown> {
  const { typeDef } = content
  const bodyKey = content.bodyKey ?? typeDef.bodyKey
  return {
    recipientUserIds,
    type: typeDef.type,
    titleKey: typeDef.titleKey,
    bodyKey,
    titleVariables: content.titleVariables,
    bodyVariables: content.bodyVariables,
    title: typeDef.titleKey,
    body: bodyKey,
    icon: typeDef.icon,
    severity: typeDef.severity,
    actions: typeDef.actions.map((action) => ({ id: action.id, label: action.labelKey, labelKey: action.labelKey, variant: action.variant, icon: action.icon, href: action.href })),
    primaryActionId: typeDef.primaryActionId,
    sourceModule: typeDef.module,
    sourceEntityType: content.sourceEntityType,
    sourceEntityId: content.sourceEntityId,
    linkHref: content.linkHref,
    groupKey: content.groupKey,
    expiresAt: typeDef.expiresAfterHours ? new Date(Date.now() + typeDef.expiresAfterHours * 3_600_000).toISOString() : undefined,
    ...(content.data ? { data: content.data } : {}),
  }
}

/**
 * Users who may act on cost requests of one organization (sourcing spec Q16): candidates are the live users of
 * the quote's organization, narrowed to those who hold BOTH `cpq.costs.view` and `cpq.costs.manage`
 * (`rbacService.userHasAllFeatures`, wildcard- and organization-aware). A manager
 * without `cpq.costs.view` could not read what the request is about; a user of another organization is not a recipient.
 */
export async function resolveCostManagerUserIds(scope: { tenantId: string }, organizationId: string, deps: Pick<CostNotificationDeps, 'em' | 'rbacService'>): Promise<string[]> {
  const db = deps.em.getKysely()
  // Candidates: live users of the quote's organization (the notification service refuses recipients outside it). The
  // feature check below is the authoritative filter (wildcards, role and user ACLs, super admins, organization lists).
  const rows = await db.selectFrom('users')
    .where('users.tenant_id', '=', scope.tenantId).where('users.organization_id', '=', organizationId).where('users.deleted_at', 'is', null)
    .select('users.id as user_id').execute() as Array<{ user_id: string }>
  const allowed: string[] = []
  for (const userId of new Set(rows.map((row) => row.user_id))) {
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
