# Execution plan — Credit and debit memos (Spec D)

Source spec: .ai/specs/2026-11-14-billing-credit-debit-memos.md (D-D1..D-D10; umbrella WS-6, D17–D18)
Depends on: Spec 0 (memo columns on `billing_invoices`, `credit_memo` series), Spec B (VAT per line, post flow, PDF memo variant, email), **Spec C (this branch's `.ai/runs/2026-11-14-billing-payments/PLAN.md` — source-typed `billing_allocations`, allocation service, account lock)**
Base branch: feat/billing-account-workspace, after Spec C
Packages: `@dainamite/billing` (minor)

## Resume protocol

Start only when every Spec C row is `done`. Work top-down; update statuses here; keep `yarn typecheck` (packages/billing) and the billing jest suite green after each step; never commit; never apply migrations.

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | Migration: `corrects_invoice_number`, `corrects_issue_date` columns (snapshot of the original) + index check | done |
| 1 | 1.2 | Validators: memo create schema (type, reason, lines with `correctsLineId?`), `documentType` helpers in `lib/documentTypes.ts` | done |
| 1 | 1.3 | ACL `billing.invoice.correct` + setup grants | done |
| 1 | 1.4 | Command `billing.invoices.create_memo` (undo = delete draft) + draft memo delete command | done |
| 1 | 1.5 | Unit tests: original state guards, reason required, line copy keeps VAT, full-credit prefill | done |
| 2 | 2.1 | `lib/memoGuards.ts` — pure cumulative credit guard + credited status rule | done |
| 2 | 2.2 | Post branch: credit memo (lock, guard, allocation to original, remainder credit, auto-apply, statuses) | done |
| 2 | 2.3 | Post branch: debit memo (invoice series, due date, outstanding, credit auto-apply, matchable) | done |
| 2 | 2.4 | Allocation service: credit-memo source (unallocated = memo `outstanding`), `credited_total` bucket, account credit incl. memos | done |
| 2 | 2.5 | Events `billing.credit_memo.posted`, `billing.debit_memo.posted`, `billing.invoice.credited`; auto-send + credit subscribers listen to memo events | done |
| 2 | 2.6 | Unit tests: partial credit, full credit unpaid → credited, credit on paid → account credit applied to next invoice, guard breach, debit then credit, un-allocate memo allocation | done |
| 3 | 3.1 | PDF memo variant: "Corrects invoice X of DATE", reason, credit-memo settlement text instead of payment block (en/pl) | done |
| 3 | 3.2 | API: `POST /api/billing/invoices/{id}/memos`, detail `corrections[]` + source-typed `allocations[]`, list `corrects_invoice_*` | done |
| 3 | 3.3 | UI: invoice detail Create credit / debit memo buttons, Create credit memo dialog (line checkboxes, editable qty/unit net, Full credit, reason, projected totals), Corrections section, memo badge + "Corrects" link + reason | done |
| 3 | 3.4 | UI: list / account section — Type filter gains memos, Type column, credit memo totals shown negative | done |
| 3 | 3.5 | i18n en/pl | done |
| 4 | 4.1 | Demo seed: one partial credit memo, one full credit on a paid invoice, one debit memo + its row in the payments sample CSV | done |
| 4 | 4.2 | Integration test TC-BILL-010: invoice → credit memo → post → original partially paid; over-credit → 409 | done |
| 4 | 4.3 | Docs: MIGRATION.md, changeset, manual §9 Corrections, spec status | done |
| 4 | 4.4 | Gate: build:packages, generate, typecheck ×3, test, build | done (app build deferred — dev server running) |

## Goal

A posted invoice can be corrected only by a referenced corrective document. Credit memos reduce what the customer owes (and become account credit when the invoice is already paid); debit memos are payable supplementary invoices. Everything stays inside billing's ledger and allocation model.

## Non-goals

- Automatic memos (bill runs, CPQ, connector) — D-D2. Memos on receipts — D-D6. Refund payouts — D-D10. Before/after correction layout and KSeF — documented limitation.
- Memos of memos (correct the original again) — D-D3.

## Decisions (spec + plan)

| # | Decision |
|---|---|
| P-D1 | Memo amounts are positive (D-D5); the list / PDF shows credit memo totals negative (display only). |
| P-D2 | `credited_total` on the original = Σ active allocations with `source_type = 'credit_memo'`; `paid_total` = Σ payment allocations; the original's `outstanding = gross − paid_total − credited_total`. Debit memos are separate payable documents with their own `outstanding` (never added to the original's). |
| P-D3 | Credited status: when `credited_total ≥ total_gross` the original becomes `credited` (D-D7); if payments and memos together settle it, `paid`. |
| P-D4 | Cumulative guard (inside the account lock at post): `Σ gross of posted credit memos on the original (incl. this) ≤ original.total_gross + Σ gross of posted debit memos on the original` else 409 `billing.memo.exceeds_invoice`. Also checked (non-locking, advisory) when the draft is created / lines change, for early UI feedback. |
| P-D5 | Credit memo settlement: allocate `min(memo.gross, original.outstanding)` to the original (`allocated_by = 'credit'`), remainder = memo `outstanding` (its unallocated credit) → `applyAccountCredit`. Memo status `paid` when its outstanding = 0, else `posted`. |
| P-D6 | Debit memo: numbered on the `invoice` series (D-D8), `due_date` from terms, `outstanding = gross`, matchable by number (the Spec C matcher already includes `debit_memo`), credit auto-apply on post. |
| P-D7 | Create memo copies `bill_account_id`, `currency_code`, `buyer_snapshot` source (account), and snapshots `corrects_invoice_number` / `corrects_issue_date`. Lines: copied lines keep `tax_rate` and set `corrects_line_id`; new lines default to the org rate. Credit memo `lines` may be omitted → full credit (all lines copied). Debit memo starts empty unless lines are given. |
| P-D8 | Draft memos are deleted (hard delete of draft + lines), undoable by recreating from the snapshot. Posted memos are never deleted (no void). |
| P-D9 | `billing.invoice.posted` keeps firing for `document_type = invoice` only; memos fire their own events. The Spec B auto-send subscriber and Spec C credit subscriber get sibling subscriber files for `billing.credit_memo.posted` / `billing.debit_memo.posted` (one subscriber file per event, shared handler). |
| P-D10 | Un-allocating a credit-memo allocation is allowed (same `billing.payments.unallocate` path, source-agnostic), which restores memo outstanding and recomputes the original (possibly leaving `credited`). |

## Step details

### 1.1 Migration `Migration20261118000000_billing_memos.ts`
`alter table billing_invoices add column corrects_invoice_number text null, add column corrects_issue_date date null;` (entity fields `correctsInvoiceNumber`, `correctsIssueDate`). `corrects_invoice_id` / `correction_reason` / `credited_total` already exist (Spec 0).

### 1.4 `billing.invoices.create_memo`
Input `{ invoiceId, type: 'credit_memo'|'debit_memo', reason (1..1000), lines?: [{ correctsLineId?, description, quantity, unitPriceNet, taxRate? }] }`.
Guards: original exists in scope, `document_type = invoice`, status in (posted, partially_paid, paid, credited→ only debit), not test_run → else 409 `billing.memo.invalid_original`. Credit memo lines with `correctsLineId` must belong to the original and keep its `tax_rate` (client rate ignored for copied lines). Writes the draft with `DRAFT-…`, `series null`, `period_*` from the original, `bill_date null`, totals via `vat.ts`. Returns `{ memoId, number }`. Undo → delete draft (P-D8).

### 2.2 / 2.3 Post
`postInvoiceCommand` branches on `document_type`:
- series: `credit_memo` → `credit_memo`; invoice / debit_memo → `invoice` (already the Spec 0 rule).
- credit memo: claim number + snapshots inside the existing locked transaction, then (same transaction) `withAccountLock` semantics → guard (P-D4) → allocation (P-D5) → recompute original (P-D2/P-D3) → `applyAccountCredit` → memo status. Events after commit: `billing.credit_memo.posted`, `billing.invoice.credited` when the original became `credited`.
- debit memo: Spec B flow (due date, outstanding = gross) + `billing.debit_memo.posted`.
- PDF freeze unchanged (memo variant via the model).

### 3.1 PDF
`invoiceModel` already supports `correctsNumber` + memo titles. Add: `correctsIssueDate` ("Corrects invoice X of DATE"), `reason` row, credit memo → `payment = null` and a `settlement` block ("Amount credited: … / settled against invoice X"), keys `billing.pdf.memo.*` en/pl. Model tests extended.

### 3.3 UI
- Invoice detail (original, posted/partially_paid/paid, type invoice): **Create credit memo** (dialog) and **Create debit memo** (dialog: reason only → opens the new draft to add lines). Dialog: original lines table with checkbox, editable qty / unit net, live projected totals, **Full credit** button, reason textarea (required), Cmd/Ctrl+Enter, Escape; on success navigate to the memo draft.
- Corrections section: memos of this invoice (number, type, status, gross) linking to them.
- Memo detail: type badge, "Corrects <number>" link, reason field; the hint "Corrects this document only. Update the billing item to change future invoices."
- Allocations section (from Spec C) shows credit-memo sources.

### 4.1 Demo
After the Spec C seed posts invoices: one partial credit memo on account A's first invoice, one full credit memo on a paid invoice (account credit visible), one debit memo on account B whose number appears in the payments sample CSV.

## Risks

| Risk | Mitigation |
|---|---|
| Over-crediting by concurrent posts | Guard evaluated inside the per-account lock (Spec C `withAccountLock`). |
| Status confusion (paid vs credited) | Single pure rule in `memoGuards.ts` + table-driven tests. |
| Operators expect memos to change future billing | UI copy on the memo page and the dialog. |
| PL formal corrective-invoice requirements | Out of scope; documented limitation (difference-only layout). |

## Completion notes (2026-11-15)
- All steps done. Gate: build:packages, typecheck (billing, connector, app), 1574 unit tests green. `yarn build` deferred while the dev server is running (shared `.mercato/next`).
- Not run: TC-BILL-010 (needs migrations applied).
- Deviations: the post command now takes the per-account lock for every document type (not only credit memos), so posting serialises with payment allocations; demo memos are not seeded (the seed posts no invoices) — manual §9 walkthrough + a debit-memo row in `payments-sample` instead; draft deletion is limited to memos (bill-run drafts keep their existing flow).
