# Execution plan — Operator feedback round 1 + account workspace (Spec F)

Source spec: .ai/specs/2026-11-15-billing-operator-feedback.md (F-D1..F-D5; supersedes Spec A's A-D1 for prepaid; delivers Spec E Phases 2–3)
Base branch: feat/billing-account-workspace (Specs E1 + A + 0 + B + C + D, uncommitted C/D work on top of c8a1bf7)
Packages: `@dainamite/billing` (minor)

## Resume protocol (read first when continuing)

Work top-down through the task table. After each step: update its status here (`todo → done`), keep the code compiling (`cd packages/billing && yarn typecheck`) and the billing suite green (`npx jest --config jest.config.cjs packages/billing` from repo root). Never commit (the user commits). Never apply migrations without asking (step 6.1 asks). Hand-written migrations only (package modules are not diffed by `yarn mercato db generate`). Update the module snapshot in the same step.

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | F6: settings page visible in the Settings sidebar (`navHidden` removed), header links, post-guard link, `AGENTS.md` rule corrected | done |
| 1 | 1.2 | F7: number-mask help (bare tokens + `:N` row) and live next-number preview | done |
| 1 | 1.3 | F2: currency suffix on ItemForm money inputs (create: selected account; edit: `accountCurrency` prop) | done |
| 2 | 2.1 | Wipe command also deletes `billing_draft_invoice_edits`; shared `lib/testRunCleanup.ts` | done |
| 2 | 2.2 | Command `billing.runs.delete` + ACL `billing.run.delete` + event `billing.run.deleted` + unit tests | done |
| 2 | 2.3 | API `DELETE /api/billing/runs/{id}` (route file `api/runs/[id]/route.ts`), `GET /api/billing/runs` `mode` filter, OpenAPI | done |
| 2 | 2.4 | UI: run detail Wipe / Delete actions, runs list row action + Mode filter, invoice page wipe removed + "Test run" tag | done |
| 3 | 3.1 | Migration `Migration20261119000000_billing_operator_feedback` (item `price_basis`, settings `prepaid_tax_point`, statement `vat_summary`) + entities | done |
| 3 | 3.2 | Validators: `priceBasis`, tiered + gross guard, `prepaidTaxPoint`; item / settings API + OpenAPI | done |
| 3 | 3.3 | `lib/lineAmounts.ts`: basis-aware line VAT; descriptors carry `priceBasis`; writer, dry / test previews, manual lines use it | done |
| 3 | 3.4 | Unit tests: gross round-trip, proration on a gross basis, quantity > 1, net regression | done |
| 3 | 3.5 | ItemForm NET / GROSS switch + live counterpart; item list / detail basis tag; demo seed gross item | done |
| 4 | 4.1 | F4: reproduce the prepaid catch-up stop (DB-backed integration test TC-BILL-011a; operator re-run if not reproduced) | done |
| 4 | 4.2 | F4: root-cause fix + date normalisation helpers (`lib/dateOnly.ts`) in prepaid close and engine | done |
| 4 | 4.3 | Prepaid outcome `cycles` + `skipped_items`; run detail renders them for prepaid | done |
| 4 | 4.4 | F4b: prepaid close on `computeRecurringLines` (timing, proration, credits), one-time at first bill date ≥ start, new `source_ref` | done |
| 4 | 4.5 | F4b: multi-cycle test / dry for prepaid (in-memory `next_bill_date`, watermarks, running balance) | done |
| 4 | 4.6 | F5: `lib/prepaidTaxPoint.ts` `resolvePrepaidDebit` used by period close + `prepaidConsume`; transaction metadata; receipt rate 0 in `consumption` | done |
| 4 | 4.7 | F5: statement `vat_summary` + statement detail / PDF section; settings radio + warning; ItemForm VAT disabled for prepaid in `topup` mode | done |
| 4 | 4.8 | Unit tests for 4.2–4.7 (operator scenario, advance / arrears, timing switch, proration, both tax-point modes, mode switch forward-only) | done |
| 5 | 5.1 | Account "Run billing" dialog + inline outcome (cycles, documents, skipped items, Wipe / Delete for test runs) | done |
| 5 | 5.2 | Summary endpoint: prepaid fields + `next_bill_date`; header cards component | done |
| 5 | 5.3 | Tabs shell (`?tab=`, lazy) — move Items, Usage, Invoices, Payments, Prepaid panel, Statements; Overview tab; navigation `returnTo` with tab | done |
| 5 | 5.4 | Bill runs tab (account-scoped outcomes; `GET /api/billing/run-outcomes?billAccountId=`) | done |
| 5 | 5.5 | Account list `balance_due`, `overdue_amount` (batched aggregate) + `hasOverdue` filter | done |
| 5 | 5.6 | i18n en / pl for phases 1–5 | done |
| 6 | 6.1 | Ask, then apply migrations locally; run TC-BILL-004/005/006/009/010 and fix | todo |
| 6 | 6.2 | New integration tests TC-BILL-011 (prepaid), TC-BILL-012 (delete test run), TC-BILL-013 (gross item → invoice) | done (written, not run) |
| 6 | 6.3 | Docs: manual (prepaid both modes, delete run, NET / GROSS, settings location, workspace), MIGRATION.md, changeset, CHANGELOG, Spec E + umbrella status | done (CHANGELOG comes from the changeset at release) |
| 6 | 6.4 | Gate: build:packages, generate, typecheck ×3, test, build | partial — packages, generate, typecheck ×3, 1623 tests green; app build pending (dev server) |

## Goal

The operator can clean up test runs from the run page. Item prices can be entered net or gross with the currency visible, and the invoice reproduces the typed gross exactly. Prepaid accounts bill every due cycle in one run, honour in-advance / in-arrears and proration, and charge VAT exactly once at the org's chosen tax point. Seller settings are findable. The Billing Account page becomes the tabbed workspace from Spec E.

## Non-goals

- Deleting real runs. Undo for run deletion (scratch data, hard delete).
- Gross basis for tiered usage rates.
- A fiscal VAT invoice for prepaid consumption in `consumption` mode (follow-up, spec R1).
- Recomputing past receipts or debits after a tax-point switch.
- Dunning, bank formats, `catchUp` removal (separate, by decision).

## Decisions (from spec + this plan)

| # | Decision |
|---|---|
| P-D1 | One cleanup routine, `deleteTestRunArtifacts(tem, { tenantId, organizationId, billRunId? })` in `lib/testRunCleanup.ts`. It deletes test invoices (`test_run = true`, `document_type = 'invoice'`), their lines and their `billing_draft_invoice_edits` rows by `invoice_id`, and returns the count. The wipe command and the delete-run command both call it. |
| P-D2 | `billing.runs.delete` runs in one `em.transactional`: guard (scope, `dry_run OR test_mode`, `status <> 'running'`) → cleanup (P-D1) → `UPDATE billing_runs SET parent_run_id = null WHERE parent_run_id = ?` → delete outcomes → delete run. Event `billing.run.deleted` is emitted after commit. 404 for another org's run (no existence leak). |
| P-D3 | Basis-aware line VAT has one entry point: `lineVat({ amount, priceBasis, taxRate })` in `lib/lineAmounts.ts`, which returns `VatAmounts`. `InvoiceLineDescriptor` gains `priceBasis` and renames `totalNetAmount` → `lineAmount` (meaning: the extended amount on the item's basis). The writer, the dry / test preview builders, manual draft lines (always `net`) and the prepaid debit resolver call `lineVat`. Persisted invoice lines are unchanged (net / tax / gross). |
| P-D4 | Usage lines are always `net` basis (tiered guard + simple usage). The validator rejects `priceBasis = 'gross'` with a tiered `rate_json` (422 `billing.item.gross_tiered_unsupported`). Simple usage `gross` is allowed and handled by `lineVat`. |
| P-D5 | Dates: every date-only value the prepaid close and engine compare or query goes through `lib/dateOnly.ts` (`toIsoDate(value)`, `fromIsoDate(iso)` = UTC midnight). `date`-column query parameters are passed as `YYYY-MM-DD` strings, not `Date`, so the `pg` time-zone serialisation can't shift them. `next_bill_date`, `last_bill_date` and `billed_to_date` are written as ISO strings. |
| P-D6 | Prepaid `CycleRecord` reuses the postpaid shape with `status: 'charged' \| 'previewed' \| 'empty' \| 'skipped_existing'`, `total_net`, an added `total_debit` (what left the balance), and `statement_id` in place of `invoice_id`. The UI's Cycles table switches its link column on `statement_id`. |
| P-D7 | Prepaid recurring from `computeRecurringLines`: a `charge` line → debit (type `recurring`). A `credit` line (item ended inside an already-charged period, `prorate = true`) → **credit back to the balance** (type `adjustment`, positive, `metadata.reason = 'recurring_credit'`). `source_ref = recurring-{itemId}-{kind}-{servicePeriodStartISO}-{servicePeriodEndISO}`. `billed_to_date` advances to `newBilledToDate`. |
| P-D8 | Prepaid one-time: charged at the first processed bill date D with `bill_start_date ≤ D` (in-advance semantics, F-D4), once (`billed_to_date` set). `source_ref = one_time-{itemId}`. |
| P-D9 | Prepaid test / dry: iterate every due cycle on in-memory copies of `next_bill_date`, item watermarks and a running balance (opening chained from the previous simulated closing). Nothing persists. Statements are not written in test mode either (the current behaviour, unchanged). |
| P-D10 | `resolvePrepaidDebit({ lineAmount, priceBasis, taxRate, taxPoint })` → `{ debit, net, tax, taxRate }`. `topup`: `debit = net = round2(lineAmount)`, `tax = 0`, rate ignored. `consumption`: `lineVat(...)`, `debit = gross`. Usage passes `priceBasis = 'net'` (or the simple usage basis). The tax point is read once per run / per consume call (`getPrepaidTaxPoint`). |
| P-D11 | `topupReceipt.ts` takes `taxPoint`. In `consumption` mode it uses rate 0 (net = gross, VAT 0). The `prepaid-topup-captured` subscriber passes the setting. |
| P-D12 | `vat_summary` is built from the period's debit transactions' `metadata.{net,tax,tax_rate}` (grouped by rate) at close. In `topup` mode it is `[]` and the UI hides the section. |
| P-D13 | ItemForm learns the tax point from `GET /api/billing/settings` (already fetched for `defaultTaxRate`). Prepaid + `topup` → VAT input and basis switch disabled with the note and a settings link. The item API keeps accepting the values (stored for a later mode switch) and returns `warnings: ['billing.item.tax_ignored_prepaid_topup']` when a non-default basis or rate is sent. |
| P-D14 | Workspace tabs use `@open-mercato/ui` `tabs`. The active tab is in `?tab=` (router replace, no history spam). Each tab component mounts on first open and stays mounted. Prepaid-only tabs are hidden for postpaid and vice versa. The existing section components are reused unchanged inside tabs. |
| P-D15 | Account list financials: one SQL aggregate over the page's account ids (`SUM(outstanding)` for posted / partially_paid invoices + debit memos, and the overdue subset by `due_date < today`) in the list route's `afterList` hook. `hasOverdue=true` → `id IN (SELECT bill_account_id … overdue)` subquery, indexed by `billing_invoices (organization_id, tenant_id, bill_account_id, status)`. |

## Data model

Migration `Migration20261119000000_billing_operator_feedback.ts` (hand-written, with `down`):
- `billing_items` + `price_basis text not null default 'net'` + check `in ('net','gross')`.
- `billing_settings` + `prepaid_tax_point text not null default 'topup'` + check `in ('topup','consumption')`.
- `billing_statements` + `vat_summary jsonb null`.

No new entities, so no entity-id changes. `generated/entities/billing_*` field lists are regenerated (`node scripts/generate-entity-registry.mjs`).

## Step details

### 1.1 Settings visibility
`backend/config/billing/page.meta.ts`: drop `navHidden`. A `BillingSettingsLink` (lucide `Settings`, `billing.settings.view`) goes in the Invoices and Bill Runs list headers. The post-guard error (`billing.invoice.seller_settings_missing`) gets a link in the invoice detail flash/inline error. `AGENTS.md` "Additional Conventions": rewrite the settings rule (navHidden only for settings sub-pages reached from another settings page). Check that `yarn generate` keeps the route.

### 1.2 Mask help
`backend/config/billing/page.tsx:381-385`: bare tokens + `[':N', 'Zero-pad the counter to N digits, e.g. {SEQUENCE_NUM_MONTH:4} → 0007']`. `MaskField` shows `formatNumber(mask, { date: today, seq: 7 })` from `lib/numbering.ts` (pure) under the input, and shows the validation error instead when the mask is invalid.

### 1.3 Currency suffix
`ItemForm` new prop `accountCurrency?: string`. It is resolved from `accountOptions` in create mode and passed by `items/[id]/page.tsx` in edit mode. A small `MoneyInput` wrapper (input + trailing currency) is used for amount, unit prices and the F3 counterpart. Tiered JSON gets a "Prices in {currency}" caption.

### 2.2 Delete run — tests
Mock-EM unit tests: real run → 422. Running → 409. Other org → 404. Test run with 2 invoices + edits → counts, and the outcome / run deletes issued in order. A dry run (no invoices) deletes cleanly. A child run's `parent_run_id` is nulled.

### 2.4 UI
Run detail header: `Wipe test invoices` (test only, ConfirmDialog with count from `summary.drafts_created`) and `Delete run` (test / dry, destructive, ConfirmDialog → `router.push('/backend/billing/runs')`). Runs list: row action `Delete` (test / dry, `billing.run.delete`) + `Mode` filter. Invoice detail: remove `handleWipeTest` and the button. A test draft shows `Tag "Test run"` linking to `/backend/billing/runs/{bill_run_id}`.

### 3.3 Line amounts
`lib/lineAmounts.ts`: `lineVat`. Update `invoiceWriter.ts` (`buildInvoiceLinesFromItems`, `buildRecurringLineDescriptors`, the usage descriptor builder, `writeDraftInvoice` totals), the engine's dry / test preview totals, and draft line add / edit commands (manual lines: `priceBasis: 'net'`). Grep for `totalNetAmount` to find every consumer, including the prepaid close (rewritten in 4.4–4.6), tests and the statement breakdown.

### 3.5 ItemForm
A segmented `Net | Gross` (`priceBasis` value). Counterpart: `lineVat({ amount: typed, priceBasis, taxRate })` for one unit, showing the other side read-only ("Gross 60.27 EUR"). On a basis toggle the typed value is converted (`net → gross`: show the gross of the current net; `gross → net`: the net), so the price is preserved. Disabled when Tiered is selected (forced `net`) and per P-D13.

### 4.1 Reproduce F4
`__integration__/TC-BILL-011.spec.ts` part a: create a prepaid account (`next_bill_date` 2026-11-14, monthly), a top-up, one-time 99 + recurring 49 starting 2026-11-14 → `POST /api/billing/runs { mode: 'real', asOfDate: '2026-12-14', scopedAccountIds }` → expect 2 cycles, 2 debits, `next_bill_date = 2027-01-14`. Also a jest test against `processPrepaidAccount` with `nextBillDate` as the **string** `'2026-11-14'` and string item dates (mirrors real hydration), which the existing mocked test does not cover. If neither reproduces, record the attempt here and ask the operator to repeat the scenario, then inspect the run / outcome / statement / transaction rows.

### 4.4 Prepaid close rewrite
`closePrepaidPeriod(em, account, billDate, …)`: for each recurring item, `computeRecurringLines(state, { billDate, cycle })` with `unitPrice` from `rate_json`. One-time per P-D8. Lines → `resolvePrepaidDebit` → `applyBalanceMovement`. Statement window = `deriveBillPeriod(billDate)`. Its recurring breakdown carries `service_period_start / end`, `proration`, `net / tax / debit`. Remove the prepaid use of `itemSelector`. If `itemSelector.ts` has no consumers left, delete it and its test.

### 4.7 Settings + statement UI
Settings page Prepaid defaults: radio `Tax at top-up` / `Tax at billing` with help text. `topup_tax_rate` input only in `topup` mode. A warning callout appears when the value changes from the loaded one. Statement detail: a "VAT summary" table when `vat_summary.length > 0`. Per-line net / VAT columns in the breakdown.

### 4.8 Key unit cases
- The operator scenario, in advance: the run as of 2026-12-14 charges 99 + 49 at bill date 2026-11-14 for 2026-11-14..12-13, and again 49 at 2026-12-14 for 12-14..2027-01-13. `next_bill_date = 2027-01-14`.
- The same scenario in arrears: the Nov 14 bill date is empty, Dec 14 charges Nov 14..Dec 13.
- Switching advance → arrears between runs never charges a period twice (watermark).
- An item starting mid-cycle with `prorate` → prorated debit and label. With `prorate = false` → skipped + `skipped_items`.
- A prepaid item ended inside a charged period → `adjustment` credit back.
- Tax point `topup`: receipt 123 @23% → 100 + 23, balance 123, item 49 @23% debits 49. `consumption`: receipt VAT 0, item 10 net @23% debits 12.30, gross-basis item 12.30 @23% debits 12.30, usage @0% net = gross. `vat_summary` grouped by rate.
- Test mode over 3 due cycles → 3 previewed cycles, nothing persisted.

### 5.x Workspace
- `components/account/AccountRunBillingDialog.tsx`: mode select (Test default; Dry when the user lacks `billing.run.trigger`), as-of date, Ctrl/Cmd+Enter / Esc. Posts `/api/billing/runs` with `scopedAccountIds: [id]`. The result panel renders `cycles` and `skipped_items` (shared `RunCyclesSection`) and offers Wipe / Delete for test runs.
- `components/account/AccountSummaryCards.tsx` from `/summary`.
- `backend/billing/accounts/[id]/page.tsx` split: the page shell (header, actions, cards, tabs) and tab components in `components/account/` (keep files < 300 lines).
- The Bill runs tab lists outcomes for the account (status, as-of date, mode, cycles count, documents) with links to the run.
- `navigation.ts`: `returnTo` includes `?tab=`. Existing callers updated + tests.

### 6.1 Integration tests
Ask the user before `yarn mercato db migrate`. Run the five pending specs one by one (`yarn test:integration --grep TC-BILL-00X`), fix failures, note results here.

## Risks

| Risk | Mitigation |
|---|---|
| Renaming `totalNetAmount` touches many call sites (writer, engine, tests, prepaid) | Done in one step (3.3) with typecheck as the net. No behaviour change on the net basis (regression tests). |
| F4 root cause stays unknown | P-D5 hardening + prepaid `cycles` make a repeat diagnosable. The operator re-run is the fallback (4.1). |
| The prepaid close rewrite changes `source_ref` format, so old refs are not deduped against new ones | D14 reseed. `billed_to_date` stays the primary guard. Documented in MIGRATION.md. |
| The account page refactor breaks existing Phase-1 navigation tests (TC-BILL-004) | 6.1 runs TC-BILL-004 after the refactor. `returnTo` tests in 5.3. |
| The tax-point switch with live balances | Forward-only, warning on the settings page, `metadata.tax_point` on every debit. |

## Completion notes (2026-11-15)

Phases 1–5 implemented; billing unit suite green. Deviations are recorded in the spec's Implementation Status (F4 diagnosis, P-D7 credits typed `recurring`, P-D8 one-time window, P-D13 no API warnings, prepaid `ratedAmount` = debit). Open: 6.1 (apply migrations — needs the user's go-ahead — then run TC-BILL-004/005/006/009/010/011/012/013) and the app `yarn build` in 6.4 (shares `.mercato/next` with a running dev server).
