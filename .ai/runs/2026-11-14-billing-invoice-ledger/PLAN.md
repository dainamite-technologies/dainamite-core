# Execution plan — Standalone invoice ledger: decouple billing from core sales (Spec 0)

Source spec: .ai/specs/2026-11-14-billing-standalone-invoice-ledger.md (decisions E-D1..E-D3, umbrella D14, D19)
Base branch: feat/billing-account-workspace (Spec E Phase 1 + Spec A)
Branch: feat/billing-invoice-ledger
Packages: `@dainamite/billing` (breaking, released with the 0.21.0 batch)

## Relationship to Spec D (credit / debit memos)

Spec D is **not merged** into this plan. Spec 0 lays **all of Spec D's data groundwork**, so Spec D becomes behaviour-only:

| Spec D needs | Delivered here |
|---|---|
| Memos as billing documents | `billing_invoices.document_type` (`invoice \| credit_memo \| debit_memo \| receipt`) |
| Reference + reason | `corrects_invoice_id`, `correction_reason` columns (indexed) |
| Own numbering series | `BillingDocumentSequence` with an `invoice`, `credit_memo` and `receipt` series |
| `credited` status, no void | Status enum `draft \| posted \| partially_paid \| paid \| credited` (no `void`) |
| Credit settlement amount | `credited_total` column |

What keeps Spec D separate: it settles credit memos through **allocations** (Spec C) and copies **VAT per line from item tax rates** (Spec B). Pulling D in here would drag in large parts of B and C. Order stays **0 → B → C → D**.

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | `lib/vat.ts` (pure) + parity tests | done |
| 1 | 1.2 | Entities: `BillingInvoice`, `BillingInvoiceLine`, `BillingDocumentSequence`, `BillingSettings` + hand-written migration + entity ids/registry | done |
| 1 | 1.3 | Validators: document types, statuses, series, settings, invoice list query | done |
| 1 | 1.4 | `lib/numbering.ts`: gap-free series claim + format tokens | done |
| 1 | 1.5 | `lib/billingSettings.ts`: per-org settings (lazy defaults) | done |
| 2 | 2.1 | Invoice writer → billing tables (DRAFT-/TEST- numbers, columns instead of metadata) | done |
| 2 | 2.2 | Engine dedupe → column query + unique-index backstop | done |
| 2 | 2.3 | Post command: real number at post, buyer/seller snapshots, outstanding | done |
| 2 | 2.4 | Draft line add/edit/remove + edit audit + test-invoice wipe | done |
| 2 | 2.5 | `accountStatus` outstanding + payment-captured subscriber on billing tables | done |
| 2 | 2.6 | Unit tests: writer, engine, post/lines commands (delete `invoiceStatus` tests) | done (invoiceStatus.ts removed in 3.1) |
| 3 | 3.1 | Top-up receipts as `document_type = receipt` (E-D3) | done |
| 3 | 3.2 | Prepaid config → `BillingSettings` (E-D2); `setup.ts` stops seeding configs + invoice-status dictionary | done |
| 4 | 4.1 | Optional payment gateway (E-D1) | done |
| 4 | 4.2 | Trim `requires`; isolation guard forbids `sales` / `configs` / `dictionaries` imports | done |
| 5 | 5.1 | Invoice list + detail API on billing tables (new field names) | done |
| 5 | 5.2 | Run outcomes, account export, top-up receipt link | done |
| 5 | 5.3 | UI: invoices list/detail field map, top-up pages, prepaid "Top up" visibility | done |
| 5 | 5.4 | Billing settings page (minimal: prepaid defaults + number formats) | done |
| 6 | 6.1 | Integration tests: adapt TC-BILL-001..005, add TC-BILL-006 | done |
| 6 | 6.2 | Docs: MIGRATION.md field map, changeset, xd-249 erratum, manuals, Spec B amendment | done |
| 6 | 6.3 | Gate: build:packages, generate, typecheck ×3, test, build | done |

## Goal

After this branch no billing code reads or writes core `sales`, `configs` or `dictionaries` (`payment_gateways` becomes optional). Billing invoices, receipts and their numbering live in billing tables. Behaviour visible to operators is unchanged, except:
- real drafts show `DRAFT-…` until posted;
- the invoice number is assigned at post;
- billing invoices no longer appear in core Sales screens.

## Non-goals

- VAT from item tax rates, due dates, PDF, email (Spec B). Lines keep `tax_rate = 0` as today. Only receipts use a rate (the prepaid top-up rate).
- Allocations / partial payments (Spec C). Memos (Spec D).
- Migrating existing `sales_invoices` billing rows (D14: reseed; old rows are left orphaned and untouched).
- Applying migrations without confirmation.

## Decisions (2026-11-14)

| # | Decision |
|---|---|
| P-D1 | Drop the unused `billing.uom` dictionary seed → billing no longer requires `dictionaries` ("at least for now"; re-add if a UoM picker is built). |
| P-D2 | A minimal **Billing settings** page ships here (prepaid defaults + number masks). Spec B extends it with seller/PDF fields. |
| P-D3 | **Number masks with scoped sequence tokens** (below). The mask decides when the counter resets. |

### Number mask (P-D3)

A mask is free text with tokens. Exactly **one** sequence token is required.

| Token | Meaning |
|---|---|
| `{YYYY}` / `{YY}` | Year of the issue date (4 / 2 digits) |
| `{MM}` / `{DD}` | Month / day of the issue date (2 digits) |
| `{SEQUENCE_NUM}` | Counter **never resets** (one sequence per series) |
| `{SEQUENCE_NUM_YEAR}` | Counter **resets every year** (one sequence per series + year) |
| `{SEQUENCE_NUM_MONTH}` | Counter **resets every month** (one sequence per series + year-month) |
| `…:N` suffix, e.g. `{SEQUENCE_NUM_MONTH:4}` | Zero-pad to N digits (optional, default none) |

Validation rules on save:
- exactly one sequence token;
- `{SEQUENCE_NUM_YEAR}` requires `{YYYY}` or `{YY}`, and `{SEQUENCE_NUM_MONTH}` requires a year token **and** `{MM}`. Otherwise two periods would produce the same number;
- only known tokens; length ≤ 64.

Defaults (Polish practice): `INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`, `CN/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`, `RC/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`. Example: `INV/2026/11/0001`.

Changing a mask mid-period starts a new sequence scope. A collision with an already issued number is impossible because the unique `(org, number)` index rejects it. The settings page shows a live preview of the next number and warns when the new mask could repeat numbers already issued this period.

---

## Step details

### 1.1 `lib/vat.ts` (pure)
- `lineAmountsFromNet(net, ratePercent) → { net, tax, gross }` and `lineAmountsFromGross(gross, ratePercent) → { net, tax, gross }`. Half-up 2 dp on tax, with `net + tax = gross` exactly (the remainder goes to tax on the gross path).
- `sumTotals(lines) → { subtotalNet, taxTotal, totalGross }` as 4 dp strings (column format).
- Tests: rate 0, 23, 8, 5. 1.005-style edges. Negative (credit) amounts. **Parity:** the gross split matches `DefaultTaxCalculationService.calculateUnitAmounts({ mode: 'gross' })` on a table of representative amounts (the core service is imported in the test only, so the isolation guard is unaffected).

### 1.2 Entities + migration
All entities have standard columns, FK **string** ids, and no ORM relations (enforced by `package-isolation.test.ts`, which forbids all ORM relation decorators in billing; the spec's "ORM relation allowed" note is overridden by that guard).

- **`BillingInvoice` → `billing_invoices`**: the columns in the spec's table. `document_type` (default `invoice`), `number`, `series` (null until posted), `status` (default `draft`), `test_run`, `bill_run_id`, `bill_date`, `period_start/end`, `issue_date`, `due_date`, `currency_code`, `subtotal_net`, `tax_total`, `total_gross`, `paid_total`, `credited_total`, `outstanding`, `corrects_invoice_id`, `correction_reason`, `buyer_snapshot`, `seller_snapshot`, `pdf_attachment_id`, `topup_id`, `posted_at`, `metadata`.
- **`BillingInvoiceLine` → `billing_invoice_lines`**: `invoice_id`, `line_number`, `billing_item_id?`, `billing_type` (`one_time|recurring|usage|manual|receipt`), `description`, `quantity`, `unit_price_net`, `tax_rate`, `net_amount`, `tax_amount`, `gross_amount`, `service_period_start/end?`, `corrects_line_id?`, `metadata`.
- **`BillingDocumentSequence` → `billing_document_sequences`**: unique `(tenant_id, organization_id, series, scope_key)`. `scope_key` = `''` (`{SEQUENCE_NUM}`), `'2026'` (`{SEQUENCE_NUM_YEAR}`) or `'2026-11'` (`{SEQUENCE_NUM_MONTH}`), derived from the mask + issue date. Also `next_value` (bigint, default 1). The mask itself lives in settings.
- **`BillingSettings` → `billing_settings`**: one row per org (unique `(tenant_id, organization_id)` where not deleted). Prepaid fields:
  - `low_balance_threshold_default` (numeric, '0')
  - `near_limit_buffer_default` (numeric, '0')
  - `statement_enabled` (bool, true)
  - `topup_tax_rate` (numeric, 0)
  - `topup_provider` (text, `'stripe'`)
  - `number_masks` (jsonb `{ invoice, credit_memo, receipt }`, P-D3 defaults)

  Spec B adds the seller/PDF columns later.
- **Indexes:**
  - `billing_invoices`:
    - `(tenant_id, organization_id, status)`
    - `(bill_account_id, status, due_date)`
    - `(bill_run_id)`
    - `(corrects_invoice_id)`
    - `(topup_id)`
    - **partial unique** `(tenant_id, organization_id, bill_account_id, bill_date, test_run) where document_type = 'invoice' and deleted_at is null and bill_date is not null` (the Spec A dedupe backstop)
    - **partial unique** `(tenant_id, organization_id, number) where series is not null`
  - `billing_invoice_lines`: `(invoice_id, line_number)`.
- `Migration20261115000000_billing_invoice_ledger.ts`, hand-written (partial indexes can't be expressed in decorators, and the generator skips package modules). It includes `down`.
- `data/entityIds.ts` (+4 ids), `node scripts/generate-entity-registry.mjs`, `entityRegistry.test.ts` expectations. These are needed so the query-index subscriber accepts the new entities' CRUD events.
- `BillingDraftInvoiceEdit.invoice_id` / `invoice_line_id` now refer to billing tables. No schema change; the comments are updated.

### 1.3 Validators
- `DOCUMENT_TYPES`, `INVOICE_STATUSES = ['draft','posted','partially_paid','paid','credited']` (`void` removed), `DOCUMENT_SERIES = ['invoice','credit_memo','receipt']`.
- `billingSettingsUpdateSchema` (all optional). `number_masks` are validated by `lib/numbering.validateMask` (P-D3 rules).
- `billingInvoiceListQuerySchema`: `status`, `documentType`, `billRunId`, `billAccountId`, `testRun`, `search` (number), pagination ≤ 100.
- Tests.

### 1.4 `lib/numbering.ts`
- **Pure:**
  - `parseMask(mask)` → `{ sequenceToken: 'none'|'year'|'month', pad, tokens }`;
  - `validateMask(mask)` → error codes (P-D3 rules);
  - `sequenceScopeKey(mask, issueDate)` → `''` / `'YYYY'` / `'YYYY-MM'`;
  - `renderNumber(mask, { seq, issueDate })`.
  - All tested: every token, padding, invalid masks, scope keys across year/month boundaries.
- **DB:** `claimDocumentNumber(em, scope, series, issueDate)` reads the mask from settings, then runs `INSERT … (series, scope_key, next_value) VALUES (…, 2) ON CONFLICT (tenant_id, organization_id, series, scope_key) DO UPDATE SET next_value = billing_document_sequences.next_value + 1 RETURNING next_value - 1 AS seq` and renders the number. It runs inside the caller's transaction, so a rollback releases the number (gap-free) and concurrent posts serialize on the row.
- `draftNumber()` → `DRAFT-<8 hex>`. `testNumber()` → existing `TEST-…`.

### 1.5 `lib/billingSettings.ts`
`getBillingSettings(em, scope)` finds or lazily creates the row with defaults (race-safe upsert). It replaces every `readConfig` call. Pure `resolve*` helpers keep today's default semantics.

### 2.1 Writer (`lib/invoiceWriter.ts`)
- `writeDraftInvoice` creates a `BillingInvoice` with:
  - `document_type = invoice`, `status = draft`;
  - `number` = `DRAFT-…` (real) or `TEST-…` (test). **No sequence is consumed at draft time** (this delivers Spec B's B-D4 here);
  - `bill_account_id`, `bill_run_id`, `bill_date`, `period_*` and `test_run` as columns;
  - totals via `vat.sumTotals` (rate 0 for now).

  Lines become `BillingInvoiceLine`s, with service periods as columns and proration / credit / usage breakdown kept in line `metadata`.
- The container is no longer needed for numbering, so the signature drops `container`.
- `buildRecurringLineDescriptors` / `displayPeriod` are unchanged.

### 2.2 Engine dedupe
- `findExistingDraftForBillDate` becomes `em.findOne(BillingInvoice, { tenantId, organizationId, billAccountId, billDate, testRun, documentType: 'invoice', deletedAt: null })`. It matches **any status**: a posted invoice for the same bill date also blocks re-billing, for example after an operator moves `next_bill_date` back.
- The unique index is the backstop. A unique-violation on insert maps to `skipped_existing` (real stops, test continues), same as Spec A semantics.
- Engine test mock: dedupe reads via `findOne(BillingInvoice)` instead of `execute`. The fixtures are adapted.

### 2.3 Post command (`commands/invoices.ts`)
In one atomic flush:
1. Guard: `draft`, not `test_run`.
2. `claimDocumentNumber(series='invoice')` → `number`, `series`, `issue_date = today`, `posted_at`.
3. `buyer_snapshot` comes from the account (name, customer id/kind, invoice address, tax id, invoice email, language). `seller_snapshot` comes from settings (`{}` until Spec B adds seller fields).
4. `status = posted`, `paid_total = 0`, `outstanding = total_gross`.

Then (after commit) emit `billing.invoice.posted` (payload keeps `invoiceNumber`) and `billing.invoice.line_posted`. The post-time credit-crossing events stay.

### 2.4 Draft line commands + wipe
- Add / edit / remove line on `BillingInvoiceLine` (draft only). Recompute line and invoice totals with `vat.ts`. `BillingDraftInvoiceEdit` audit unchanged.
- `wipeTestInvoicesCommand` + route: hard-delete `billing_invoice_lines` + `billing_invoices` where `test_run` (optionally scoped by `billRunId`). The `TEST-%` fallback filter is no longer needed.

### 2.5 Outstanding + payment subscriber
- `accountStatus.getPostpaidOutstanding` becomes `SUM(outstanding) FROM billing_invoices WHERE status IN ('posted','partially_paid') AND document_type IN ('invoice','debit_memo') AND NOT test_run`.
- `payment-captured-to-paid`: `BillingInvoice` by `id = paymentId`. When posted: `paid_total = total_gross`, `outstanding = 0`, `status = paid`. Idempotent. *(Spec C replaces this with an allocation.)*

### 2.6 Tests
Writer (draft numbers, columns, totals), engine (dedupe on billing tables, unique-violation backstop), post (number claimed once, snapshots, a rollback doesn't burn a number with a mocked failure), line commands, wipe. Delete `invoiceStatus.test.ts` and `lib/invoiceStatus.ts`.

### 3.1 Top-up receipts (E-D3)
`lib/topupReceipt.ts`:
- `BillingInvoice{ document_type: 'receipt', series: 'receipt', number: claim('receipt'), status: 'paid', topup_id, issue_date, posted_at, paid_total = outstanding... }` with `outstanding = 0` and `paid_total = total_gross`;
- one `BillingInvoiceLine{ billing_type: 'receipt' }`;
- the VAT split goes through `vat.lineAmountsFromGross`.

`topupCapture` dependencies shrink to `{ em }` (no core number generator or tax service). `prepaid-topup-captured` stops resolving core services. Topup capture tests are updated (receipt number from the `RC/` series, parity of the VAT split).

### 3.2 Prepaid config → settings (E-D2)
- `lib/prepaidConfig.ts` reads `getBillingSettings(em, scope)`. Every getter gains a `scope` parameter. Callers to update: `prepaidPeriodClose`, `prepaidConsume`, `balanceStatus`, `topupCapture`, `commands/topups`, `creditStatus` users, `accountStatus`, and the reconcile worker (`grep getLowBalanceThresholdDefault|getNearLimitBufferDefault|getStatementEnabled|getTopupTaxRate|getTopupProvider`).
- `setup.ts`: remove `ModuleConfig` seeding and the `sales.invoice_status` dictionary. Remove the `billing.uom` dictionary (P-D1). Seed a `BillingSettings` row per org on tenant init (defaults = today's config defaults).

### 4.1 Optional gateway (E-D1)
- `commands/topups.ts`: `container.hasRegistration('paymentGatewayService')`. If it's absent, throw `CrudHttpError(501, { code: 'billing.topup.gateway_unavailable' })`. The gateway type becomes a **local structural type** (no deep import into `payment_gateways`).
- The gateway-event subscribers (`payment-captured-to-paid`, `prepaid-topup-*`) subscribe by event name only and use local payload types. They are inert when the module is absent.
- `GET /api/billing/settings` → `capabilities: { gatewayTopups: boolean }` for the UI.

### 4.2 `requires` + isolation guard
- `index.ts`: `requires: ['auth', 'directory']` (P-D1: no `dictionaries`).
- `package-isolation.test.ts`: a new test fails on any non-test import of `@open-mercato/core/modules/(sales|configs|dictionaries|payment_gateways)`. `@open-mercato/core` stays a peer (auth, directory, attachments later).

### 5.1 Invoice API
- `GET /api/billing/invoices` becomes a CRUD-factory list over `BillingInvoice` (filters on real columns: status, documentType, billRunId, billAccountId, testRun, number search). The response fields use **billing names**: `number`, `document_type`, `status`, `bill_account_id`, `bill_run_id`, `bill_date`, `period_start/end`, `issue_date`, `due_date`, `subtotal_net`, `tax_total`, `total_gross`, `paid_total`, `outstanding`, `test_run`, `created_at`. `bill_account_name` / `bill_run_name` come via `afterList` batched lookups.
- `GET /api/billing/invoices/[id]`: the invoice + lines + edit audit from billing tables.
- `openApi` on both, with the field map documented.

### 5.2 Other readers
`run-outcomes` (invoice numbers from `billing_invoices`), `export/account/[id]` (billing tables, renamed fields), `topups` routes (the receipt link stays `receipt_invoice_id` → billing invoice).

### 5.3 UI
- `backend/billing/invoices/page.tsx` + `[id]/page.tsx`: field map (`invoice_number` → `number`, `grand_total_gross_amount` → `total_gross`, `metadata.bill_*` → columns). Status filter loses `void` and gains `partially_paid` / `credited`. Add a document-type filter (`invoice` / `receipt`; memo types come with Spec D).
- Top-up detail: the receipt link resolves to the billing invoice detail.
- `PrepaidPanel`: hide "Top up" when `capabilities.gatewayTopups` is false.
- Spec E Phase 1 / Spec A tables need no change (they consume ids).

### 5.4 Billing settings page (P-D2)
- `backend/billing/settings/page.tsx` with `pageContext: 'settings'`, `navHidden: true`, lucide icon:
  - prepaid defaults;
  - number masks per series (token help, live preview of the next number via `GET /api/billing/settings/number-preview?series=`, and a warning when switching scope mid-period);
  - read-only gateway capability.
- `GET/PUT /api/billing/settings` (current org) with `openApi`.
- ACL `billing.settings.view` / `billing.settings.manage`, granted in `setup.ts`.

### 6.1 Integration tests
- **TC-BILL-001..005 adapt:** field names in invoice assertions, plus the TEST-draft wipe route.
- **TC-BILL-006 (new):**
  1. real run for a fresh account → draft `DRAFT-…`;
  2. post → `INV/YYYY/MM/NNNN` (default mask), status `posted`, outstanding = gross. A second posted draft gets the next number;
  3. a second post of the same draft → 409;
  4. `GET /api/sales/invoices` does **not** list it;
  5. top-up receipt numbering is covered by unit tests (it needs a gateway).

### 6.2 Docs
- `packages/billing/MIGRATION.md`:
  - full field map old → new;
  - reseed note: old billing rows in `sales_invoices` are orphaned and can be deleted manually;
  - `DRAFT-` numbering;
  - removed `requires`.
- Changeset: billing **minor (breaking)**. The invoice API field names change; `void` status removed; `requires` trimmed.
- `specs/implementation/xd-249-billing-spec.md`: erratum banner ("invoices are billing-owned since 0.21.0, see Spec 0").
- Manuals: `billing-ui-testing.md` §3 (numbers `DRAFT-` until post, settings page) and `cpq-billing-end-to-end.md` (invoices no longer in core Sales).
- Spec B: mark B-D4 (numbering) as delivered by Spec 0. Spec 0 Implementation Status.

### 6.3 Gate
`yarn build:packages`, `yarn generate`, typecheck (billing, connector, app), `yarn test`, `yarn build`. Migration generated, **not applied** without confirmation.

---

## Risks

| Risk | Mitigation |
|---|---|
| Biggest refactor so far: every invoice path changes | Phased order (foundations → writer/engine → prepaid → API/UI). Existing engine/command suites adapted first, then extended. Isolation guard locks the result. |
| Breaking invoice API field names for external consumers | None in repo (connector reads items only). Field map in MIGRATION.md + changeset. Released together in 0.21.0. |
| Number sequence contention / gaps | Single-statement upsert inside the post transaction: concurrent posts serialize on the sequence row and a rollback releases the number. Unit-tested. |
| Mask change repeats a number within a period | Unique `(org, number)` index rejects it (post fails with 409 `billing.invoice.number_conflict`). The settings page warns before saving. |
| Prepaid config scope change (tenant-wide → per org) | Defaults are identical. Getters take scope, so a missed caller fails typecheck, not at runtime. |
| Orphaned billing rows in `sales_invoices` after upgrade | D14 reseed. A documented manual cleanup query. |
| VAT split drift on receipts | Parity tests against the core service outputs. |
| `requires` trim breaks module load if something still deep-imports | The isolation guard test fails the build first. |

## Completion notes (2026-11-14)
- All phases done. Gate green: build:packages, generate, typecheck (billing, connector, app), 1420 unit tests, `yarn build`.
- Not run: TC-BILL-004/005/006 integration tests (need the Spec E/A/0 migrations applied — awaiting confirmation).
- Deviations: invoice list/detail stay hand-written SQL (engine-written documents have no query-index entries, so the CRUD factory list would not see them); settings page lives at `/backend/config/billing` (framework settings convention, like core sales).
