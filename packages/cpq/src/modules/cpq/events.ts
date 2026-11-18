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

/** Identity of the cost line a sourcing event is about (ids and names only; never an amount). */
const costLineFields: EventPayloadSchemaField[] = [
  { path: 'tenantId', type: 'text' },
  { path: 'organizationId', type: 'text' },
  { path: 'quoteId', type: 'text', label: 'CPQ quote id' },
  { path: 'quoteConfigurationId', type: 'text', label: 'CPQ quote id (same value as quoteId)' },
  { path: 'salesQuoteId', type: 'text', label: 'Sales quote id' },
  { path: 'quoteLineId', type: 'text' },
  { path: 'costLineId', type: 'text' },
  { path: 'costKey', type: 'text' },
  { path: 'costName', type: 'text' },
  { path: 'chargeCode', type: 'text', optional: true },
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
    // Customer fields come from the sales order snapshot and are optional:
    // a missing value is omitted, never guessed. `items[].orderLineId` is the
    // sales order line id (the `lineId` the CPQ order API exposes) and
    // `items[].startDate` the line's service start (`YYYY-MM-DD`), if any.
    payloadSchema: {
      fields: [
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'subscriptionId', type: 'text' },
        { path: 'customerId', type: 'text' },
        { path: 'currencyCode', type: 'text' },
        { path: 'activationDate', type: 'date' },
        { path: 'sourceQuoteId', type: 'text', optional: true },
        { path: 'sourceOrderId', type: 'text', label: 'CPQ order id' },
        { path: 'customerName', type: 'text', optional: true },
        { path: 'customerKind', type: 'select', optional: true },
        { path: 'invoiceEmail', type: 'text', optional: true },
        { path: 'invoiceAddress.line1', type: 'text', optional: true },
        { path: 'invoiceAddress.city', type: 'text', optional: true },
        { path: 'invoiceAddress.postalCode', type: 'text', optional: true },
        { path: 'invoiceAddress.country', type: 'text', optional: true },
      ],
    },
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
  // Inventory cost change signal. NOT broadcast to the browser. The payload carries identifiers and keys only,
  // never an amount (confidentiality: the cost value lives in the stored rows, behind `cpq.costs.view`).
  {
    id: 'cpq.subscription.cost_changed',
    label: 'Subscription Cost Changed',
    entity: 'subscription',
    category: 'custom',
    clientBroadcast: false,
    payloadSchema: {
      fields: [
        { path: 'organizationId', type: 'text' },
        { path: 'tenantId', type: 'text' },
        { path: 'subscriptionId', type: 'text' },
        { path: 'ownerType', type: 'select', label: 'subscription_item or asset' },
        { path: 'subscriptionItemId', type: 'text', optional: true },
        { path: 'assetId', type: 'text', optional: true },
        { path: 'inventoryCostId', type: 'text' },
        { path: 'changeLogId', type: 'text' },
        { path: 'costKey', type: 'text' },
        { path: 'effectiveDate', type: 'text' },
        { path: 'supplierId', type: 'text', optional: true },
        { path: 'sourceOrderId', type: 'text' },
        { path: 'cause', type: 'select', label: 'activation, amend, renew, cancel or merge' },
        { path: 'kind', type: 'select', label: 'created, changed, ended or repointed' },
      ],
    },
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
  // Supplier cost sourcing signals (non-broadcast; emitted after the quote write commits by the sourcing publisher).
  // The payloads carry ids, keys and statuses only, never an amount, markup or margin (App Spec I-4).
  {
    id: 'cpq.quote.cost_requested',
    label: 'Cost Requested',
    entity: 'quote',
    category: 'custom',
    clientBroadcast: false,
    payloadSchema: {
      fields: [
        ...costLineFields,
        { path: 'costRequestId', type: 'text' },
        { path: 'requestSeq', type: 'number' },
        { path: 'productId', type: 'text', optional: true },
        { path: 'offeringId', type: 'text', optional: true },
        { path: 'attributes', type: 'object', label: 'Line configuration values the cost depends on' },
        { path: 'supplierId', type: 'text', optional: true, label: 'Request target supplier' },
        { path: 'requestedByUserId', type: 'text', optional: true },
        { path: 'auto', type: 'boolean', label: 'Opened by a saved recalculation' },
        { path: 'occurredAt', type: 'date' },
      ],
    },
  },
  {
    id: 'cpq.quote.cost_request_cancelled',
    label: 'Cost Request Cancelled',
    entity: 'quote',
    category: 'custom',
    clientBroadcast: false,
    payloadSchema: {
      fields: [
        ...costLineFields,
        { path: 'costRequestId', type: 'text' },
        { path: 'requestSeq', type: 'number' },
        { path: 'reason', type: 'select', label: 'reconfigured, line_removed, element_deactivated, re_requested, manual_value, quote_closed or cancelled_by_user' },
        { path: 'occurredAt', type: 'date' },
      ],
    },
  },
  {
    id: 'cpq.quote.cost_valued',
    label: 'Cost Valued',
    entity: 'quote',
    category: 'custom',
    clientBroadcast: false,
    payloadSchema: {
      fields: [
        ...costLineFields,
        { path: 'costRequestId', type: 'text', optional: true },
        { path: 'requestSeq', type: 'number', optional: true },
        { path: 'valueStatus', type: 'text', label: 'Resolved after the write' },
        { path: 'previousValueStatus', type: 'text' },
        { path: 'sourcingStatus', type: 'text' },
        { path: 'valueChanged', type: 'boolean' },
        { path: 'answerPending', type: 'boolean', label: 'A different-value answer waits on a locked quote' },
        { path: 'errorCode', type: 'text', optional: true },
        { path: 'lineReady', type: 'boolean' },
        { path: 'leadTimeHours', type: 'number', optional: true, label: 'Hours from request to answer / decline' },
        { path: 'requestedByUserId', type: 'text', optional: true },
        { path: 'cause', type: 'select', label: 'answer, decline, apply_answer, manual_value or reset' },
        { path: 'occurredAt', type: 'date' },
      ],
    },
  },
  // Supplier cost expiry warning (non-broadcast; emitted by costExpiryService after the ledger row commits, persistent).
  // Ids, keys and dates only: no amount, no supplier (App Spec I-4). `daysLeft` is negative once expired.
  {
    id: 'cpq.quote.cost_expiring',
    label: 'Supplier Cost Expiring',
    entity: 'quote',
    category: 'custom',
    clientBroadcast: false,
    payloadSchema: {
      fields: [
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'warningId', type: 'text', label: 'Ledger row id (dedupe key for consumers)' },
        { path: 'quoteId', type: 'text', label: 'CPQ quote id' },
        { path: 'quoteLineId', type: 'text' },
        { path: 'costLineId', type: 'text' },
        { path: 'costKey', type: 'text' },
        { path: 'chargeCode', type: 'text', optional: true },
        { path: 'validUntil', type: 'text', label: 'YYYY-MM-DD' },
        { path: 'daysLeft', type: 'number' },
        { path: 'expired', type: 'boolean' },
        { path: 'leadDays', type: 'number' },
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
