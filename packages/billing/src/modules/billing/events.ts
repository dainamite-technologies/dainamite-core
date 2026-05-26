import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Billing module events.
 *
 * Emission contract:
 *   - `billing.invoice.posted` fires once per posted draft AFTER the post
 *     transaction commits (sequence number assigned, status set to `posted`
 *     in core/sales). Consumed by mailers / accounting bridges / analytics.
 *   - `billing.invoice.line_posted` fires once per line on a posted invoice
 *     so analytics can aggregate without scanning core/sales lines directly.
 *   - `billing.run.completed` fires once per Bill Run after all per-account
 *     transactions finished (status is one of `completed` / `partial_failure`
 *     / `failed`). Useful for "did the nightly run go OK?" alerts.
 */
const events = [
  {
    id: 'billing.invoice.posted',
    label: 'Billing Invoice Posted',
    entity: 'invoice',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'billing.invoice.line_posted',
    label: 'Billing Invoice Line Posted',
    entity: 'invoice_line',
    category: 'lifecycle',
  },
  {
    id: 'billing.run.completed',
    label: 'Bill Run Completed',
    entity: 'bill_run',
    category: 'lifecycle',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'billing',
  events,
})

export const emitBillingEvent = eventsConfig.emit
export type BillingEventId = (typeof events)[number]['id']

export default eventsConfig
