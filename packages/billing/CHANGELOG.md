# @dainamite/billing

## 0.4.0 — Phase 3 usage rating (unreleased)

- **Usage rater** in `lib/usageRater.ts` — pure functions for all four
  spec-mandated rate shapes:
  - Simple flat (`{ unit_price }`): `quantity × unit_price`.
  - Volume tier (`{ model: 'volume', tiers }`): entire quantity at the
    `unit_price` of the tier its total falls into.
  - Graduated tier (`{ model: 'graduated', tiers }`): per-unit pricing
    by tier, the canonical "metered API" model.
  - Flat tier (`{ model: 'flat', tiers }`): one `flat_amount` for the
    highest tier reached.

  Returns `{ amount, breakdown }` where `breakdown` is the per-tier
  audit trail persisted into `SalesInvoiceLine.metadata
  .usage_tier_breakdown`. Half-up rounding to 2dp on the amount;
  unit prices preserve sub-cent precision via the dedicated
  `formatUnitPrice` helper (e.g. `0.001 → "0.0010"` instead of being
  rounded to zero).

- **Usage runner** in `lib/usageRunner.ts` — per-account processor:
  - Selects unrated usage records (`rated_in_bill_run_id IS NULL`,
    `period_end <= bill_period_end`).
  - Groups by `uom_code`, matches against the account's `type=usage`
    Billing Items (exact match — NO conversion per spec).
  - Aggregates quantity per uom, rates, emits ONE invoice line per
    matched item with the breakdown in metadata.
  - Surfaces `unmatched_usage_uoms` for usage records that have no
    matching Billing Item — operator's `success_with_warnings`
    signal to add the missing item then trigger retry-failed.

- **Engine integration** in `lib/billRunEngine.ts`:
  - Per-cycle loop now combines `buildInvoiceLinesFromItems` (one_time
    + recurring) with `processUsageForAccount` (usage) into a single
    `SalesInvoice` write.
  - Real-mode commits mark consumed usage records'
    `rated_in_bill_run_id` via a single `nativeUpdate` (scales to
    accounts with thousands of records per cycle).
  - `AccountWarnings` now carries `unmatched_usage_uoms` alongside
    `currency_mismatch_items`; both raise the outcome status to
    `success_with_warnings`.
  - `BillRun.summary.usage_records_rated` is populated by summing the
    per-account totals — the spec's required summary key, previously
    a hard-coded zero.

- **Per-record `line_description` itemization** (emitting one invoice
  line per Usage record when `line_description` is set) is
  intentionally deferred to Phase 4 (admin UI iteration). Phase 3
  ships one aggregated line per matched usage item — sufficient for
  correct billing; richer invoice presentation lands when there's a
  UI to show it.

- 27 new unit tests (193 total for the package):
  - `usageRater` covers every spec example end-to-end (`25k vs
    [10k=0, ∞=0.001]` graduated → 15 EUR, `25k vs [10k=0,
    50k=0.001, ∞=0.0005]` volume → 25 EUR, `25k vs
    [10k=50, 50k=200, ∞=1000]` flat → 200 EUR) plus boundary
    conditions and the `1.005 → 1.01` half-up edge case.
  - Engine integration: graduated 25k → 15 EUR end-to-end, unmatched
    UoM warning + un-rated guard, simple-flat unit_price emission,
    test-mode does NOT mark records, mixed recurring + usage line
    aggregation (49.99 + 12.00 = 61.99).

## 0.3.0 — Phase 2 Bill Run engine (unreleased)

- **Bill Run engine** in `lib/billRunEngine.ts` — the heart of the
  module. Handles cron-schedulable + manual triggers, dry-run / test /
  real modes, catch-up looping (manual only), per-tenant Postgres
  advisory lock (Phase 1 primitive), per-account independent
  transactions via savepoint, open-draft anti-duplicate check (queries
  `core/sales` invoices by `metadata->>'bill_period_*'`), item-level
  `billed_to_date` advance on real-mode commit, final summary
  aggregation, and four-way outcome reporting (success /
  success_with_warnings / skipped_existing_draft / failed).
- **Calendar-aware bill-period math** in `lib/billPeriod.ts` — clamps
  month-end edge cases (`Jan 31 + 1 month → Feb 29` in 2024,
  `Mar 31 - 1 month → Feb 28` in 2026) so periods match the spec's
  Postgres-interval semantics exactly. Replaces the naive
  `setUTCMonth(±1)` which overflows.
- **Item selector** in `lib/itemSelector.ts` — predicates the spec's
  "Mid-cycle recurring items" + `billed_to_date` guard rules; emits
  diagnostic skip reasons. `usage` items are routed to the (future)
  Phase 3 rater.
- **Invoice writer** in `lib/invoiceWriter.ts` — creates the
  `core/sales` `SalesInvoice` + `SalesInvoiceLine` rows with the
  spec-mandated `metadata` (`bill_run_id`, `bill_account_id`,
  `bill_period_start`, `bill_period_end`, `test_run`); resolves the
  draft `DictionaryEntry` once per scope and caches it. Per-line
  pricing follows the spec's `BillingItem → InvoiceLine` table:
  `one_time → amount × 1`, `recurring → unit_price × 1`. Half-up
  rounding survives JS floating-point edge cases (`1.005 → 1.01`).
- **Trigger / retry commands** — `billing.runs.trigger` and
  `billing.runs.retry_failed`; lock-busy condition is mapped to
  HTTP 409 with discriminator `code: 'billing.run.lock_busy'`.
- **REST surface**:
  - `GET / POST /api/billing/runs` (list + manual trigger)
  - `POST /api/billing/runs/retry-failed` (re-runs failed accounts
    of a parent run; sets `parent_run_id` on the new run)
  - `GET /api/billing/run-outcomes` (paginated outcomes list,
    filterable by `billRunId` / `billAccountId` / `status`)
- 47 new unit tests (166 total for billing):
  - `billPeriod` calendar math: every cell of the spec's reference
    table + leap-year + chained-advance drift cases.
  - `itemSelector` predicates: every inclusion / skip path.
  - `invoiceWriter.buildInvoiceLinesFromItems`: per-type pricing,
    rounding, negative amounts, malformed rate-shape defense.
  - `billRunEngine` orchestration with thin EM mock: happy path,
    zero-accounts, open-draft skip, dry-run, test-mode, currency
    mismatch warnings, empty-items advance, summary aggregation.

**Deviations from spec** (documented in `xd-249-billing-spec.md`
Phase 2 deviations):

1. `SalesInvoice.invoice_number` is NOT NULL upstream — drafts get a
   real number assigned at draft-create time via
   `salesDocumentNumberGenerator.generate({ kind: 'invoice' })`. The
   spec's "sequence number assigned at Post" intent (gap-free, atomic
   SQL upsert) is preserved; only the timing differs.
2. Test-mode invoices use a `TEST-<timestamp>-<uuid>` placeholder
   number so test runs don't burn production numbers and stay
   idempotent.
3. VAT not computed on drafts — `core/sales` tax service runs at
   POST. Draft totals reflect net amounts only; gross == net.

## 0.2.0 — Phase 1 REST API (unreleased)

- REST API surface for the three integrator-facing resources:
  - `GET / POST / PUT / DELETE /api/billing/accounts` (Billing Accounts CRUD)
  - `GET / POST / PUT / DELETE /api/billing/items` (Billing Items CRUD with
    `source_ref` idempotency on POST — duplicate `(tenant, account,
    sourceRef)` returns the existing row with `deduplicated: true`)
  - `GET / POST /api/billing/usage` (append-only usage ingest; idempotent
    by `source_ref`; no update / delete by design)
- Lean command pattern (no undo / snapshot yet — Phase 4 adds those):
  - `billing.accounts.create / update / delete`
  - `billing.items.create / update / delete`
  - `billing.usage.create`
- New helpers under `lib/`:
  - `withTenantLock(em, { tenantId, lockName }, fn)` — per-tenant
    Postgres transaction-scoped advisory lock; throws
    `TenantLockBusyError` on busy. Used by the Phase 2 Bill Run engine
    to enforce at-most-one concurrent run per tenant.
  - `findBySourceRef(em, Entity, { tenantId, billAccountId, sourceRef })`
    — the single source-ref pre-check helper shared by items and usage.
- Zod CRUD payload schemas added to `data/validators.ts`:
  - `billingAccount(Create|Update|Delete|ListQuery)Schema`
  - `billingItem(Create|Update|Delete|ListQuery)Schema`
  - `billingUsage(Create|ListQuery)Schema`
- 43 new unit tests (119 total for the package).
- Migration not required — Phase 1 uses the existing Phase 0 schema.

## 0.1.0 — Phase 0 scaffold (unreleased)

- Initial workspace scaffold mirroring `@dainamite/cpq`.
- Six billing-owned entities: `BillingAccount`, `BillingItem`,
  `BillingAccountUsage`, `BillRun`, `BillRunOutcome`, `DraftInvoiceEdit`.
- 12 ACL features (`billing.*`) and three default roles
  (`billing.admin` / `billing.finance_user` / `billing.usage_writer`).
- Tenant setup seeds the global UoM dictionary (16 codes), invoice statuses
  (`draft` / `posted` / `paid` / `void`), per-organization invoice sequence
  configs, and the cron schedule defaults.
- Reaper worker stub for stale `BillRun` rows.
