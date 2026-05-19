# @dainamite/billing

## 0.9.0 — Phase 4c v3 — inline line editing (unreleased)

Closes the last operator-UX gap on the draft-review surface — line
edits no longer require `curl`.

- **`components/LineFormDialog.tsx`** — shared add / edit form. Fields:
  description (Textarea), quantity, unit_price_net, and an optional
  `totalNetAmount` override (operator "I know better than
  qty × unit_price" path; pre-shows the computed total as a
  placeholder). UX per OM convention: `Cmd/Ctrl + Enter` submits,
  `Escape` cancels (Radix Dialog handles cancel for free).
  Footer hint row uses `Kbd` / `KbdShortcut` (no raw `<span>`).
- **Per-line row actions** on the detail page (visible only when
  `invoice.status === 'draft'`): Edit (opens the dialog pre-filled
  from the row) and Remove (opens `ConfirmDialog` then calls
  `billing.invoices.remove_draft_line`).
- **"+ Add line" button** next to the Lines header (draft-only).
  Opens the same dialog in `mode='add'`.
- **`ConfirmDialog` replaces `window.confirm`** for both the wipe-
  test-invoices flow and the line-remove flow, satisfying the
  UI AGENTS.md MUST rule.
- All writes go through the existing `billing.invoices.{edit,add,
  remove}_draft_line` commands — every line mutation is still
  audited via `DraftInvoiceEdit` with before/after snapshots, and
  invoice totals are recomputed by the engine on each write.

Validation: yarn build + generate + typecheck + test all green;
797 repo tests, 0 regressions; 6 billing API routes + 5 backend
pages + 1 shared component.

Deferred to follow-up:
- Account / item editor pages
- Locale files (en, pl)

## 0.8.0 — Phase 4c v2 — invoice review UI (unreleased)

The "I want to see and post drafts from the UI" workflow. Closes the
biggest remaining operator UX gap — drafts no longer require `curl`
to review or post.

- `GET /api/billing/invoices` — billing-managed invoices list. Filters
  by `metadata->>'bill_run_id'` presence so non-billing invoices
  (sales orders, etc.) never appear on this surface. Supports
  status / billRunId / billAccountId / testRun / search filters.
- `GET /api/billing/invoices/[id]` — invoice detail with all lines.
  Hand-rolled because the filter predicate (`metadata ? 'bill_run_id'`)
  doesn't map onto `makeCrudRoute`'s where shape, and the entity
  itself is owned by `core/sales`.
- `/backend/billing/invoices` — list page. Shows invoice number with
  TEST tag for `metadata.test_run`, status (draft / posted / paid /
  void), bill-period range, gross total, outstanding amount, issue
  date. Filters on status + test-run inclusion.
- `/backend/billing/invoices/[id]` — detail page. Header card with
  status + period + metadata refs, four-tile totals (subtotal /
  grand total / paid / outstanding), lines DataTable with billing-type
  tag per line (`one_time` / `recurring` / `usage`), operator-added
  flag. Two operator actions:
  - **Post invoice** — visible only for `draft` non-test invoices.
    POSTs `billing.invoices.post`. Refresh on success.
  - **Wipe test invoices for this run** — visible only for
    `metadata.test_run=true`. Hard-deletes every test invoice from
    the same `bill_run_id` via `billing.invoices.wipe_test`. `window
    .confirm` gate (will move to `ConfirmDialog` in a follow-up to
    match the OM UX convention).

Sidebar entry under the `Billing` group at order 30.

Validation: yarn build + generate + typecheck + test all green; 797
repo tests, 0 regressions. 6 billing API routes total now (post,
add-line, edit-line, remove-line, invoices list, invoices detail);
5 backend pages.

Deferred to follow-up:
- Inline line edit / add / remove dialogs on the detail page (REST
  endpoints already exist from Phase 4b).
- ConfirmDialog instead of `window.confirm` for the wipe action.
- Account / item editor pages.

## 0.7.0 — Phase 4c admin UI v1 (unreleased)

Three operator-facing backend pages — the minimum viable shell so
operators can drive billing from the admin without `curl`:

- `/backend/billing/runs` — Bill Runs list. Status / mode tags
  (running / completed / partial_failure / failed + dry-run / test /
  catch-up flags), as-of date, accounts processed / drafts created /
  failed counts, started + finished timestamps. Filter on status +
  triggered-by. Open into detail.
- `/backend/billing/runs/[id]` — Bill Run detail. Header card with
  status badges, full summary (accounts processed / drafts / skipped
  / warnings / failed / usage records rated), "Retry failed accounts
  (N)" button (POSTs `billing.runs.retry_failed`, enabled only when
  N > 0). Outcomes table below: per-account status / draft invoice
  id / error message / warnings JSON.
- `/backend/billing/accounts` — Billing Accounts list. Read-only for
  v1 (CRUD lives at `/api/billing/accounts` — admin edit UI ships
  in a follow-up). Filters on bill cycle / currency / active; search
  on name. Status badges from the shared OM `Tag` primitive
  (`success` / `default`).

Sidebar nav: each page declares `pageGroup: 'Billing'` /
`pageGroupKey: 'billing.nav.group'` so all three appear under one
collapsible Billing group; detail page sets `navHidden: true`.

All i18n keys default to inline English fallbacks (`t('key',
'English')` shape). Locale files ship in a follow-up — operators
running the dev server see correct copy out of the box.

Validation: yarn build + generate + typecheck + test all green;
797 repo tests, 0 regressions; routes registered in
`.mercato/generated/backend-routes.generated.ts`.

Deferred to a follow-up:
- Account / item / usage / draft-invoice editor pages
- Triggers (manual Bill Run / dry-run preview) as buttons in the
  list page
- Locale files (en/pl)

## 0.6.0 — Phase 4b backend slice (unreleased)

Draft-edit audit pipeline + GDPR portability + test-invoice wipe.
The Admin UI half of Phase 4 (backend pages) is intentionally
deferred to its own dedicated effort — every command shipped here is
fully usable from the REST surface today.

- **Three draft-edit commands**, each writing a `DraftInvoiceEdit`
  audit row with the spec's before/after snapshot contract:
  - `billing.invoices.edit_draft_line` — change `description`,
    `quantity`, `unit_price`, or an explicit `totalNetAmount`
    override. Recomputes invoice totals from the surviving lines.
    Audit row carries both `before_json` and `after_json`.
  - `billing.invoices.add_draft_line` — operator-added line (e.g.
    one-off adjustment). `before_json` is `null` per spec.
  - `billing.invoices.remove_draft_line` — hard delete with the
    pre-removal snapshot preserved in `before_json`. `after_json`
    and `invoice_line_id` are `null`.
- All three refuse non-draft invoices with `HTTP 409 +
  billing.invoice.not_draft` and require the
  `billing.invoice.edit_draft` feature.
- **Test-invoice wipe command** `billing.invoices.wipe_test`:
  hard-deletes invoices flagged `metadata.test_run=true`, optionally
  scoped to a single `billRunId`. Test data never pollutes production
  history. Gated by `billing.run.trigger`.
- **GDPR portability endpoint** `GET /api/billing/export/account/[id]`:
  returns a single-account JSON dump covering the account itself,
  every Billing Item, every Usage record, every BillRunOutcome
  referencing the account, every emitted `core/sales` invoice
  (matched via `metadata`), and every `DraftInvoiceEdit` audit row
  for those invoices. Tenant- + organization-scoped via the caller's
  auth — 404 for cross-tenant UUIDs.
- New REST routes:
  - `POST /api/billing/invoices/edit-line`
  - `POST /api/billing/invoices/add-line`
  - `POST /api/billing/invoices/remove-line`
  - `POST /api/billing/test-invoices/wipe`
  - `GET /api/billing/export/account/[id]`
- 15 new unit tests covering the command contract: non-draft
  refusal, audit row before/after population, totals recompute
  (unit_price × quantity + explicit override path), null
  invoice/line resolution, wipe scope safety (with vs without
  `billRunId`).

Deferred to **Phase 4c** (UI dedicated effort):
- Backend pages (DataTable + CrudForm) for accounts / items / usage /
  bill runs / draft invoice review.
- Sidebar navigation + page metadata.

## 0.5.0 — Phase 4a posting + payment subscriber (unreleased)

- **Post invoice command** `billing.invoices.post`:
  - Asserts the invoice is currently `draft` (refuses with HTTP 409 +
    `billing.invoice.not_draft` otherwise).
  - Refuses test-mode invoices (`metadata.test_run=true`) with HTTP
    409 + `billing.invoice.test_run` — operators wipe test drafts
    through a dedicated endpoint (Phase 4b), never by posting them.
  - Resolves the `posted` `DictionaryEntry` once via the shared
    cache, flips `status` + `status_entry_id`.
  - Emits `billing.invoice.posted` once + one
    `billing.invoice.line_posted` per line. Events carry the
    spec-mandated traceability payload (`billRunId`, `billAccountId`,
    `billPeriodStart` / `End`, line metadata).
  - Invoice number is **not** re-assigned at post (Phase 2 deviation:
    `SalesInvoice.invoice_number` is `NOT NULL` upstream → numbers
    are issued at draft-create via `salesDocumentNumberGenerator`).
- **Post API route** `POST /api/billing/invoices/post`. RBAC-gated by
  the new `billing.invoice.post` feature (already declared in
  `acl.ts` since Phase 0). Returns
  `{ invoiceId, invoiceNumber, status: 'posted', lineCount }`.
- **Payment-captured subscriber**
  `subscribers/payment-captured-to-paid.ts`:
  - Listens to `payment_gateways.payment.captured` (the actual
    upstream event — the spec's `payments.payment.completed` doesn't
    exist; this resolves the Phase 0-flagged deviation #2).
  - Matches `payload.paymentId` against `SalesInvoice.id` scoped by
    tenant + organization. Foreign payments (non-billing invoices) →
    silent no-op. Idempotent re-fire on already-paid invoices.
  - Sets `paidTotalAmount = grand_total_gross`, `outstanding = 0`,
    `status = 'paid'`, `status_entry_id = <paid entry>`.
- **Shared invoice-status resolver** in `lib/invoiceStatus.ts` —
  factored out of `invoiceWriter`'s previously-private cache so the
  draft/posted/paid lookups share one chokepoint. Per-tenant +
  per-status cache.
- 6 new unit tests for the resolver (199 total for billing).

Deferred to **Phase 4b**:
- Draft-edit endpoint + `DraftInvoiceEdit` audit row writing.
- GDPR-portability `GET /api/billing/export/account/{id}`.
- Admin UI (backend pages for accounts / items / runs / draft review).

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
