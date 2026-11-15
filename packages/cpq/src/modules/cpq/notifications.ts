import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * Supplier cost sourcing notifications (feature spec step 13). Type ids are FROZEN once shipped. None of them
 * carries a cost amount: titles / bodies name the quote number, the cost and the product only (App Spec I-4).
 *
 * - `opened`: pricing managers (`cpq.costs.view` + `cpq.costs.manage` in the quote's organization, see `lib/costNotifications.ts`).
 * - `answered` / `answer_pending` / `declined`: the user who requested the cost (`requested_by_user_id`).
 *
 * `answered` carries four body variants (`…answered.body.confirmed | estimated | rateMissing | notReady`); the subscriber
 * picks the key from the event, `bodyKey` here is the default (confirmed).
 */
export const COST_REQUEST_NOTIFICATION = {
  opened: 'cpq.cost_request.opened',
  answered: 'cpq.cost_request.answered',
  answerPending: 'cpq.cost_request.answer_pending',
  declined: 'cpq.cost_request.declined',
} as const

const base: Pick<NotificationTypeDefinition, 'module' | 'channels' | 'category' | 'expiresAfterHours'> = {
  module: 'cpq',
  // Ships without push: operators re-enable it per type from the Notification Delivery settings.
  channels: ['in_app', 'email'],
  category: 'cpq',
  expiresAfterHours: 24 * 14,
}

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    ...base,
    type: COST_REQUEST_NOTIFICATION.opened,
    titleKey: 'cpq.notifications.costRequest.opened.title',
    bodyKey: 'cpq.notifications.costRequest.opened.body',
    icon: 'clipboard-list',
    severity: 'info',
    actions: [{ id: 'view', labelKey: 'cpq.notifications.costRequest.action.openRequests', variant: 'outline', href: '/backend/cpq/cost-requests', icon: 'external-link' }],
    linkHref: '/backend/cpq/cost-requests',
  },
  {
    ...base,
    type: COST_REQUEST_NOTIFICATION.answered,
    titleKey: 'cpq.notifications.costRequest.answered.title',
    bodyKey: 'cpq.notifications.costRequest.answered.body.confirmed',
    icon: 'check-circle',
    severity: 'success',
    actions: [{ id: 'view', labelKey: 'cpq.notifications.costRequest.action.openQuote', variant: 'outline', href: '/backend/cpq/quotes', icon: 'external-link' }],
    linkHref: '/backend/cpq/quotes',
  },
  {
    ...base,
    type: COST_REQUEST_NOTIFICATION.answerPending,
    titleKey: 'cpq.notifications.costRequest.answerPending.title',
    bodyKey: 'cpq.notifications.costRequest.answerPending.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [{ id: 'view', labelKey: 'cpq.notifications.costRequest.action.openQuote', variant: 'outline', href: '/backend/cpq/quotes', icon: 'external-link' }],
    linkHref: '/backend/cpq/quotes',
  },
  {
    ...base,
    type: COST_REQUEST_NOTIFICATION.declined,
    titleKey: 'cpq.notifications.costRequest.declined.title',
    bodyKey: 'cpq.notifications.costRequest.declined.body',
    icon: 'x-circle',
    severity: 'warning',
    actions: [{ id: 'view', labelKey: 'cpq.notifications.costRequest.action.openQuote', variant: 'outline', href: '/backend/cpq/quotes', icon: 'external-link' }],
    linkHref: '/backend/cpq/quotes',
  },
]

export default notificationTypes
