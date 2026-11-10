/**
 * Canonical entity IDs for the billing module — the single source of truth.
 * Billing code (CRUD factory `entityId`, indexer `entityType`, response
 * enricher `targetEntity`, …) imports from here; a package must not import
 * the app's `#generated/entities.ids.generated`.
 *
 * The build turns this object into the shipped registry
 * `generated/entities.ids.generated.ts` (scripts/generate-entity-registry.mjs),
 * which a consuming app's `mercato generate` reads to register these ids in
 * its own `E.billing`. Without that, the query index rejects billing writes
 * and `mercato entities install` treats the ids as virtual custom entities.
 *
 * Adding an entity: add it here, then `yarn workspace @dainamite/billing
 * build` and commit `generated/`. The id suffix must be the snake_case of
 * the entity class name (`billing_run` → `BillingRun`): that is how the
 * framework maps an id to its table, and the build fails otherwise. Do not
 * rely on its table-name fallback — on Open Mercato 0.9 with MikroORM 7 it
 * never matches (it iterates `MetadataStorage.getAll()` as an array, but
 * that returns a Map).
 */
export const billingEntityIds = {
  account: 'billing:billing_account',
  item: 'billing:billing_item',
  usage: 'billing:billing_account_usage',
  run: 'billing:billing_run',
  runOutcome: 'billing:billing_run_outcome',
  draftInvoiceEdit: 'billing:billing_draft_invoice_edit',
  // SPEC-002 (prepaid balance billing)
  balance: 'billing:billing_account_balance',
  transaction: 'billing:billing_account_transaction',
  topup: 'billing:billing_topup',
  statement: 'billing:billing_statement',
} as const

export type BillingEntityId = (typeof billingEntityIds)[keyof typeof billingEntityIds]
