/**
 * Canonical entity IDs for the billing module.
 *
 * Mirrors what `E.billing.<entity>` would be in
 * `.mercato/generated/entities.ids.generated.ts` if the standalone-app
 * CLI properly discovered `@dainamite/*` workspace entities (see the
 * Phase 0 deviation note in `xd-249-billing-spec.md`). Until the CLI
 * gap is closed upstream, this is the single source of truth — every
 * place that previously would have referenced `E.billing.*` (CRUD
 * factory `entityId`, indexer `entityType`, response enricher
 * `targetEntity`, etc.) imports from here instead.
 *
 * When the CLI is fixed, this file can be replaced by `import { E }
 * from '#generated/entities.ids.generated'` in one PR.
 */
export const billingEntityIds = {
  account: 'billing:billing_account',
  item: 'billing:billing_item',
  usage: 'billing:billing_account_usage',
  run: 'billing:billing_run',
  runOutcome: 'billing:billing_run_outcome',
  draftInvoiceEdit: 'billing:billing_draft_invoice_edit',
} as const

export type BillingEntityId = (typeof billingEntityIds)[keyof typeof billingEntityIds]
