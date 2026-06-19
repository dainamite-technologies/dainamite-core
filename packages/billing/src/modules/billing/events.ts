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
  // ─── Prepaid balance billing (SPEC-002) ──────────────────────
  {
    id: 'billing.balance.topped_up',
    label: 'Balance Topped Up',
    entity: 'balance',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'billing.balance.low',
    label: 'Balance Low',
    entity: 'balance',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'billing.balance.exhausted',
    label: 'Balance Exhausted',
    entity: 'balance',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    // Per-debit signal — useful for a live balance UI but potentially
    // high-volume, so excluded from workflow triggers (see Open Question #2).
    id: 'billing.usage.rated',
    label: 'Usage Rated',
    entity: 'transaction',
    category: 'lifecycle',
    excludeFromTriggers: true,
  },
  {
    id: 'billing.statement.generated',
    label: 'Consumption Statement Generated',
    entity: 'statement',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'billing.credit.over_limit',
    label: 'Credit Over Limit',
    entity: 'credit',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'billing.credit.near_limit',
    label: 'Credit Near Limit',
    entity: 'credit',
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
