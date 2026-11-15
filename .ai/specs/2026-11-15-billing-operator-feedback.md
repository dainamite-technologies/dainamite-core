# Billing — Operator Feedback Round 1 (Spec F)

**Date**: 2026-11-15
**Status**: Implemented (2026-11-15). Integration tests pending the migration (Phase 6.1)
**Owner**: Mac
**Target package**: `@dainamite/billing` (`packages/billing/`)
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md)
**Related**: [Spec A](2026-11-14-billing-cycle-semantics.md) (cycle semantics), [Spec B](2026-11-14-billing-invoice-documents.md) (VAT, settings), [Spec E](2026-11-14-billing-account-workspace.md) (account workspace, **its Phases 2–3 are delivered by this spec**), [SPEC-002](SPEC-002-2026-06-17-prepaid-billing.md) (prepaid)

---

## TLDR

Fixes and UX changes from the first hands-on test of Specs 0, A, B, C and D, plus the rest of Spec E:

| # | Topic | Kind |
|---|---|---|
| F1 | "Wipe test invoices" moves from the invoice page to the Bill Run page. New **Delete run** for test and dry runs (wipes their invoices too) | UX + API |
| F2 | Account currency shown next to every rate input in ItemForm (read-only) | UX |
| F3 | NET / GROSS entry switch on item rates. The other figure is computed live. Stored as the typed amount + `price_basis` | UX + data |
| F4 | Prepaid: a real run up to the bill date stopped one cycle short. Reproduce, fix, and record `cycles` + `skipped_items` for prepaid outcomes | Bug |
| F4b | Prepaid honours `charge_timing` and `prorate` (closes Spec A's A-D1 gap) | Engine |
| F5 | Prepaid: new org setting **tax point**. `topup` (default): VAT on the top-up receipt, charges debit the item amount with no item VAT. `consumption`: top-ups carry no VAT, charges debit the **gross** at the item's tax rate | Bug (VAT) + setting |
| F6 | Billing settings (seller details) become visible in the Settings sidebar | Bug |
| F7 | The number-mask help text explains `:N` padding instead of tying `:4` to the monthly counter | UX |
| F8 | Spec E Phases 2–3: account workspace tabs, Run billing dialog, financial list columns | Feature |
| F9 | Run the integration tests that were never run (TC-BILL-004/005/006/009/010) | QA |

---

## Decisions (2026-11-15)

| # | Decision |
|---|---|
| F-D1 | **Test and dry runs can be deleted. Real runs cannot.** Deleting a test run also deletes its test invoices. The runs list shows **all** runs (no default filter). A Mode filter is available but off. |
| F-D2 | An item price is stored **as typed**, plus `price_basis: 'net' \| 'gross'`. Invoice lines are computed from that basis (`lineAmountsFromNet` / `lineAmountsFromGross`), so the operator's gross is exactly the invoice's gross. There is no second stored amount column. |
| F-D3 | **Prepaid tax point is an org setting**, `BillingSettings.prepaid_tax_point: 'topup' \| 'consumption'`, default **`topup`**, under Prepaid defaults. **`topup`**: the top-up receipt splits VAT at `topup_tax_rate`. The balance holds VAT-inclusive money, so charges debit the item amount as entered, with no VAT added. On items of prepaid accounts the VAT rate and the NET/GROSS switch are disabled, with the note "For prepaid accounts, tax is allocated at top-up." **`consumption`**: the top-up receipt carries no VAT (net = gross, `topup_tax_rate` hidden). Charges debit the **gross** at the item's tax rate: 20 at 0% debits 20, 10 net at 23% debits 12.30. Usage debits follow the same rule. |
| F-D4 | Prepaid in advance: bill date D debits `in_advance` items for `[D, D + cycle − 1]` at D. `in_arrears` items keep `[D − cycle, D − 1]`. One-time items are charged at the first bill date on or after their start. Proration works as in postpaid. The statement period stays `[D − cycle, D − 1]`. Existing items default to `in_advance` (D14: reseed, no data migration). |
| F-D5 | Spec E's remaining phases are delivered here. Spec E's Implementation Status points to this spec. |

**Why one mode per org:** a single tax point guarantees VAT is charged exactly once. It never lands on both the receipt and the consumption. Today's code behaves like `topup`, except that item VAT rates are silently ignored. F5 makes that explicit in the UI.

---

## Findings (verified against code, 2026-11-15)

### F1 — Wipe test invoices
- The button is on `backend/billing/invoices/[id]/page.tsx:778`. It calls `POST /api/billing/test-invoices/wipe` with `billRunId`. The command (`billing.invoices.wipe_test`, `commands/invoices.ts:644`) hard-deletes `billing_invoices` + `billing_invoice_lines` where `test_run = true`. It does **not** delete `billing_draft_invoice_edits` rows for those invoices (orphaned audit rows).
- There is no delete for `billing_runs` / `billing_run_outcomes`.

### F2 / F3 — ItemForm
- `components/ItemForm.tsx`: the rate inputs have no currency marker. The account currency is only visible in the create-mode account picker. Edit mode gets `accountBillingMode` but not the currency.
- The VAT rate is a separate input (default `BillingSettings.defaultTaxRate`). No gross is shown.
- `lib/vat.ts` already has `lineAmountsFromNet` and `lineAmountsFromGross`, both with the exact `net + tax = gross` identity.

### F4 — Prepaid run stopped one cycle short (operator report)
Setup: prepaid, `next_bill_date = 2026-11-14`, monthly. One-time 99 EUR + recurring 49 EUR starting 2026-11-14. Real run as of 2026-12-14 → no transactions, `next_bill_date → 2026-12-14`. Real run as of 2026-12-31 → 99 + 49 charged for the period starting Nov 14.

- By the code, the first run should have handled two bill dates: Nov 14 (period Oct 14–Nov 13, items not started → nothing), then Dec 14 (period Nov 14–Dec 13 → 99 + 49), leaving `next_bill_date = 2027-01-14`. `processPrepaidAccount` loops `while isCycleDue(next_bill_date, asOf)` with `<=` and UTC-normalised dates.
- The mocked unit test (`__tests__/lib/prepaidPeriodClose.test.ts`, 3 cycles) passes, so the difference is in real-database behaviour. Suspects:
  - (a) date columns hydrate as `YYYY-MM-DD` strings (MikroORM v7 `DateType`) while the advanced value is a `Date`. Change tracking compares them as strings.
  - (b) `Date` parameters sent to `date` columns are serialised by `pg` in the server's time zone (anti-duplicate lookup, `period_start` / `period_end`).
  - (c) the outer-EM `account` entity being mutated and flushed through the forked transactional EM in `processAccountSafely`.
- The current dev DB doesn't have this scenario. The operator can repeat it on request.
- Gap: prepaid outcomes record no `cycles` and no `skipped_items` (only postpaid does, Spec A R1.5), so the run page couldn't show why nothing was charged.

### F4b — Prepaid timing
`lib/prepaidPeriodClose.ts` still uses `itemSelector.selectItemsForPeriod`: in arrears, full cycles only, and mid-cycle starts/ends are skipped. ItemForm shows the hint "Prepaid accounts currently charge recurring items at period end."

### F5 — Prepaid VAT
- Top-up (`lib/topupReceipt.ts`): the gross paid is split into net + VAT at `BillingSettings.topup_tax_rate` (default 0) on the receipt. The balance is credited the full amount.
- Charges (`prepaidPeriodClose.ts`): debit `-line.totalNetAmount`. Usage (`prepaidConsume.ts`): debits the rated net amount. Item tax rates are ignored.

### F6 — Seller details hidden
- The page exists at `/backend/config/billing`, guarded by `billing.settings.view` (`admin` has `billing.*`).
- `backend/config/billing/page.meta.ts` sets `navHidden: true`. Core settings pages that appear under "Module Configs" (e.g. `catalog/backend/config/catalog/page.meta.ts`) do **not** set it.
- Our `AGENTS.md` ("Settings pages MUST use `pageContext: 'settings'` with `navHidden: true`") is wrong for pages that should appear in the settings sidebar. It is corrected in this spec.

### F7 — Number masks
`{SEQUENCE_NUM_MONTH:4}` means "counter resets monthly, **zero-padded to 4 digits**" (`INV/2026/11/0007`). `:N` is optional on any counter token (`lib/numbering.ts`). The settings help list (`backend/config/billing/page.tsx:381-385`) shows `:4` only on the monthly token. That reads as if `:4` belonged to the monthly scope. The default masks use `:4` on purpose, so numbers sort and align. Without it the result is `INV/2026/11/7`.

---

## Proposed Solution

### F1 — Delete run, wipe on the run page
- New command `billing.runs.delete`. It loads the run with tenant + org scope and rejects real runs (422 `billing.run.delete_real_forbidden`) and running ones (409 `billing.run.running`). In **one transaction** it deletes:
  1. test invoices with `bill_run_id = run.id AND test_run = true`, their lines and their `billing_draft_invoice_edits`,
  2. the run's `billing_run_outcomes`,
  3. the run row (hard delete; test and dry runs are scratch data).
  Not undoable, like the existing wipe. It emits `billing.run.deleted` with `{ billRunId, mode, invoicesRemoved }`.
- The wipe command also deletes `billing_draft_invoice_edits` for the invoices it removes (fixes the orphan rows).
- Retry-failed children (`parent_run_id`) of a test run are test runs too. Deleting a parent keeps its children and sets `parent_run_id = null`.
- UI:
  - Run detail (`runs/[id]`), for test runs: **Wipe test invoices** (keeps the run, scoped by `billRunId`). For test and dry runs: **Delete run** (confirm dialog that gives the number of invoices to be removed, then redirects to the list).
  - Runs list: a "Delete" row action on test and dry rows. A Mode filter (Real / Test / Dry), off by default.
  - Invoice detail: the wipe button is removed. A test draft shows a "Test run" tag linking to its run.
- ACL: new feature `billing.run.delete` (added to `admin` via `billing.*` and to `billing_admin`).

### F2 — Currency on rate inputs
ItemForm shows the account currency as a read-only suffix (`InputGroup` addon or trailing text) on: one-time amount, recurring unit price, simple usage unit price, and the computed counterpart from F3. Create mode takes it from the selected account (blank until one is picked). Edit mode gets a new `accountCurrency` prop from the item detail page (already loads the account).

### F3 — NET / GROSS entry
- `BillingItem.price_basis text not null default 'net'` (`net | gross`). `rate_json` amounts are stored as typed.
- ItemForm: a segmented control **Net | Gross** above the rate block. The basis amount is the editable input. The other one is shown read-only beside it ("Gross 60.27 EUR" / "Net 49.00 EUR"), computed with `lineAmountsFromNet` / `lineAmountsFromGross` for one unit, and it updates as the amount or VAT rate changes. Switching the basis converts the typed figure, so the price stays the same.
- Applies to `one_time.amount`, `recurring.unit_price` and simple `usage.unit_price`. **Tiered usage JSON stays net**: the switch is disabled with a hint when "Tiered" is selected (validator: `price_basis = 'gross'` + tiered rate → 422 `billing.item.gross_tiered_unsupported`).
- Line computation: the line writer / descriptor builders (`invoiceWriter.ts`: `buildInvoiceLinesFromItems`, `buildRecurringLineDescriptors`, the usage line path) compute `extended = unit × quantity × proration`. Then `net` basis → `lineAmountsFromNet(extended, rate)`, `gross` basis → `lineAmountsFromGross(extended, rate)`. Invoice lines keep storing net / tax / gross, so posted documents, PDFs, allocations and memos are unchanged.
- The item list and detail show the price with a `net` / `gross` tag. The OpenAPI item schema gains `priceBasis`.
- Connector (CPQ → billing): CPQ prices are net, so it sends `priceBasis: 'net'` (default, no connector change needed).

### F4 — Prepaid catch-up bug
1. **Reproduce** with a DB-backed integration test that runs the operator's scenario through `POST /api/billing/runs` (asserts 2 cycles, the charges, `next_bill_date = 2027-01-14`). If it doesn't reproduce in CI, the operator repeats the scenario and we inspect `billing_runs` / `billing_run_outcomes` / `billing_statements` / transactions.
2. **Fix** the root cause. Regardless of the cause, harden: normalise `next_bill_date` with the same date helpers on read and write (`isoDate`), and pass date-only values to `date`-column queries as `YYYY-MM-DD` strings, not `Date`.
3. **Observability:** the prepaid path returns `cycles` (`bill_date`, `period_start`, `period_end`, `status: 'charged' | 'previewed' | 'empty' | 'skipped_existing'`, `line_count`, `total_gross`, `statement_id`) and `skipped_items`, using the postpaid `CycleRecord` shape. The run detail Cycles and Skipped tables render them for prepaid accounts.

### F4b — Prepaid timing and proration
- `prepaidPeriodClose.ts` stops using `itemSelector` for recurring items. It calls `servicePeriods.computeRecurringLines` (the postpaid engine's function) per bill date with the item's `charge_timing` and `prorate`. One-time items: the first bill date `≥ bill_start_date`.
- `source_ref` becomes `recurring-{itemId}-{servicePeriodStartISO}-{servicePeriodEndISO}`. The `billed_to_date` watermark stays the guard (Spec A R1.7: switching timing never charges a period twice).
- **Test / dry runs simulate every cycle** (in-memory `next_bill_date`, `billed_to_date` and running balance, mirroring Spec A R1.4). Today they stop after one cycle.
- The statement keeps `[D − cycle, D − 1]` for usage and top-ups. Its recurring section lists the charges taken at D with their service periods, so an advance charge shows "Dec 14 – Jan 13".
- The ItemForm prepaid hint is removed. The A-D1 note in Spec A is marked superseded.

### F5 — Prepaid tax point
- Setting: `BillingSettings.prepaid_tax_point text not null default 'topup'` (`topup | consumption`). It is shown under **Prepaid defaults** as a radio with help text. `topup_tax_rate` is visible only in `topup` mode. One resolver, `lib/prepaidTaxPoint.ts` → `resolvePrepaidDebit(item, extendedAmount, taxPoint)`, returns `{ debit, net, tax, taxRate }`. Period close and usage consumption both call it, so the two paths can't drift apart.
- **`topup` mode (default):**
  - Receipt: unchanged (VAT split at `topup_tax_rate`).
  - Debits: the extended item amount as entered (`debit = net = amount`, `tax = 0`). `price_basis` and `tax_rate` are ignored for prepaid charges.
  - ItemForm on a prepaid account: the VAT rate input and the NET/GROSS switch are **disabled**, with the note "For prepaid accounts, tax is allocated at top-up" linking to Billing settings. The stored `tax_rate` is kept, so switching the org to `consumption` later works without re-editing items.
- **`consumption` mode:**
  - Receipt: VAT 0, net = gross. `topupReceipt.ts` uses rate 0 whatever `topup_tax_rate` says.
  - Recurring and one-time debits = the line's **gross** (F3's basis-aware computation at the item's `tax_rate`).
  - Usage debits (`prepaidConsume.ts`) = `lineAmountsFromNet(rated, item.tax_rate).gross` (usage rates are net, and F3 keeps tiered net). Credit-limit / exhausted checks use the debit.
  - ItemForm: VAT rate and NET/GROSS enabled, with the hint "Charged from the balance including VAT."
- In both modes, debit transactions keep `amount` = the signed debit and gain `metadata.net`, `metadata.tax`, `metadata.tax_rate`, `metadata.tax_point`. Statement (`BillingStatement`): new `vat_summary jsonb` (`[{ rate, net, tax, gross }]`, empty in `topup` mode). `total_recurring` / `total_usage` = the sum of debits (what left the balance).
- Switching the mode applies from the next charge or top-up onward. Captured receipts and past debits are never recomputed. The settings page warns: "Balances topped up under the other mode keep their tax treatment. Switching from top-up to consumption taxes the remaining balance again when it is used."
- Server-side guard: an item create/update for a prepaid account in `topup` mode accepts but ignores `priceBasis = 'gross'`. It is stored as sent, but the debit ignores it, and the API response carries a `warnings: ['billing.item.tax_ignored_prepaid_topup']` hint.

### F6 — Settings visible
- Remove `navHidden: true` from `backend/config/billing/page.meta.ts`, so it lists under Settings → Module Configs → Billing.
- Add a "Billing settings" link (gear icon, `billing.settings.view`) in the Invoices list header and the Bill Runs list header. The post guard's error "Seller details missing" links to the page.
- Correct `AGENTS.md`: `navHidden: true` hides a settings page from the settings sidebar too. Use it only for settings sub-pages that are reached from another settings page.

### F7 — Mask help
The token list shows the bare tokens (`{SEQUENCE_NUM}`, `{SEQUENCE_NUM_YEAR}`, `{SEQUENCE_NUM_MONTH}`) plus one extra row: `:N` — "Zero-pad the counter to N digits, e.g. `{SEQUENCE_NUM_MONTH:4}` → 0007". The default masks keep `:4`. The mask field shows a live preview of the next number (`formatNumber` with the current date and seq 7).

### F8 — Account workspace (Spec E Phases 2–3)
Delivered as designed in Spec E §4 and E2-D3, with these updates from Spec F:
- **Run billing** dialog on the account (mode default Test, as-of date default today) → `POST /api/billing/runs` with `scopedAccountIds: [id]`. The inline outcome shows cycles (prepaid too, F4), documents with links, and skipped items. A test outcome offers **Wipe test invoices** / **Delete run** inline (F1).
- **Tabs** (deep-linkable `?tab=`, lazy): Overview, Items, Usage, Invoices (incl. memos and receipts), Payments (postpaid), Balance & Top-ups / Statements (prepaid), Bill runs. The existing sections (`AccountInvoicesSection`, `AccountPaymentsSection`, `PrepaidPanel`, items, usage) move into tabs unchanged.
- **Summary** endpoint `GET /api/billing/accounts/{id}/summary` gains the prepaid fields (balance, status, credit limit, last statement) and next bill date. The header cards render from it.
- **Account list**: `balance_due`, `overdue_amount` columns (one batched `GROUP BY bill_account_id` over the page's ids) and a `hasOverdue=true` filter.
- `navigation.ts` return targets include the tab.

### F9 — Integration tests
Apply the pending migrations locally (with confirmation, per repo rule), then run TC-BILL-004/005/006/009/010 and fix what breaks. Add TC-BILL-011 (prepaid catch-up + advance + gross debit), TC-BILL-012 (delete test run) and TC-BILL-013 (gross-basis item → invoice gross matches the typed amount).

---

## Data Models

| Entity | Change |
|---|---|
| `BillingItem` | + `price_basis text not null default 'net'` |
| `BillingStatement` | + `vat_summary jsonb null`. `total_recurring` / `total_usage` hold gross (semantic change, documented) |
| `BillingAccountTransaction` | no column change. `metadata.{net,tax,tax_rate}` on debits |
| `BillingSettings` | + `prepaid_tax_point text not null default 'topup'` (`topup \| consumption`). `topup_tax_rate` stays (used in `topup` mode) |
| `BillingRunOutcome` | no column change. `cycles` / `warnings.skipped_items` now filled for prepaid |

Migrations are hand-written as for earlier billing migrations (the generator diffs `@app` modules only), with the module snapshot updated in the same change.

## API Contracts

| Method + path | Change |
|---|---|
| `DELETE /api/billing/runs/{id}` | **new**. Test/dry only. `200 { ok, invoicesRemoved }`. 422 for real, 409 for running. `billing.run.delete` |
| `POST /api/billing/test-invoices/wipe` | unchanged contract. Also removes draft-edit audit rows |
| `GET /api/billing/runs` | + `mode=real\|test\|dry` filter |
| `POST/PUT /api/billing/items` | + `priceBasis` (`net` default). 422 `billing.item.gross_tiered_unsupported` |
| `GET /api/billing/items[/{id}]` | + `price_basis` |
| `GET /api/billing/accounts` | + `balance_due`, `overdue_amount`, `hasOverdue` filter |
| `GET /api/billing/accounts/{id}/summary` | + prepaid fields, `next_bill_date` |
| `GET /api/billing/statements[/{id}]` | + `vat_summary`; totals are gross |
| `GET/PUT /api/billing/settings` | + `prepaidTaxPoint` (`topup` default \| `consumption`) |

All routes export `openApi`. Writes go through commands, with mutation guards on custom write routes.

---

## Implementation Plan

### Phase 1 — Quick fixes (F6, F7, F2)
1. Settings meta `navHidden` removed. Header links. `AGENTS.md` rule corrected.
2. Mask help + live preview.
3. Currency suffix in ItemForm (`accountCurrency` prop in edit mode).

### Phase 2 — Runs (F1)
1. `billing.runs.delete` command + `DELETE /api/billing/runs/{id}` + ACL + event. Unit tests: real rejected, running rejected, cascade counts, parent-link nulling.
2. Wipe also removes draft-edit rows (test).
3. Run detail actions, list row action + Mode filter, invoice page button removed and "Test run" tag added.

### Phase 3 — Price basis (F3)
1. Entity + migration + validators (tiered guard) + OpenAPI.
2. Basis-aware line computation in the writer and descriptor builders. Unit tests: 49.99 gross @23% → line gross 49.99. Net path unchanged (regression). Proration on a gross basis.
3. ItemForm switch + live counterpart + list/detail tag. Seeds: one gross-basis demo item.

### Phase 4 — Prepaid engine (F4, F4b, F5)
1. Reproduce F4 (integration test, or the operator re-run). Root-cause fix + date normalisation.
2. Prepaid cycles / skipped items on the outcome. Run page renders them.
3. Switch to `computeRecurringLines` (timing + proration). New `source_ref`. Multi-cycle test/dry. Unit tests: the operator scenario in advance (Nov 14 run charges Nov 14–Dec 13 at Nov 14), in arrears, a timing switch never double-charges, proration.
4. `prepaid_tax_point` setting (entity, migration, validators, settings UI with warning). `resolvePrepaidDebit` used by period close + `prepaidConsume`. Transaction metadata. Statement `vat_summary`. Receipt rate 0 in `consumption` mode. ItemForm disables VAT + NET/GROSS on prepaid accounts in `topup` mode. Unit tests: `topup` mode → top-up 123 @23% gives a receipt of 100 + 23 and balance 123, a 49 item debits 49. `consumption` mode → top-up 100 gives a receipt with VAT 0, a 10 net @23% item debits 12.30, balance 87.70. Usage @0% → net = gross. A mode switch doesn't touch past rows.
5. Remove the ItemForm prepaid hint. Mark Spec A A-D1 superseded.

### Phase 5 — Account workspace (F8)
1. Run billing dialog + inline outcome (with F1 actions).
2. Tabs shell. Move sections. Summary endpoint prepaid fields + header cards.
3. Account list financial columns + filter (batched aggregate).
4. Bill runs tab (account-scoped outcomes).

### Phase 6 — QA + docs (F9)
1. Migrations applied locally (with confirmation). Run TC-BILL-004/005/006/009/010. Add TC-BILL-011/012/013.
2. `manuals/billing-ui-testing.md`: prepaid walkthrough in both tax-point modes (top-up → advance charge → debit → statement), delete test run, NET/GROSS entry, settings location. `MIGRATION.md`, changeset, CHANGELOG (`prepaidTaxPoint`).
3. Update Spec E Implementation Status (Phases 2–3 → delivered by Spec F) and the umbrella TLDR/changelog.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **VAT compliance of `consumption` mode.** In PL/EU a payment received *before* a service is usually taxed on receipt (advance VAT, art. 19a(8) PL VAT Act), which is the `topup` default. `consumption` mode follows the "multi-purpose voucher" model instead. Its VAT appears only on the **non-fiscal** statement, so there is no fiscal VAT document for prepaid consumption. | The default is `topup`. `consumption` is documented in the manual as needing accountant sign-off. Follow-up item: a periodic VAT invoice for prepaid consumption (e.g. monthly from the statement). |
| R2 | Switching the tax point while balances are non-zero (double or missing VAT on the remaining balance) | The settings page warning. Change applies forward only. `metadata.tax_point` on every debit for audit. |
| R3 | Gross-basis rounding on quantity > 1 or proration | Rounding happens once per line on the extended gross (`lineAmountsFromGross`), the same rule as top-ups. Unit tests cover proration on a gross basis. |
| R4 | F4 root cause not reproducible in CI | The operator re-runs the scenario. Outcome `cycles` (F4.3) make the next occurrence diagnosable from the UI. Hardened date handling regardless. |
| R5 | Deleting a run someone is looking at | Hard delete only for test/dry. Real runs immutable. Confirm dialog with counts. |
| R6 | Workspace page size / load | Lazy tabs. Summary is one aggregate query set. List aggregates are batched per page. |

---

## Changelog
- 2026-11-15 — Skeleton from operator feedback (F1–F6) + leftovers audit. Open questions F-Q1..F-Q6.
- 2026-11-15 — F-Q1..F-Q6 answered → F-D1..F-D5. F7 (mask help) added. Spec E Phases 2–3 folded in as F8. Integration-test backlog as F9. Full design + phases.
- 2026-11-15 — F-D3 revised: prepaid tax point becomes an org setting (`topup` default / `consumption`). In `topup` mode item VAT + NET/GROSS are disabled for prepaid accounts. `topup_tax_rate` kept.
- 2026-11-15 — Implemented phases 1–5 and the docs; see Implementation Status for deviations.
- 2026-11-15 — Operator tweaks: account Items tab shows rate, term, billed-through and a billing state vs today (`lib/itemBillingState.ts`); Postpaid / Prepaid pill in the account header; account Bill runs tab shows run mode + as-of date (`run_mode`, `run_as_of_date` on run outcomes) with wipe / delete row actions; Run billing dialog closes on success and opens the Bill runs tab (fixes the dialog re-appearing after the account reload — the reload is now silent); prepaid statement ledger window is `(previous bill date, bill date]`, so a top-up on the bill date funds the statement whose charges are taken that day.

## Implementation Status

Plan: [`.ai/runs/2026-11-15-billing-operator-feedback/PLAN.md`](../runs/2026-11-15-billing-operator-feedback/PLAN.md)

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Quick fixes | Done | 2026-11-15 | Settings in the sidebar (+ header links, post-guard notice), `:N` help, currency suffix |
| Phase 2 — Runs | Done | 2026-11-15 | `billing.runs.delete`, `DELETE /api/billing/runs/{id}`, `mode` filter, shared cleanup + hook |
| Phase 3 — Price basis | Done | 2026-11-15 | `lib/lineAmounts.ts`, descriptor `lineAmount` / `unitPrice` / `priceBasis`, ItemForm switch |
| Phase 4 — Prepaid engine | Done | 2026-11-15 | Prepaid close on `computeRecurringLines`, multi-cycle test / dry, tax point (`lib/prepaidTaxPoint.ts`) |
| Phase 5 — Account workspace | Done | 2026-11-15 | Tabs, summary cards, Run billing dialog, list financials |
| Phase 6 — QA + docs | In Progress | 2026-11-15 | Docs + TC-BILL-011/012/013 written; running the integration suite waits on `yarn mercato db migrate` |

### Deviations from the text above
- **F4 root cause not reproduced in unit tests.** The pre-Spec F close, run against the operator's scenario with DB-shaped string dates in a mock, closes both bill dates, so the defect is environment / data specific. The rewrite removes both suspects: date-only query parameters are ISO strings (`lib/dateOnly.ts`), and an existing statement no longer stops the account (the old code returned without advancing — the only path that matches the report: one cycle advanced, nothing charged). TC-BILL-011 asserts the scenario against the real DB.
- **Prorated credits** (an item ended inside an already-charged period) credit the balance as a positive `recurring` transaction, not `adjustment` (P-D7): adjustments are summed by date window on statements and would be counted twice.
- **One-time prepaid charges** use the postpaid window (first bill date whose `[D − cycle, D + cycle − 1]` window overlaps the item), not "first D ≥ start" (P-D8), so both modes agree.
- **No `warnings` on the item API** for gross / VAT in prepaid `topup` mode (P-D13): the form disables the fields; the API stores them for a later mode switch.
- **Prepaid usage `ratedAmount`** (API response + `billing.usage.rated`) is the amount debited — equal to the rating in `topup` mode, gross in `consumption` mode — matching what the dedup path already read back from the transaction.
- Fixed on the way: item edit never sent `taxRate` (VAT edits were lost); ItemForm `Esc` did not cancel; wipe left orphan `billing_draft_invoice_edits`.
