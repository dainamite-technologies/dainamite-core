import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

// ─── BillingAccount ──────────────────────────────────────────────
//
// A container per customer (typically one customer = one account, but the
// engine does not enforce uniqueness — multi-account-per-customer is a
// legitimate model for B2B with separate budgets / currencies / branches).
//
// The `(organization_id, tenant_id, next_bill_date)` partial index is the
// Bill Run hot path — every nightly run filters by tenant + org and orders
// by next_bill_date. Multi-org tenants share `tenant_id` across orgs, so a
// `(tenant_id, next_bill_date)`-only index would scan every other org's
// rows for each tenant — fine at 1 org / tenant, painful at 50.

@Entity({ tableName: 'billing_accounts' })
@Index({
  name: 'billing_accounts_next_bill_date_idx',
  properties: ['organizationId', 'tenantId', 'nextBillDate'],
  expression:
    'CREATE INDEX "billing_accounts_next_bill_date_idx" ON "billing_accounts" ("organization_id", "tenant_id", "next_bill_date") WHERE "deleted_at" IS NULL',
})
@Index({
  name: 'billing_accounts_customer_idx',
  properties: ['organizationId', 'tenantId', 'customerId'],
})
@Index({
  name: 'billing_accounts_sort_idx',
  properties: ['organizationId', 'tenantId', 'deletedAt', 'createdAt'],
})
export class BillingAccount {
  [OptionalProps]?:
    | 'customerKind'
    | 'billCycleInterval'
    | 'billCycleDay'
    | 'taxId'
    | 'lastBillDate'
    | 'billingMode'
    | 'creditLimit'
    | 'paymentTermsDays'
    | 'autoSendInvoice'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // String FK to customers.person.id (or any external customer system).
  // Kept as text so the package stays installable without the customers
  // module — see SPEC-001 cross-package data rule.
  @Property({ name: 'customer_id', type: 'text' })
  customerId!: string

  // Spec E (B2C): which customers collection `customer_id` points into —
  // 'company' | 'person'. Drives the lookup + label only; immutable after
  // create, like `customer_id`.
  @Property({ name: 'customer_kind', type: 'text', default: 'company' })
  customerKind: 'company' | 'person' = 'company'

  @Property({ type: 'text' })
  name!: string

  // ISO 4217 currency code. An account is single-currency by design —
  // multi-currency = multiple accounts.
  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  // Cycle unit: 'daily' | 'weekly' | 'monthly' | 'annually' (`lib/billCycle.ts`).
  // Validated at API ingress. One cycle = `bill_cycle_interval` units.
  @Property({ name: 'bill_cycle', type: 'text' })
  billCycle!: string

  // "Every N units" — 1 = every month, 3 = quarterly, 30 + daily = every 30 days.
  @Property({ name: 'bill_cycle_interval', type: 'integer', default: 1 })
  billCycleInterval: number = 1

  // Bill cycle day the cycle is pinned to: '1'…'31' for monthly/annually (a
  // day past the end of a short month means its last day), 'mon'…'sun' for
  // weekly, null for daily (the cycle counts from `next_bill_date`). Bill Runs
  // re-pin every advance to this day (`lib/billPeriod.ts`).
  @Property({ name: 'bill_cycle_day', type: 'text', nullable: true })
  billCycleDay?: string | null

  @Property({ name: 'invoice_email', type: 'text' })
  invoiceEmail!: string

  // ISO 639-1; allowed values come from `lib/invoiceLanguages.ts` (Zod-validated,
  // no DB constraint). Used by mailer / template renderer.
  @Property({ name: 'invoice_language', type: 'text' })
  invoiceLanguage!: string

  // NIP / VATIN / TaxID. Nullable for individuals without a registered tax ID.
  @Property({ name: 'tax_id', type: 'text', nullable: true })
  taxId?: string | null

  // { line1, line2?, city, postal_code, country } — JSONB because address
  // shape differs across countries and we never query by address fields.
  @Property({ name: 'invoice_address', type: 'jsonb' })
  invoiceAddress!: Record<string, unknown>

  // Anchor of the NEXT bill period to be processed (advanced by Bill Run
  // on success). Date-only — calendar-aware cycle arithmetic.
  @Property({ name: 'next_bill_date', type: 'date', columnType: 'date' })
  nextBillDate!: Date

  // Anchor of the most recently billed period; null for fresh accounts.
  @Property({ name: 'last_bill_date', type: 'date', columnType: 'date', nullable: true })
  lastBillDate?: Date | null

  // Billing mode — 'postpaid' (default; the shipped Bill Run → draft →
  // post flow) or 'prepaid' (top up a balance, draw it down in real time;
  // SPEC-002). Immutable after create (like currency_code); validated at
  // API ingress. Existing rows default to postpaid — zero behavior change.
  @Property({ name: 'billing_mode', type: 'text', default: 'postpaid' })
  billingMode: string = 'postpaid'

  // Credit line extended to this customer (both modes). Prepaid: permitted
  // overdraft below zero. Postpaid: max outstanding AR exposure. `0` = no
  // credit. Reported, never enforced by billing (SPEC-002 assumption #11).
  @Property({ name: 'credit_limit', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  creditLimit: string = '0'

  // Spec B — payment terms in days for this account's invoices; null = the
  // organization default (`billing_settings.default_payment_terms_days`).
  @Property({ name: 'payment_terms_days', type: 'integer', nullable: true })
  paymentTermsDays?: number | null

  // Spec B — email each invoice to `invoice_email` automatically at post.
  @Property({ name: 'auto_send_invoice', type: 'boolean', default: false })
  autoSendInvoice: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingItem ─────────────────────────────────────────────────
//
// A single line that will appear on an invoice. Three flavours:
// `one_time` / `recurring` / `usage` — see rate_json shape per type in
// data/validators.ts.
//
// `(tenant_id, bill_account_id, source_ref)` is unique for idempotency.
// Postgres treats NULLs as distinct, so items without a source_ref do not
// conflict — that is intentional (CSV imports / manual entries).

@Entity({ tableName: 'billing_items' })
@Unique({
  name: 'billing_items_source_ref_unique',
  properties: ['tenantId', 'billAccountId', 'sourceRef'],
})
@Index({
  name: 'billing_items_account_type_idx',
  properties: ['billAccountId', 'type'],
})
@Index({
  name: 'billing_items_account_active_idx',
  properties: ['billAccountId', 'type', 'isActive'],
  expression:
    'CREATE INDEX "billing_items_account_active_idx" ON "billing_items" ("bill_account_id", "type", "is_active") WHERE "deleted_at" IS NULL',
})
@Index({
  name: 'billing_items_subscription_idx',
  properties: ['organizationId', 'tenantId', 'subscriptionId'],
})
export class BillingItem {
  [OptionalProps]?:
    | 'billEndDate'
    | 'uomCode'
    | 'subscriptionId'
    | 'subscriptionItemId'
    | 'sourceRef'
    | 'currencyMismatch'
    | 'billedToDate'
    | 'creditReason'
    | 'chargeTiming'
    | 'prorate'
    | 'taxRate'
    | 'priceBasis'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // FK string to BillingAccount.id (intra-module; no ORM relation kept to
  // avoid coupling — we resolve at runtime).
  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // 'one_time' | 'recurring' | 'usage'.
  @Property({ type: 'text' })
  type!: string

  @Property({ name: 'bill_start_date', type: 'date', columnType: 'date' })
  billStartDate!: Date

  // Null = open-ended (typical for ongoing recurring items).
  @Property({ name: 'bill_end_date', type: 'date', columnType: 'date', nullable: true })
  billEndDate?: Date | null

  @Property({ type: 'text' })
  description!: string

  // Pricing definition. Shape validated by Zod per `type`; see
  // data/validators.ts.
  @Property({ name: 'rate_json', type: 'jsonb' })
  rateJson!: Record<string, unknown>

  // Required for type='usage' (must match a Usage record's uom_code
  // exactly — no conversion). Ignored for other types.
  @Property({ name: 'uom_code', type: 'text', nullable: true })
  uomCode?: string | null

  // String FK to upstream subscription (e.g. CPQ's
  // cpq_inventory_subscriptions.id). Null for CSV / manual / non-subscription
  // contexts.
  @Property({ name: 'subscription_id', type: 'text', nullable: true })
  subscriptionId?: string | null

  @Property({ name: 'subscription_item_id', type: 'text', nullable: true })
  subscriptionItemId?: string | null

  // Idempotency key — duplicate POST returns the existing row.
  @Property({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef?: string | null

  // Set when the integrator POSTed a value in a different currency than the
  // account's currency_code. Operator sees a warning on the draft.
  @Property({ name: 'currency_mismatch', type: 'boolean', default: false })
  currencyMismatch: boolean = false

  // Anti-double-bill guard at the item level — see spec
  // "Why two anti-duplicate guards".
  @Property({ name: 'billed_to_date', type: 'date', columnType: 'date', nullable: true })
  billedToDate?: Date | null

  // Why ending this item credited already-billed days (Part 2, D8): operator
  // text or a generated code ({ kind, … } — `lib/creditReason.ts`). Copied
  // into the credit line's metadata at bill time; last end-date change wins.
  @Property({ name: 'credit_reason', type: 'jsonb', nullable: true })
  creditReason?: Record<string, unknown> | null

  // Spec A — recurring items only. 'in_advance' (default) bills the coming
  // period on the bill date; 'in_arrears' bills the period just ended.
  @Property({ name: 'charge_timing', type: 'text', default: 'in_advance' })
  chargeTiming: 'in_advance' | 'in_arrears' = 'in_advance'

  // Spec A — recurring items only. Prorate partial periods (item starts /
  // ends mid-period) by calendar days, and credit unused days when an item
  // billed in advance ends early. False = skip partial periods.
  @Property({ name: 'prorate', type: 'boolean', default: true })
  prorate: boolean = true

  // Spec B (B-D1) — VAT rate in percent, snapshotted onto every invoice line.
  // Filled from `billing_settings.default_tax_rate` at creation when omitted;
  // never looked up live, so a default change never re-prices subscriptions.
  @Property({ name: 'tax_rate', type: 'numeric', columnType: 'numeric(7, 4)', default: '0' })
  taxRate: string = '0'

  // Spec F (F-D2) — the `rate_json` amounts are stored as typed, on this
  // basis. Invoice lines are computed from it (`lib/lineAmounts.ts`), so a
  // typed gross is reproduced exactly. Tiered usage rates are always 'net'.
  @Property({ name: 'price_basis', type: 'text', default: 'net' })
  priceBasis: 'net' | 'gross' = 'net'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingAccountUsage ─────────────────────────────────────────
//
// Bucket for pre-aggregated usage uploaded by external systems. The
// selection index `(bill_account_id, uom_code, rated_in_bill_run_id,
// period_end)` matches the Bill Run "find unrated records" predicate
// exactly — keep it in sync if that predicate changes.

@Entity({ tableName: 'billing_account_usage' })
@Unique({
  name: 'billing_account_usage_source_ref_unique',
  properties: ['tenantId', 'billAccountId', 'sourceRef'],
})
@Index({
  name: 'billing_account_usage_rating_idx',
  properties: ['billAccountId', 'uomCode', 'ratedInBillRunId', 'periodEnd'],
})
export class BillingAccountUsage {
  [OptionalProps]?:
    | 'lineDescription'
    | 'sourceRef'
    | 'ratedInBillRunId'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // Must match the `uom_code` on a corresponding `type='usage'` Billing Item.
  @Property({ name: 'uom_code', type: 'text' })
  uomCode!: string

  // numeric(18,4) → string in app code (standard MikroORM numeric handling).
  @Property({ type: 'numeric', columnType: 'numeric(18, 4)' })
  quantity!: string

  @Property({ name: 'period_start', type: Date })
  periodStart!: Date

  @Property({ name: 'period_end', type: Date })
  periodEnd!: Date

  // Optional per-record description. When set, Bill Run emits one invoice
  // line per Usage record with this description. When null, the run
  // aggregates all matching Usage records into a single line using the
  // Billing Item's `description`.
  @Property({ name: 'line_description', type: 'text', nullable: true })
  lineDescription?: string | null

  @Property({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef?: string | null

  // Set when consumed; prevents double-rating on retry.
  @Property({ name: 'rated_in_bill_run_id', type: 'uuid', nullable: true })
  ratedInBillRunId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingRun ──────────────────────────────────────────────────
//
// A single execution of the engine — one row per trigger (schedule or
// manual). The concurrency lock is a Postgres transaction-scoped advisory
// lock keyed by hash(tenant_id || 'billing-run'); it is NOT stored on this
// row. Crash recovery for zombie `status='running'` rows is handled by
// workers/reap-stale-bill-runs.ts.
//
// Class names must be the PascalCase of the entity-id suffix (`billing:
// billing_run` → `BillingRun`) — that is how Open Mercato maps an id to its
// table. Until 0.20.0 this class was `BillRun` (likewise `BillRunOutcome`,
// `DraftInvoiceEdit`), and those three ids resolved to no table; see
// data/entityIds.ts. Type-only aliases for the old names are at the end of
// this file.

@Entity({ tableName: 'billing_runs' })
@Index({
  name: 'billing_runs_tenant_status_idx',
  properties: ['tenantId', 'status', 'startedAt'],
})
@Index({
  name: 'billing_runs_parent_idx',
  properties: ['parentRunId'],
})
export class BillingRun {
  [OptionalProps]?:
    | 'parentRunId'
    | 'dryRun'
    | 'testMode'
    | 'scopedAccountIds'
    | 'startedAt'
    | 'finishedAt'
    | 'summary'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // 'schedule' | 'manual'.
  @Property({ name: 'triggered_by', type: 'text' })
  triggeredBy!: string

  // Set when this run is a "retry failed" of a previous run.
  @Property({ name: 'parent_run_id', type: 'uuid', nullable: true })
  parentRunId?: string | null

  // True → compute everything but persist nothing (preview).
  @Property({ name: 'dry_run', type: 'boolean', default: false })
  dryRun: boolean = false

  // True → persist drafts flagged as test, but do not advance state.
  @Property({ name: 'test_mode', type: 'boolean', default: false })
  testMode: boolean = false

  // Optional — run processes only these accounts when set. JSONB
  // (Postgres arrays would work too, but jsonb keeps tooling uniform
  // across this package).
  @Property({ name: 'scoped_account_ids', type: 'jsonb', nullable: true })
  scopedAccountIds?: string[] | null

  // The "today" the run uses to evaluate `next_bill_date <= as_of_date`.
  @Property({ name: 'as_of_date', type: 'date', columnType: 'date' })
  asOfDate!: Date

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  // 'running' | 'completed' | 'partial_failure' | 'failed'.
  @Property({ type: 'text' })
  status!: string

  // { accounts_processed, drafts_created, drafts_skipped_existing,
  //   accounts_failed, accounts_with_warnings, usage_records_rated }
  @Property({ type: 'jsonb', nullable: true })
  summary?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingRunOutcome ───────────────────────────────────────────
//
// Per-account outcome of a Bill Run. Stored in its own table (not as a
// JSONB array on BillingRun.summary) so operators can query failures across
// runs without jsonb_array_elements gymnastics. See spec rationale.

@Entity({ tableName: 'billing_run_outcomes' })
@Index({
  name: 'billing_run_outcomes_run_status_idx',
  properties: ['billRunId', 'status'],
})
@Index({
  name: 'billing_run_outcomes_account_history_idx',
  properties: ['organizationId', 'tenantId', 'billAccountId', 'createdAt'],
})
export class BillingRunOutcome {
  [OptionalProps]?:
    | 'errorMessage'
    | 'warnings'
    | 'draftInvoiceId'
    | 'statementId'
    | 'cycles'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'bill_run_id', type: 'uuid' })
  billRunId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // 'success' | 'success_with_warnings' | 'skipped_existing_draft' | 'failed'.
  @Property({ type: 'text' })
  status!: string

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  // E.g. `{ unmatched_usage_uoms: ["api_request"] }`.
  @Property({ type: 'jsonb', nullable: true })
  warnings?: Record<string, unknown> | null

  // FK string to the core/sales invoice (drafted by the run). Null when
  // the run skipped (status='skipped_existing_draft' or 'failed').
  @Property({ name: 'draft_invoice_id', type: 'uuid', nullable: true })
  draftInvoiceId?: string | null

  // FK (string) to the BillingStatement produced for a PREPAID account
  // (SPEC-002). Prepaid accounts get a statement instead of a draft invoice
  // at period close, so this is the prepaid analogue of `draft_invoice_id`.
  @Property({ name: 'statement_id', type: 'uuid', nullable: true })
  statementId?: string | null

  // Spec A — one entry per bill date the run processed for this account
  // (catch-up emits several): `[{ bill_date, period_start, period_end,
  // status, line_count, total_net, invoice_id }]`. `draft_invoice_id` keeps
  // pointing at the last invoice for backward compatibility.
  @Property({ type: 'jsonb', nullable: true })
  cycles?: Array<Record<string, unknown>> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingDraftInvoiceEdit (audit) ─────────────────────────────
//
// Append-only audit of every operator edit on a draft invoice line.
// Pattern mirrors `cpq_subscription_change_logs` — minimal columns
// (no updated_at / is_active), append-only, soft-delete reserved for
// compliance erasure only.

@Entity({ tableName: 'billing_draft_invoice_edits' })
@Index({
  name: 'billing_draft_invoice_edits_invoice_idx',
  properties: ['organizationId', 'tenantId', 'invoiceId', 'createdAt'],
})
@Index({
  name: 'billing_draft_invoice_edits_user_idx',
  properties: ['organizationId', 'tenantId', 'userId', 'createdAt'],
})
export class BillingDraftInvoiceEdit {
  [OptionalProps]?: 'invoiceLineId' | 'beforeJson' | 'afterJson' | 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // FK string to the core/sales invoice (no ORM relation across packages).
  @Property({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string

  // Null for `line_added` / `line_removed` actions whose target line does
  // not yet (or no longer) exist on the invoice.
  @Property({ name: 'invoice_line_id', type: 'uuid', nullable: true })
  invoiceLineId?: string | null

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  // 'line_added' | 'line_removed' | 'line_edited'.
  @Property({ type: 'text' })
  action!: string

  // Snapshot before the edit. Null for `line_added` (no prior state).
  @Property({ name: 'before_json', type: 'jsonb', nullable: true })
  beforeJson?: Record<string, unknown> | null

  // Snapshot after the edit. Null for `line_removed` (no resulting state).
  @Property({ name: 'after_json', type: 'jsonb', nullable: true })
  afterJson?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  // Reserved for compliance erasure only; runtime never deletes audit rows
  // through normal flows.
  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingAccountBalance (SPEC-002) ────────────────────────────
//
// The denormalized running balance for a prepaid account — exactly one
// row per prepaid account. It is the O(1) read AND the row the atomic
// `UPDATE … RETURNING` debit/credit locks, which is why the balance is
// NOT a column on `billing_accounts`: the high-write balance update never
// touches the account row that the Bill Run hot-path index sits on.
//
// `balance` is the cache; the source of truth is
// `SUM(billing_account_transactions.amount)`. The reconciliation invariant
// `balance == SUM(amount) == latest.balance_after` is unit-tested.

@Entity({ tableName: 'billing_account_balances' })
@Unique({
  name: 'billing_account_balances_account_unique',
  properties: ['tenantId', 'billAccountId'],
})
@Index({
  name: 'billing_account_balances_balance_idx',
  properties: ['organizationId', 'tenantId', 'balance'],
})
export class BillingAccountBalance {
  [OptionalProps]?:
    | 'lowBalanceThreshold'
    | 'lastMovementAt'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Unique FK (string) to BillingAccount.id — one balance per account.
  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // Denormalized from the account so the balance row is self-contained.
  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  // Running balance. May be NEGATIVE (usage is never rejected). Maintained
  // exclusively by the atomic `UPDATE … RETURNING` in lib/balanceLedger.ts.
  @Property({ name: 'balance', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  balance: string = '0'

  // When `balance <= threshold` → status `low` + `billing.balance.low`.
  // Null = use the tenant config default
  // (`billing.prepaid.low_balance_threshold_default`).
  @Property({
    name: 'low_balance_threshold',
    type: 'numeric',
    columnType: 'numeric(18, 4)',
    nullable: true,
  })
  lowBalanceThreshold?: string | null

  // Timestamp of the most recent transaction — a cheap "is this account
  // active?" signal.
  @Property({ name: 'last_movement_at', type: Date, nullable: true })
  lastMovementAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ─── BillingAccountTransaction (SPEC-002, append-only) ───────────
//
// The source of truth for every balance movement. Append-only — pattern
// mirrors BillingDraftInvoiceEdit (no `updated_at` / `is_active`;
// `deleted_at` reserved for compliance erasure only). `balance = SUM(amount)`.
//
// The unique `(tenant_id, bill_account_id, source_ref)` is the idempotency
// gate: a deduplicated usage upload or a retried recurring charge can never
// double-debit (Postgres treats NULL source_ref as distinct — manual
// adjustments without a key always insert).

@Entity({ tableName: 'billing_account_transactions' })
@Unique({
  name: 'billing_account_transactions_source_ref_unique',
  properties: ['tenantId', 'billAccountId', 'sourceRef'],
})
@Index({
  name: 'billing_account_transactions_history_idx',
  properties: ['organizationId', 'tenantId', 'billAccountId', 'createdAt'],
})
@Index({
  name: 'billing_account_transactions_account_type_idx',
  properties: ['billAccountId', 'type', 'createdAt'],
})
export class BillingAccountTransaction {
  [OptionalProps]?:
    | 'usageId'
    | 'billingItemId'
    | 'topupId'
    | 'statementId'
    | 'sourceRef'
    | 'metadata'
    | 'userId'
    | 'createdAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // 'topup' | 'usage' | 'recurring' | 'one_time' | 'adjustment' | 'reversal'.
  @Property({ type: 'text' })
  type!: string

  // SIGNED: `> 0` credit, `< 0` debit. Balance = SUM(amount).
  @Property({ type: 'numeric', columnType: 'numeric(18, 4)' })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  // Running balance AFTER this transaction — snapshotted from the atomic
  // `UPDATE … RETURNING`. Enables audit + fast statement math without
  // re-summing the whole ledger.
  @Property({ name: 'balance_after', type: 'numeric', columnType: 'numeric(18, 4)' })
  balanceAfter!: string

  // FK (string) to BillingAccountUsage for type='usage'.
  @Property({ name: 'usage_id', type: 'uuid', nullable: true })
  usageId?: string | null

  // FK (string) to the Billing Item that priced this debit.
  @Property({ name: 'billing_item_id', type: 'uuid', nullable: true })
  billingItemId?: string | null

  // FK (string) to BillingTopup for type='topup'.
  @Property({ name: 'topup_id', type: 'uuid', nullable: true })
  topupId?: string | null

  // FK (string) to the BillingStatement a period-close charge was rolled into.
  @Property({ name: 'statement_id', type: 'uuid', nullable: true })
  statementId?: string | null

  @Property({ type: 'text' })
  description!: string

  // Idempotency key, unique per (tenant_id, bill_account_id, source_ref).
  // usage debits = the usage record's source_ref; recurring =
  // `recurring-{itemId}-{periodEndISO}`; topup = `topup-{paymentId}`.
  @Property({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef?: string | null

  // e.g. usage_tier_breakdown, uom_code, bill_period_start/end, gateway ids.
  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  // Operator for manual `adjustment` / `reversal`.
  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  // Compliance erasure only.
  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingTopup (SPEC-002 — the "registered top-up") ───────────
//
// One row per top-up attempt with a lifecycle (pending → captured | failed
// | expired | cancelled), linked to its GatewayTransaction, its balance
// credit transaction, and its VAT receipt invoice. "The balance went up"
// is always explainable.

@Entity({ tableName: 'billing_topups' })
@Unique({
  name: 'billing_topups_payment_id_unique',
  properties: ['tenantId', 'paymentId'],
})
@Index({
  name: 'billing_topups_account_history_idx',
  properties: ['organizationId', 'tenantId', 'billAccountId', 'createdAt'],
})
@Index({
  name: 'billing_topups_status_idx',
  properties: ['tenantId', 'status'],
})
export class BillingTopup {
  [OptionalProps]?:
    | 'gatewayTransactionId'
    | 'transactionId'
    | 'receiptInvoiceId'
    | 'sourceRef'
    | 'metadata'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // 'pending' | 'captured' | 'failed' | 'expired' | 'cancelled'.
  @Property({ type: 'text' })
  status!: string

  @Property({ type: 'numeric', columnType: 'numeric(18, 4)' })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  // The UUID we pass to createPaymentSession and match the captured event
  // on. Unique per tenant.
  @Property({ name: 'payment_id', type: 'uuid' })
  paymentId!: string

  // FK (string) to payment_gateways.GatewayTransaction once the session is
  // created.
  @Property({ name: 'gateway_transaction_id', type: 'uuid', nullable: true })
  gatewayTransactionId?: string | null

  // FK (string) to the credit BillingAccountTransaction written on capture.
  @Property({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId?: string | null

  // FK (string) to the core/sales VAT receipt invoice.
  @Property({ name: 'receipt_invoice_id', type: 'uuid', nullable: true })
  receiptInvoiceId?: string | null

  // Optional idempotency for the initiating request.
  @Property({ name: 'source_ref', type: 'text', nullable: true })
  sourceRef?: string | null

  // success_url / cancel_url, provider payload echoes.
  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── BillingStatement (SPEC-002 — period close) ──────────────────
//
// A non-fiscal consumption summary for a prepaid account's bill period.
// Chains cleanly: each statement's `opening_balance` equals the prior
// statement's `closing_balance`. Anti-duplicate via the unique
// (tenant_id, bill_account_id, period_start, period_end).

@Entity({ tableName: 'billing_statements' })
@Unique({
  name: 'billing_statements_period_unique',
  properties: ['tenantId', 'billAccountId', 'periodStart', 'periodEnd'],
})
@Index({
  name: 'billing_statements_account_period_idx',
  properties: ['organizationId', 'tenantId', 'billAccountId', 'periodEnd'],
})
export class BillingStatement {
  [OptionalProps]?:
    | 'billRunId'
    | 'totalAdjustments'
    | 'vatSummary'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // FK (string) to the BillingRun that generated it (period close reuses the
  // run engine). Null for a manually-generated statement.
  @Property({ name: 'bill_run_id', type: 'uuid', nullable: true })
  billRunId?: string | null

  @Property({ name: 'period_start', type: 'date', columnType: 'date' })
  periodStart!: Date

  @Property({ name: 'period_end', type: 'date', columnType: 'date' })
  periodEnd!: Date

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  // Balance at period_start (= the prior statement's closing_balance).
  @Property({ name: 'opening_balance', type: 'numeric', columnType: 'numeric(18, 4)' })
  openingBalance!: string

  // Sum of credits in window.
  @Property({ name: 'total_topups', type: 'numeric', columnType: 'numeric(18, 4)' })
  totalTopups!: string

  // Sum of metered (real-time) usage debits in window (absolute).
  @Property({ name: 'total_usage', type: 'numeric', columnType: 'numeric(18, 4)' })
  totalUsage!: string

  // Sum of recurring + one_time charges debited at this close (absolute).
  @Property({ name: 'total_recurring', type: 'numeric', columnType: 'numeric(18, 4)' })
  totalRecurring!: string

  // Signed sum of manual adjustment + reversal movements in the window. Kept as
  // its own term so the statement stays self-consistent (closing reproduces
  // from the shown components) and the opening→closing chain never drifts.
  @Property({ name: 'total_adjustments', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  totalAdjustments: string = '0'

  // opening + topups + adjustments − usage − recurring (= the period's net).
  @Property({ name: 'closing_balance', type: 'numeric', columnType: 'numeric(18, 4)' })
  closingBalance!: string

  // Per billing_item_id: { billing_type, uom_code?, quantity, amount }.
  @Property({ name: 'debit_breakdown', type: 'jsonb' })
  debitBreakdown!: Record<string, unknown>

  // Spec F (F5) — `[{ rate, net, tax, gross }]` per VAT rate of the period's
  // prepaid debits. Empty in `topup` tax-point mode (VAT was on the receipt).
  @Property({ name: 'vat_summary', type: 'jsonb', nullable: true })
  vatSummary?: Array<{ rate: string; net: string; tax: string; gross: string }> | null

  // 'generated' | 'sent'.
  @Property({ type: 'text' })
  status!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ─── Deprecated names (0.20.0) ───────────────────────────────────
//
// Type-only on purpose: a runtime alias (`export const BillRun = BillingRun`)
// would make the app's generated `entities` list carry the same class twice.
// Code that used the old names as values (`em.find(BillRun, …)`) must switch
// to the new ones — TypeScript flags it.

/** @deprecated Renamed to {@link BillingRun} in 0.20.0. */
export type BillRun = BillingRun
/** @deprecated Renamed to {@link BillingRunOutcome} in 0.20.0. */
export type BillRunOutcome = BillingRunOutcome
/** @deprecated Renamed to {@link BillingDraftInvoiceEdit} in 0.20.0. */
export type DraftInvoiceEdit = BillingDraftInvoiceEdit

// ─── Spec 0 — standalone invoice ledger ─────────────────────────
//
// Billing owns its documents end to end: invoices, credit / debit memos and
// prepaid top-up receipts live here, NOT in core `sales_invoices`. FK
// columns are plain strings (the package guard forbids ORM relations).
// Partial unique indexes (dedupe per bill date, unique posted number) are
// created in the migration — decorators can't express their WHERE clause.

@Entity({ tableName: 'billing_invoices' })
@Index({
  name: 'billing_invoices_status_idx',
  properties: ['tenantId', 'organizationId', 'status'],
})
@Index({
  name: 'billing_invoices_account_idx',
  properties: ['billAccountId', 'status', 'dueDate'],
})
@Index({ name: 'billing_invoices_run_idx', properties: ['billRunId'] })
@Index({ name: 'billing_invoices_corrects_idx', properties: ['correctsInvoiceId'] })
@Index({ name: 'billing_invoices_topup_idx', properties: ['topupId'] })
export class BillingInvoice {
  [OptionalProps]?:
    | 'documentType'
    | 'series'
    | 'status'
    | 'testRun'
    | 'billRunId'
    | 'billDate'
    | 'periodStart'
    | 'periodEnd'
    | 'issueDate'
    | 'dueDate'
    | 'subtotalNet'
    | 'taxTotal'
    | 'totalGross'
    | 'paidTotal'
    | 'creditedTotal'
    | 'outstanding'
    | 'correctsInvoiceId'
    | 'correctionReason'
    | 'correctsInvoiceNumber'
    | 'correctsIssueDate'
    | 'buyerSnapshot'
    | 'sellerSnapshot'
    | 'pdfAttachmentId'
    | 'topupId'
    | 'postedAt'
    | 'metadata'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  // 'invoice' | 'credit_memo' | 'debit_memo' | 'receipt'.
  @Property({ name: 'document_type', type: 'text', default: 'invoice' })
  documentType: string = 'invoice'

  // DRAFT-… / TEST-… until posted, then the series number (Spec 0 numbering).
  @Property({ type: 'text' })
  number!: string

  // Numbering series the posted number came from; null while draft.
  @Property({ type: 'text', nullable: true })
  series?: string | null

  // 'draft' | 'posted' | 'partially_paid' | 'paid' | 'credited'. No 'void'.
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'test_run', type: 'boolean', default: false })
  testRun: boolean = false

  @Property({ name: 'bill_run_id', type: 'uuid', nullable: true })
  billRunId?: string | null

  // Spec A: the bill date this invoice is for (dedupe key).
  @Property({ name: 'bill_date', type: 'date', columnType: 'date', nullable: true })
  billDate?: Date | null

  // Display period = min/max of the line service periods.
  @Property({ name: 'period_start', type: 'date', columnType: 'date', nullable: true })
  periodStart?: Date | null

  @Property({ name: 'period_end', type: 'date', columnType: 'date', nullable: true })
  periodEnd?: Date | null

  @Property({ name: 'issue_date', type: 'date', columnType: 'date', nullable: true })
  issueDate?: Date | null

  @Property({ name: 'due_date', type: 'date', columnType: 'date', nullable: true })
  dueDate?: Date | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'subtotal_net', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  subtotalNet: string = '0'

  @Property({ name: 'tax_total', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  taxTotal: string = '0'

  @Property({ name: 'total_gross', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  totalGross: string = '0'

  @Property({ name: 'paid_total', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  paidTotal: string = '0'

  @Property({ name: 'credited_total', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  creditedTotal: string = '0'

  @Property({ type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  outstanding: string = '0'

  // Spec D groundwork: the document a credit / debit memo corrects.
  @Property({ name: 'corrects_invoice_id', type: 'uuid', nullable: true })
  correctsInvoiceId?: string | null

  @Property({ name: 'correction_reason', type: 'text', nullable: true })
  correctionReason?: string | null

  // Spec D — snapshot of the corrected document (printed "Corrects invoice X of DATE").
  @Property({ name: 'corrects_invoice_number', type: 'text', nullable: true })
  correctsInvoiceNumber?: string | null

  @Property({ name: 'corrects_issue_date', type: 'date', columnType: 'date', nullable: true })
  correctsIssueDate?: Date | null

  // Frozen at post: who the document was issued to / by.
  @Property({ name: 'buyer_snapshot', type: 'jsonb', nullable: true })
  buyerSnapshot?: Record<string, unknown> | null

  @Property({ name: 'seller_snapshot', type: 'jsonb', nullable: true })
  sellerSnapshot?: Record<string, unknown> | null

  @Property({ name: 'pdf_attachment_id', type: 'uuid', nullable: true })
  pdfAttachmentId?: string | null

  // Receipts: the BillingTopup this receipt was issued for.
  @Property({ name: 'topup_id', type: 'uuid', nullable: true })
  topupId?: string | null

  @Property({ name: 'posted_at', type: Date, nullable: true })
  postedAt?: Date | null

  // Free-form extras only (delivery log, …) — never a query key.
  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'billing_invoice_lines' })
@Index({ name: 'billing_invoice_lines_invoice_idx', properties: ['invoiceId', 'lineNumber'] })
export class BillingInvoiceLine {
  [OptionalProps]?:
    | 'billingItemId'
    | 'taxRate'
    | 'taxAmount'
    | 'servicePeriodStart'
    | 'servicePeriodEnd'
    | 'correctsLineId'
    | 'metadata'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ name: 'billing_item_id', type: 'uuid', nullable: true })
  billingItemId?: string | null

  // 'one_time' | 'recurring' | 'usage' | 'manual' | 'receipt'.
  @Property({ name: 'billing_type', type: 'text' })
  billingType!: string

  @Property({ type: 'text' })
  description!: string

  @Property({ type: 'numeric', columnType: 'numeric(18, 4)' })
  quantity!: string

  @Property({ name: 'unit_price_net', type: 'numeric', columnType: 'numeric(18, 4)' })
  unitPriceNet!: string

  @Property({ name: 'tax_rate', type: 'numeric', columnType: 'numeric(7, 4)', default: '0' })
  taxRate: string = '0'

  @Property({ name: 'net_amount', type: 'numeric', columnType: 'numeric(18, 4)' })
  netAmount!: string

  @Property({ name: 'tax_amount', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'gross_amount', type: 'numeric', columnType: 'numeric(18, 4)' })
  grossAmount!: string

  @Property({ name: 'service_period_start', type: 'date', columnType: 'date', nullable: true })
  servicePeriodStart?: Date | null

  @Property({ name: 'service_period_end', type: 'date', columnType: 'date', nullable: true })
  servicePeriodEnd?: Date | null

  // Spec D groundwork: the original line a memo line corrects.
  @Property({ name: 'corrects_line_id', type: 'uuid', nullable: true })
  correctsLineId?: string | null

  // Proration / credit / usage tier breakdown / charge timing.
  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'billing_document_sequences' })
@Unique({
  name: 'billing_document_sequences_scope_uq',
  properties: ['tenantId', 'organizationId', 'series', 'scopeKey'],
})
export class BillingDocumentSequence {
  [OptionalProps]?: 'scopeKey' | 'nextValue' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // 'invoice' | 'credit_memo' | 'receipt'.
  @Property({ type: 'text' })
  series!: string

  // '' (never resets), 'YYYY' (yearly) or 'YYYY-MM' (monthly) — from the mask.
  @Property({ name: 'scope_key', type: 'text', default: '' })
  scopeKey: string = ''

  @Property({ name: 'next_value', type: 'bigint', default: 1 })
  nextValue: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'billing_settings' })
// Mirrors the partial unique index `billing_settings_org_uq` (… WHERE deleted_at IS NULL)
// created in Migration20261115000000_billing_invoice_ledger: one settings row per organization.
@Unique({ name: 'billing_settings_org_uq', properties: ['tenantId', 'organizationId'] })
export class BillingSettings {
  [OptionalProps]?:
    | 'lowBalanceThresholdDefault'
    | 'nearLimitBufferDefault'
    | 'statementEnabled'
    | 'topupTaxRate'
    | 'prepaidTaxPoint'
    | 'topupProvider'
    | 'numberMasks'
    | 'legalName'
    | 'sellerAddress'
    | 'taxId'
    | 'bankName'
    | 'iban'
    | 'bic'
    | 'invoiceFooter'
    | 'logoAttachmentId'
    | 'defaultPaymentTermsDays'
    | 'defaultTaxRate'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Prepaid defaults (moved from core `configs`, E-D2).
  @Property({ name: 'low_balance_threshold_default', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  lowBalanceThresholdDefault: string = '0'

  @Property({ name: 'near_limit_buffer_default', type: 'numeric', columnType: 'numeric(18, 4)', default: '0' })
  nearLimitBufferDefault: string = '0'

  @Property({ name: 'statement_enabled', type: 'boolean', default: true })
  statementEnabled: boolean = true

  @Property({ name: 'topup_tax_rate', type: 'numeric', columnType: 'numeric(7, 4)', default: '0' })
  topupTaxRate: string = '0'

  // Spec F (F-D3) — where prepaid VAT is charged: 'topup' (VAT split on the
  // top-up receipt; consumption debits carry no VAT) or 'consumption'
  // (receipts carry no VAT; debits are gross at the item's tax rate).
  @Property({ name: 'prepaid_tax_point', type: 'text', default: 'topup' })
  prepaidTaxPoint: 'topup' | 'consumption' = 'topup'

  @Property({ name: 'topup_provider', type: 'text', default: 'stripe' })
  topupProvider: string = 'stripe'

  // { invoice, credit_memo, receipt } number masks (Spec 0 numbering).
  @Property({ name: 'number_masks', type: 'jsonb', nullable: true })
  numberMasks?: Record<string, string> | null

  // Seller / payment / document fields (Spec B). Posting is blocked until
  // legal_name, seller_address, tax_id and iban are filled.
  @Property({ name: 'legal_name', type: 'text', nullable: true })
  legalName?: string | null

  // { line1, line2?, city, postal_code, country }
  @Property({ name: 'seller_address', type: 'jsonb', nullable: true })
  sellerAddress?: Record<string, unknown> | null

  @Property({ name: 'tax_id', type: 'text', nullable: true })
  taxId?: string | null

  @Property({ name: 'bank_name', type: 'text', nullable: true })
  bankName?: string | null

  @Property({ name: 'iban', type: 'text', nullable: true })
  iban?: string | null

  @Property({ name: 'bic', type: 'text', nullable: true })
  bic?: string | null

  @Property({ name: 'invoice_footer', type: 'text', nullable: true })
  invoiceFooter?: string | null

  // Attachment id (core `attachments`) of the document logo.
  @Property({ name: 'logo_attachment_id', type: 'uuid', nullable: true })
  logoAttachmentId?: string | null

  @Property({ name: 'default_payment_terms_days', type: 'integer', default: 14 })
  defaultPaymentTermsDays: number = 14

  @Property({ name: 'default_tax_rate', type: 'numeric', columnType: 'numeric(7, 4)', default: '23' })
  defaultTaxRate: string = '23'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── Spec C — payments, allocations, imports ─────────────────────
//
// A billing-owned payment register (no core `SalesPayment`). One row per
// money-in event (bank CSV line, manual entry, gateway capture). Invoice
// `paid_total` / `outstanding` / status are always RECOMPUTED from the
// active allocations (`lib/allocation.ts`), never incremented.
// Partial unique indexes (source_ref, external_ref) are in the migration.

@Entity({ tableName: 'billing_payments' })
@Index({ name: 'billing_payments_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
@Index({ name: 'billing_payments_account_idx', properties: ['billAccountId', 'status'] })
@Index({ name: 'billing_payments_import_idx', properties: ['importId'] })
export class BillingPayment {
  [OptionalProps]?:
    | 'reference'
    | 'payerName'
    | 'payerAccount'
    | 'importId'
    | 'billAccountId'
    | 'matchReason'
    | 'externalRef'
    | 'topupId'
    | 'metadata'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'received_at', type: 'date', columnType: 'date' })
  receivedAt!: Date

  // Always > 0 (refunds are out of scope).
  @Property({ type: 'numeric', columnType: 'numeric(18, 4)' })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ type: 'text', nullable: true })
  reference?: string | null

  @Property({ name: 'payer_name', type: 'text', nullable: true })
  payerName?: string | null

  @Property({ name: 'payer_account', type: 'text', nullable: true })
  payerAccount?: string | null

  // csv | manual | gateway
  @Property({ type: 'text' })
  source!: string

  @Property({ name: 'import_id', type: 'uuid', nullable: true })
  importId?: string | null

  // Null while unmatched; set by the matcher or "assign account".
  @Property({ name: 'bill_account_id', type: 'uuid', nullable: true })
  billAccountId?: string | null

  // unmatched | matched | partially_allocated | allocated | ignored | converted_to_topup
  @Property({ type: 'text' })
  status!: string

  @Property({ name: 'unallocated_amount', type: 'numeric', columnType: 'numeric(18, 4)' })
  unallocatedAmount!: string

  // no_reference | currency_mismatch | invoice_already_paid | prepaid_account | manual
  @Property({ name: 'match_reason', type: 'text', nullable: true })
  matchReason?: string | null

  // Duplicate guard — sha256 of the row + occurrence index (unique per org).
  @Property({ name: 'source_ref', type: 'text' })
  sourceRef!: string

  // Gateway transaction id (unique per org when set).
  @Property({ name: 'external_ref', type: 'text', nullable: true })
  externalRef?: string | null

  // Set by "convert to top-up" (C-D3).
  @Property({ name: 'topup_id', type: 'uuid', nullable: true })
  topupId?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Source-typed allocation (Spec C, generalised for Spec D credit memos):
// `source_type = 'payment' | 'credit_memo'`, `source_id` → billing_payments
// or billing_invoices. Un-allocate = soft delete (history kept).
@Entity({ tableName: 'billing_allocations' })
// Scope-first like the package's other indexes; every allocation read filters by
// tenant + organization plus the invoice or the source (Migration20261120000000).
@Index({ name: 'billing_allocations_source_idx', properties: ['tenantId', 'organizationId', 'sourceType', 'sourceId'] })
@Index({ name: 'billing_allocations_invoice_idx', properties: ['tenantId', 'organizationId', 'invoiceId'] })
@Index({ name: 'billing_allocations_account_idx', properties: ['tenantId', 'organizationId', 'billAccountId'] })
export class BillingAllocation {
  [OptionalProps]?: 'userId' | 'deallocatedByUserId' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'source_type', type: 'text' })
  sourceType!: string

  @Property({ name: 'source_id', type: 'uuid' })
  sourceId!: string

  @Property({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string

  @Property({ name: 'bill_account_id', type: 'uuid' })
  billAccountId!: string

  @Property({ type: 'numeric', columnType: 'numeric(18, 4)' })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  // auto | credit | user | gateway
  @Property({ name: 'allocated_by', type: 'text' })
  allocatedBy!: string

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'deallocated_by_user_id', type: 'uuid', nullable: true })
  deallocatedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// One CSV upload (C-D4): counts per outcome + row errors.
@Entity({ tableName: 'billing_payment_imports' })
@Index({ name: 'billing_payment_imports_scope_idx', properties: ['tenantId', 'organizationId', 'createdAt'] })
export class BillingPaymentImport {
  [OptionalProps]?: 'userId' | 'counts' | 'errors' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'file_name', type: 'text' })
  fileName!: string

  @Property({ name: 'row_count', type: 'integer' })
  rowCount!: number

  // { allocated, partially_allocated, matched, unmatched, duplicate, rejected }
  @Property({ type: 'jsonb', nullable: true })
  counts?: Record<string, number> | null

  // [{ row, message }] — capped at 200 entries
  @Property({ type: 'jsonb', nullable: true })
  errors?: Array<{ row: number; message: string }> | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
