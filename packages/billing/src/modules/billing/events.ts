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
 *
 * CRUD events (`billing.<entity>.<action>`) are emitted by the data engine
 * from the commands' `emitCrudSideEffects({ events: { module: 'billing',
 * entity } })`. Only the (entity, action) pairs a command actually emits are
 * declared — `__tests__/events.test.ts` fails when a command emits one that
 * is missing here (the data engine would log "Emitting undeclared event").
 */
const events = [
  // ─── CRUD (commands/*.ts) ────────────────────────────────────
  { id: 'billing.account.created', label: 'Billing Account Created', entity: 'account', category: 'crud' },
  { id: 'billing.account.updated', label: 'Billing Account Updated', entity: 'account', category: 'crud' },
  { id: 'billing.account.deleted', label: 'Billing Account Deleted', entity: 'account', category: 'crud' },
  { id: 'billing.item.created', label: 'Billing Item Created', entity: 'item', category: 'crud' },
  { id: 'billing.item.updated', label: 'Billing Item Updated', entity: 'item', category: 'crud' },
  { id: 'billing.item.deleted', label: 'Billing Item Deleted', entity: 'item', category: 'crud' },
  {
    // One per usage upload, on the same high-throughput path as
    // `billing.usage.rated` — excluded from workflow triggers for the same
    // reason (see Open Question #2).
    id: 'billing.usage.created',
    label: 'Billing Usage Record Created',
    entity: 'usage',
    category: 'crud',
    excludeFromTriggers: true,
  },
  { id: 'billing.transaction.created', label: 'Billing Balance Transaction Created', entity: 'transaction', category: 'crud' },
  { id: 'billing.topup.created', label: 'Billing Top-up Created', entity: 'topup', category: 'crud' },
  // ─── Lifecycle ───────────────────────────────────────────────
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
