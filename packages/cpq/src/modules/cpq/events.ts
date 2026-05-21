import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * CPQ Module Events.
 *
 * Subscription lifecycle events: `activated` (new-sale onboarding) plus
 * the XD-250 ARC (Amend / Renew / Cancel / merge) events. Downstream
 * modules (billing, notifications) subscribe to these to react to
 * subscription mutations driven by CPQ orders.
 *
 * Emission rule: events fire AFTER the activation transaction commits.
 * `cpqOrderService.activateOrder` is the sole emitter site.
 */
const events = [
  {
    id: 'cpq.subscription.activated',
    label: 'Subscription Activated',
    entity: 'subscription',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'cpq.subscription.amended',
    label: 'Subscription Amended',
    entity: 'subscription',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'cpq.subscription.renewed',
    label: 'Subscription Renewed',
    entity: 'subscription',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'cpq.subscription.merged',
    label: 'Subscription Merged',
    entity: 'subscription',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'cpq.subscription.cancelled',
    label: 'Subscription Cancelled',
    entity: 'subscription',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'cpq.subscription.superseded',
    label: 'Subscription Superseded',
    entity: 'subscription',
    category: 'lifecycle',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'cpq',
  events,
})

/** Type-safe event emitter for the CPQ module. */
export const emitCpqEvent = eventsConfig.emit

/** Event IDs that can be emitted by the CPQ module. */
export type CpqEventId = (typeof events)[number]['id']

export default eventsConfig
