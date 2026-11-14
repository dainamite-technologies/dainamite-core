import { createModuleEvents } from '@open-mercato/shared/modules/events'
import type { EventPayloadSchemaField } from '@open-mercato/shared/modules/events'

/** Fields shared by both quote pricing signals (see `quotePricingEvents.ts`). */
const quotePricingSnapshotFields: EventPayloadSchemaField[] = [
  { path: 'tenantId', type: 'text' },
  { path: 'organizationId', type: 'text' },
  { path: 'quoteId', type: 'text', label: 'CPQ quote id' },
  { path: 'quoteType', type: 'select', label: 'Quote type' },
  { path: 'cpqStatus', type: 'text', label: 'Status' },
  { path: 'currencyCode', type: 'text' },
  { path: 'pricingRevision', type: 'number' },
  { path: 'snapshotHash', type: 'text' },
  { path: 'dealValue.list', type: 'number', label: 'Deal value (list)' },
  { path: 'dealValue.standard', type: 'number', label: 'Deal value (standard)' },
  { path: 'dealValue.offer', type: 'number', label: 'Deal value (offer)' },
  { path: 'discountDepth.rule', type: 'number', label: 'Rule discount depth', optional: true },
  { path: 'discountDepth.manual', type: 'number', label: 'Manual discount depth', optional: true },
  { path: 'discountDepth.total', type: 'number', label: 'Total discount depth', optional: true },
  { path: 'discountDepth.maxLineManual', type: 'number', label: 'Max line manual discount depth', optional: true },
  { path: 'hasTimeBasedAdjustments', type: 'boolean' },
  { path: 'occurredAt', type: 'date' },
]

/**
 * CPQ Module Events.
 *
 * Subscription lifecycle events: `activated` (new-sale onboarding) plus
 * the XD-250 ARC (Amend / Renew / Cancel / merge) events. Downstream
 * modules (billing, notifications) subscribe to these to react to
 * subscription mutations driven by CPQ orders.
 *
 * Emission rule: events fire AFTER their transaction commits.
 * Subscription events: `cpqOrderService.activateOrder` is the sole emitter.
 * Quote events: `withQuotePricingWrite` (plus `cloneQuote` for the copy).
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
  // Quote pricing signals (manual price adjustments). Emitted after the quote
  // write commits by `withQuotePricingWrite`; payload carries the pricing
  // snapshot (deal value, discount depth, snapshot hash) so project workflows
  // can route approvals without CPQ code.
  {
    id: 'cpq.quote.pricing_changed',
    label: 'Quote Pricing Changed',
    entity: 'quote',
    category: 'custom',
    clientBroadcast: true,
    payloadSchema: { fields: [...quotePricingSnapshotFields, { path: 'cause', type: 'select' }] },
  },
  {
    id: 'cpq.quote.status_changed',
    label: 'Quote Status Changed',
    entity: 'quote',
    category: 'lifecycle',
    clientBroadcast: true,
    payloadSchema: {
      fields: [
        ...quotePricingSnapshotFields,
        { path: 'fromStatus', type: 'text' },
        { path: 'toStatus', type: 'text' },
        { path: 'cause', type: 'select' },
        { path: 'actorUserId', type: 'text', optional: true },
        // Price-basis cost lines only (the price is indicative); present on quotes that carry costs.
        { path: 'hasPendingCosts', type: 'boolean', optional: true, label: 'A price-basis cost is pending' },
        { path: 'hasEstimatedCosts', type: 'boolean', optional: true, label: 'A price-basis cost is estimated (indicative price)' },
      ],
    },
  },
  // Margin signal. NOT broadcast to the browser: it carries the quote-level margin. Visible to whoever can read
  // workflow definitions / instances (see the cost-plus manual). Never a per-line amount, cost or markup.
  {
    id: 'cpq.quote.margin_changed',
    label: 'Quote Margin Changed',
    entity: 'quote',
    category: 'custom',
    clientBroadcast: false,
    payloadSchema: {
      fields: [
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'quoteId', type: 'text', label: 'CPQ quote id' },
        { path: 'cpqStatus', type: 'text', label: 'Status' },
        { path: 'currencyCode', type: 'text' },
        { path: 'pricingRevision', type: 'number' },
        // Null when the write created the quote's first cost lines (there was no margin before).
        { path: 'previousMarginHash', type: 'text', optional: true },
        { path: 'marginHash', type: 'text' },
        { path: 'approvalInvalidated', type: 'boolean' },
        { path: 'contractMargin', type: 'number' },
        { path: 'marginPercent', type: 'number', optional: true },
        { path: 'costCoverage', type: 'number' },
        // Margin flags: every cost line, margin-only included (status_changed's flags are price-basis only).
        { path: 'hasPendingCosts', type: 'boolean' },
        { path: 'hasEstimatedCosts', type: 'boolean' },
        { path: 'hasExpiredCosts', type: 'boolean' },
        { path: 'cause', type: 'select' },
        { path: 'occurredAt', type: 'date' },
      ],
    },
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
