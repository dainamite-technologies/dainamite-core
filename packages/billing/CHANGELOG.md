# @dainamite/billing

## 0.16.0 — admin UI + CRUD API end-to-end fixes (unreleased)

First run of the billing admin against a live database surfaced a set
of bugs in code paths that had only ever been typechecked. All found
and fixed; covered by new Playwright integration tests.

- **List read casing.** The list endpoints (`accounts` / `items` /
  `runs`) project raw column names, so responses are snake_case — but
  the account / item / Bill Run list and detail pages were written
  against camelCase keys, so every non-name column rendered blank and
  the detail edit forms loaded empty. Pages now read the snake_case
  keys the API actually returns (matching the already-correct invoice
  pages); the routes' OpenAPI list-item schemas were camelCase too and
  are corrected to match.
- **Detail pages couldn't read their own id.** OM serves backend
  pages through a catch-all route — the dynamic `[id]` segment arrives
  as a page prop, not via `useParams()`. The four detail pages only
  read `useParams().id`, so they hung on "Loading…" forever. They now
  read `props.params?.id` with `useParams()` as the fallback.
- **`DELETE` returned 500.** The CRUD factory hands a delete action a
  `{ body, query }` envelope as `raw`; the accounts/items delete
  `mapInput` read `raw.id` directly, never found it, and threw
  "id is required". `mapInput` now unwraps the envelope.
- **`?id=` list filter was a no-op.** `GET /api/billing/{accounts,
  items,runs}?id=<uuid>` is how the detail pages fetch one record,
  but `buildFilters` never handled `id`, so the endpoint returned an
  unrelated row. `id` is now an indexed filter on all three list
  routes (and added to the list query schemas).
- **`billing.items.bulk_create` reported empty ids.** The result
  entries captured `item.id` before `em.flush()` assigned the
  DB-generated UUID, so every created/in-batch-deduped entry came back
  with `id: ''`. Ids are now backfilled after the flush. The unit-test
  mock was assigning ids at `create()` time, hiding the bug — it now
  mirrors MikroORM and assigns at `flush()`.

Validation: yarn typecheck + 804 unit tests + 15 Playwright
integration tests (`TC-BILL-001..003`) all green.

## 0.15.0 — detail pages on FormHeader (unreleased)

UI consistency pass against the CPQ module and the Open Mercato core
reference modules. Both render entity detail pages through
`FormHeader` in `detail` mode — a documented non-negotiable ("Detail
uses FormHeader in detail mode"). The billing detail pages had
shipped with an ad-hoc `PageHeader` + custom card header instead.

- **Account / Item / Invoice / Bill Run detail pages** now render
  their header via `FormHeader mode="detail"` — back link, entity
  type label, entity title, status badge and action buttons in the
  framework's standard slots. The page body keeps the field grid /
  totals / edit form / outcomes table unchanged.
- No behaviour change to actions — Post / Wipe / Retry / Soft delete /
  View items / Add item keep their existing handlers, relocated into
  the header's `actionsContent` slot.
- Loading and 404/error states keep their `PageHeader` fallback
  (there is no entity to title yet).

Validation: yarn typecheck + test green; 804 tests, 0 regressions.
UI not exercised in a browser — local PostgreSQL was unavailable so
the dev server could not be started.

## 0.14.0 — i18n locale files (unreleased)

Phase 4c deferred the admin-UI locale files — the pages shipped with
inline English `useT()` fallbacks only. This adds the real
dictionaries so the Billing admin renders in Polish (the target
market) as well as English.

- **`i18n/en.json` + `i18n/pl.json`** — 263 keys covering every
  `t('billing.…')` call across the account / item / invoice / Bill
  Run list, detail, create and form surfaces. The framework's
  generator auto-discovers `src/modules/billing/i18n/<lang>.json`
  and wires them into the module's `translations` map; no manual
  registration needed.
- **Split `billing.items.type.*` into two key sets.** The same key
  was used with two different fallbacks — the list filter wanted the
  short label ("One-time"), the create form wanted the descriptive
  one ("One-time charge"). Since a locale value resolves a key
  globally, the form selector now uses a dedicated
  `billing.items.form.type.*` set; the filter keeps the short
  `billing.items.type.*`.

Validation: yarn generate (i18n imports confirmed in the registry) +
typecheck + test all green; 804 tests, 0 regressions.

## 0.13.0 — Phase 4g — bulk item create (unreleased)

The CPQ connector created Billing Items one command-bus round-trip at
a time — a subscription with N charges meant N account lookups, N
idempotency queries and N flushes. For a multi-line enterprise order
that is N× the work it needs to be. Phase 4g adds a single batched
write path.

- **`billing.items.bulk_create` command.** New command accepting
  `{ tenantId, organizationId, items: [...] }` (1–500 entries). It:
  - validates every referenced account in **one** `id: { $in: [...] }`
    query over the distinct account ids — a missing account throws the
    same `404 { billAccountId }` shape as the single-item command;
  - runs **one** idempotency query over all `source_ref`s in the batch
    (`sourceRef: { $in }` + `billAccountId: { $in }`) instead of one
    per item;
  - dedups `source_ref`s repeated *within* the same payload (first
    wins — the unique index would reject the rest on flush anyway);
  - `em.create` + `persist`s every new row, then issues a **single**
    `em.flush()` for the whole batch;
  - emits per-entity CRUD side effects (`markOrmEntityChange` +
    events) only after the flush commits.
  - Returns `{ created, deduplicated, items: [{ sourceRef, id,
    deduplicated }] }` so callers can map results back to inputs.
- **`POST /api/billing/items/bulk`** — REST surface for the command,
  gated by `billing.item.manage`, `openApi` documented.
- **Validators.** `billingItemBulkEntrySchema` (per-item, no scope,
  full `rate_json` discriminated-union validation) and
  `billingItemBulkCreateSchema` (scoped wrapper, `items` 1–500).
- **CPQ connector switched to bulk.** `activated` / `amended` /
  `renewed` subscribers now make one `bulkCreateItems` call instead
  of an N-item `createItem` loop; `amended` folds its proration
  `one_time` line into the same batch.
- **Fix: detail-page headings silently missing.** The invoice,
  account and Bill Run detail pages passed `title` straight to
  `<Page>` on their main render path. `Page` only spreads
  `HTMLAttributes`, so `title` landed as a `<div title>` tooltip
  instead of an `<h1>` — the heading rendered on the loading/error
  branches but vanished once data arrived. All three now render the
  heading through `<PageHeader>`.

Validation: yarn typecheck + test all green; 804 repo tests
(7 new in `__tests__/commands/itemsBulk.test.ts`), 0 regressions.

## 0.12.0 — Phase 4f — scale audit + bulk refactor (unreleased)

Audit of hot paths against the spec's Performance Considerations
(Shape A: many accounts × few items; Shape B: few accounts × millions
of usage records). Two real OOM risks closed; one UI deep-link added
on the way through.

- **Usage runner: load-all-records → SQL aggregate.** Pre-Phase-4f the
  per-account usage path did `em.find(BillingAccountUsage, {…})` with
  no limit, materialising every row in JS memory before summing. For
  a telco account with 1M usage records per cycle this OOMs. New
  implementation does a single `SELECT uom_code, SUM(quantity),
  COUNT(*) FROM billing_account_usage WHERE … GROUP BY uom_code` —
  result set is `O(distinct uom_codes)` (typically 1-20) regardless
  of record count. Index `(bill_account_id, uom_code,
  rated_in_bill_run_id, period_end)` already exists from Phase 0.
- **Engine rated-marking: id list → predicate update.** The
  follow-up "mark consumed records" step used to take a `consumedUsageIds`
  array and issue `UPDATE … WHERE id IN (millions of UUIDs)`. New
  shape: the runner returns `matchedUoms` (small) and the engine does
  `UPDATE … WHERE uom_code IN (matchedUoms) AND <account scope>
  AND rated_in_bill_run_id IS NULL AND period_end <= ?` — no ID list
  ever leaves Postgres. Memory-bounded regardless of how many records
  the predicate touches.
- **GDPR export: time window + hard cap.** The
  `GET /api/billing/export/account/[id]` endpoint used to do
  unbounded `em.find` against usage / outcomes / invoices —
  pathological for telco accounts with millions of usage rows. Now:
  defaults to the last 12 months (regulator lifetime requests
  override via `?since=1970-01-01&until=...`), every collection
  capped by `EXPORT_HARD_LIMIT = 50_000`, response carries the
  `window: { since, until, hardLimit }` block so the operator
  knows what was sliced. Lifetime dumps for outlier accounts need
  a follow-up chunked NDJSON background job — documented in the
  endpoint's OpenAPI description.
- **Account detail UI: "View items" + "Add item" deep-link** buttons
  that pass `?billAccountId=<id>` to the items list and items create
  pages. Items list pre-fills the filter on mount when the param is
  present.

Engine tests updated to mock the new aggregate path
(`em.execute(SELECT … GROUP BY uom_code)` + `em.nativeUpdate` with
the `uomCode: { $in: [...] }` predicate). All 12 billing test suites
still green (214 cases).

Validation: yarn build + generate + typecheck + test all green; 797
repo tests, 0 regressions.

## 0.11.0 — Phase 4e — item create + edit UI (unreleased)

Billing Item management from the admin closes the last UI gap.
Operators can now hand-create one-off charges (e.g. manual
adjustments, custom proration credits) or inspect what the CPQ
connector created — without dropping to `curl`.

- `components/ItemForm.tsx` — shared form (create + edit). Renders
  account picker (create-only), type selector (create-only,
  immutable on edit per `billingItemUpdateSchema`), bill dates,
  description, **type-discriminated rate fields**:
  - `one_time`: single `amount` input (negative allowed for
    refunds / credits).
  - `recurring`: `unit_price` input.
  - `usage` (simple): `unit_price` + required `uom_code`.
  - `usage` (tiered): raw-JSON textarea for the advanced shape.
    Server validators (Phase 0 Zod) reject malformed structures;
    the textarea includes the canonical example as placeholder.
  Plus optional `subscriptionId` / `subscriptionItemId` external
  references. UX matches `AccountForm` (Cmd/Ctrl+Enter submit, Kbd
  footer hint, no raw HTML buttons).
- `/backend/billing/items` — list with filters (type, account,
  subscription, active) + per-row "Open" link. **New item** CTA in
  the page header.
- `/backend/billing/items/create` — pre-loads the account picker,
  supports `?billAccountId=<id>` deep-link for future "Add item from
  account detail" CTAs. POSTs `/api/billing/items`, navigates to
  detail on success.
- `/backend/billing/items/[id]` — detail + edit. Read-only badges
  at the top surface engine-managed state the operator can't change
  (`currencyMismatch`, `billedToDate`, `sourceRef`). Account ID is
  a deep-link back into `/backend/billing/accounts/[id]`. **Soft
  Delete** button with `ConfirmDialog` gate.

Validation: yarn build + generate + typecheck + test all green;
797 repo tests, 0 regressions; all 10 billing backend pages now
auto-discovered (3 accounts + 3 items + 2 runs + 2 invoices).

Deferred to follow-up:
- Locale files (en, pl) — UI ships with inline English fallbacks.
- "Add item" button on the account detail page (uses the deep-link
  parameter the create page already supports).

## 0.10.0 — Phase 4d — account create + edit UI (unreleased)

Account management from the admin — no more REST-only onboarding.

- `components/AccountForm.tsx` — shared form (create + edit modes).
  Renders 9 scalar fields + 5 `invoiceAddress` sub-fields + an
  `isActive` switch (edit-only). On `mode='edit'`, `customerId` and
  `currencyCode` are disabled with explanatory copy — both fields are
  immutable per `billingAccountUpdateSchema`. UX per OM convention:
  `Cmd/Ctrl + Enter` submits, footer hint via `Kbd` / `KbdShortcut`.
- `/backend/billing/accounts/create` — POSTs `/api/billing/accounts`.
  On success, navigates to the new account's detail page.
- `/backend/billing/accounts/[id]` — loads via `GET /api/billing/accounts?id=<id>`
  (saves a dedicated `[id]` route). Form in edit mode for in-place
  updates via PUT. **Soft Delete** button at the top-right with a
  `ConfirmDialog` gate; on success, navigates back to the list.
- List page (`/backend/billing/accounts`) now has a **New account**
  CTA in the page header + an **Open** row link per account row.
- **Bonus fix**: every existing backend page (`runs`, `runs/[id]`,
  `invoices`, `invoices/[id]`) used `<Page title="…">` which silently
  passed `title` as an HTML attribute (a tooltip), so no visible
  title rendered. All migrated to the proper `PageHeader` wrapper.

Validation: yarn build + generate + typecheck + test all green; 797
repo tests, 0 regressions; all 7 backend pages auto-discovered.

Deferred to follow-up:
- Item create / edit pages (items are typically integration-driven —
  the REST API at `/api/billing/items` covers operator-side needs).
- Locale files (en, pl).

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
