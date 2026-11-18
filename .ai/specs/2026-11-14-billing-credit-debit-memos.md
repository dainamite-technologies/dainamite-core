# Billing — Credit and Debit Memos (Spec D)

**Date**: 2026-11-14
**Status**: Draft. Decisions agreed. Storage per [Spec 0](2026-11-14-billing-standalone-invoice-ledger.md).
**Owner**: Mac
**Target**: `@dainamite/billing`
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md) (WS-6, decisions D17–D18)
**Depends on**: [Spec 0](2026-11-14-billing-standalone-invoice-ledger.md) (billing-owned `billing_invoices`) · [Spec B](2026-11-14-billing-invoice-documents.md) (VAT per line, post-time numbering, PDF, email, due date) · [Spec C](2026-11-14-billing-payments.md) (allocation model, account credit)

---

## TLDR

Correct a posted invoice with a **manual** credit or debit memo, created from the invoice page:

1. Memos are **billing invoices** (`billing_invoices` rows, Spec 0) with `document_type = credit_memo | debit_memo` and `corrects_invoice_id`. One list, one PDF pipeline, one numbering/post flow.
2. Operator flow: posted invoice → **Create credit memo** / **Create debit memo** → draft memo (reason required, lines edited manually) → **Post** → PDF / email.
3. A **debit memo** is a payable document: due date, outstanding, overdue, and matchable by its number in Spec C payments.
4. A posted **credit memo** acts like a payment: it is **allocated** to the corrected invoice's outstanding amount, and any remainder becomes **account credit**, auto-applied to the oldest open invoice (D12). Spec C's allocation model is generalised from "payment → invoice" to "**source** (payment | credit memo) → invoice".
5. Guard: total credits on an invoice may never exceed its gross plus its posted debit memos.
6. Memos are purely financial. They never touch item watermarks (`billed_to_date`), usage, or bill runs.

---

## Design Decisions

| # | Decision |
|---|---|
| D-D1 | Memos live in billing's own `billing_invoices` table (Spec 0) as real columns `document_type` + `corrects_invoice_id` + `correction_reason`. Nothing in core Open Mercato (`sales`) is used or written. |
| D-D2 | Corrections are **manual only**. No automatic memo generation from bill runs, CPQ or the connector (Spec A's in-advance credit lines stay invoice lines on the next bill-date invoice). |
| D-D3 | Created only from the **invoice page** of a posted, partially paid or paid billing invoice of type `invoice`. Not from a draft or test document, and not from a memo (correct the original again). |
| D-D4 | A reason is required (free text, printed on the PDF). |
| D-D5 | Memo amounts are stored **positive**. The type gives the sign. AR math: `account balance = Σ invoice/debit outstanding`, where credit memos reduce outstanding through allocations, never through negative totals. |
| D-D6 | Prepaid top-up receipts can't be corrected through memos in v1 (prepaid unchanged, D8). |
| D-D7 | **No void.** A posted document is never voided. It can only be neutralised by a credit memo. A fully credited invoice gets status `credited`. Drafts are deleted. |
| D-D8 | Numbering (billing-owned `BillingDocumentSequence`, Spec 0): credit memos on the **`credit_memo` series** (`CN/…`), debit memos on the **`invoice` series** (a debit memo is legally a supplementary invoice). |
| D-D9 | Credit prefill: a dialog with the original lines (checkbox + editable qty / unit net), plus a **Full credit** shortcut. Debit memos start empty. |
| D-D10 | A credit memo's remainder on a paid invoice becomes **account credit** (auto-applied, D12). Refunds of credit to the customer are a **manual** operation outside billing in v1. |

---

## Problem Statement

Verified 2026-11-14:
- Invoice actions are add / edit / remove line (draft) and post. Nothing exists after post.
- `void` is seeded as an invoice status and shown in filters, but no command sets it.
- The post command's comment says corrections go through "core/sales manual edit". That means editing an issued fiscal document in place, which isn't acceptable (PL/EU require a corrective document that references the original).
- There's no way to fix a wrong price, apply a goodwill credit, undo overbilled usage, or charge a missed fee without manual workarounds.

---

## Proposed Solution

### Document model (columns on `billing_invoices`, Spec 0)

| Key | Invoice | Credit memo | Debit memo |
|---|---|---|---|
| `document_type` | `invoice` | `credit_memo` | `debit_memo` |
| `corrects_invoice_id` / `corrects_invoice_number` / `corrects_issue_date` | — | required | required |
| `correction_reason` | — | required | required |
| `bill_account_id` | ✓ | copied from the original | copied from the original |
| line `corrects_line_id` | — | when copied from an original line | optional |

Currency is always the original's. VAT is per line (Spec B). Copied lines keep the original rate, and new lines default to the org default rate.

### Lifecycle
```
original (posted|partially_paid|paid)
   └─ Create memo ─▶ memo draft (DRAFT-… number, editable lines, reason)
                       └─ Post ─▶ memo posted (real number, PDF frozen, auto-send if account flag)
```
Draft memos can be deleted. Posting runs the Spec B post flow plus the steps below.

**Posting a debit memo:** `due_date = issue_date + terms`, `outstanding = gross`. From then on it behaves exactly like an invoice: overdue, Spec C payment matching by its number, and credit auto-apply on post.

**Posting a credit memo** (one atomic flush, per-account lock as in Spec C):
1. Guard: `Σ posted credit memos (incl. this one) ≤ original.gross + Σ posted debit memos on it`, else 409 `billing.memo.exceeds_invoice`.
2. Create an allocation `source = credit_memo → original invoice` for `min(memo.gross, original.outstanding)`. Recompute the original (`partially_paid` / `paid`).
3. The remainder becomes **account credit** (allocatable later, D-Q4). Auto-apply oldest-due-first (D12).
4. The memo's own status → `paid` once fully allocated (it is "settled"). `outstanding` on a credit memo = its unallocated credit.
5. If the original's settlement is entirely by credit memos (`credited_total ≥ total_gross`), its status becomes `credited` (D-D7).

### Allocation model change (amends Spec C)
`BillingPaymentAllocation` → **`BillingAllocation`** with `source_type` (`payment | credit_memo`), `source_id`, `invoice_id`, `amount`, `allocated_by`. Credit memo "unallocated credit" is computed like a payment's `unallocated_amount`. Account credit = Σ unallocated over matched payments + posted credit memos. Un-allocating a credit-memo allocation is allowed (undoable), same as payments.
*If Spec C is implemented first, this is a rename + one column. Better: build Spec C with `source_type` from the start (noted in Spec C).*

### PDF (Spec B template, memo variant)
Title "Credit memo" / "Faktura korygująca" (debit: "Debit memo" / "Nota obciążeniowa"; final wording per the i18n review). A **"Corrects invoice <number> of <date>"** block, the reason, the lines, a VAT summary and totals. Credit memo payment instructions are replaced by "Amount credited to your account / settled against invoice X".
*Limitation:* the layout shows the **difference only** (no before/after columns, which some PL corrective-invoice practice uses). Acceptable for the demo, revisit with KSeF.

### UI
- **Invoice detail (original)**: "Create credit memo" / "Create debit memo" buttons (feature `billing.invoice.correct`). A **Corrections** section listing memos (number, type, status, gross). Allocations section shows credit-memo allocations next to payments (Spec C).
- **Create credit memo dialog** (D-Q2): original lines with a checkbox plus editable qty / unit net, a "Full credit" shortcut, the required reason, and the projected totals. `Cmd/Ctrl+Enter` submit, `Escape` cancel.
- **Memo detail**: same page as an invoice, with a type badge, a "Corrects <number>" link, and the reason.
- **Invoice list / account Invoices section**: a **Type** filter and column (Invoice / Credit memo / Debit memo). Credit memo totals are displayed negative (display only).
- **AR summary** (Spec B): credit includes unallocated credit-memo amounts.

---

## Data Models

No new tables beyond the Spec C rename (memo columns live on `billing_invoices`, Spec 0):
- `billing_allocations` (was `billing_payment_allocations`): `source_type text not null`, `source_id uuid not null`, `invoice_id uuid not null`, `bill_account_id`, `amount`, `currency_code`, `allocated_by`, `user_id?` + standard columns. Index `(source_type, source_id)`, `(invoice_id)`.

---

## API Contracts

| Method + path | Feature | Notes |
|---|---|---|
| `POST /api/billing/invoices/{id}/memos` `{ type: 'credit_memo'\|'debit_memo', reason, lines?: [{ correctsLineId?, description, quantity, unitPriceNet, taxRate }] }` | `billing.invoice.correct` (new) | Creates the draft memo. 409 on an invalid original state. |
| `POST /api/billing/invoices/post` | existing | Branches on `document_type`. Credit guard + allocation. |
| `add-line` / `edit-line` / `remove-line` | existing | Work on draft memos. The credit guard is re-checked at post. |
| `GET /api/billing/invoices` | existing | + `documentType` filter. Response + `document_type`, `corrects_invoice_*`. |
| `GET /api/billing/invoices/{id}` | existing | + `corrections[]`, `allocations[]` (source-typed). |
| `GET /api/billing/invoices/{id}/pdf`, `POST …/send` | existing (Spec B) | Memo variant |

Events: `billing.credit_memo.posted`, `billing.debit_memo.posted`, `billing.invoice.credited`. `billing.invoice.posted` keeps firing for `document_type = invoice` only (subscribers like auto-send listen to all three).

---

## Implementation Plan

### Phase 1: Model + creation
1. Validators (memo create schema, line schema). `document_type` helpers. ACL features + setup grants.
2. Command `billing.invoices.create_memo` (undo = delete the draft). Prefill from selected original lines.
3. Unit tests: state guards (draft/test/memo originals refused), the reason requirement, line copy keeping VAT.

### Phase 2: Posting + allocations
1. Allocation generalisation (`source_type`). Credit-memo post: guard, allocation, remainder credit, auto-apply.
2. Debit-memo post: due date, outstanding, Spec C matching by number.
3. Unit tests: partial credit, full credit on an unpaid invoice, credit on a paid invoice → account credit applied to the next invoice, cumulative-guard breach, debit then credit, un-allocate credit memo.

### Phase 3: PDF, email, UI
Memo PDF variant (en/pl). Invoice detail buttons + dialog + Corrections section. List type filter/column. Account section. i18n.

### Phase 4: Demo + docs
Seed: one partial credit memo, one full credit on a paid invoice (shows account credit), one debit memo matched by a sample-CSV payment row (extends Spec C's sample). Manual section in `billing-ui-testing.md`. Playwright: invoice → credit memo → post → original partially paid.

---

## Risks

| Risk | Mitigation |
|---|---|
| Over-crediting through concurrent memo posts | Per-account advisory lock (Spec C pattern). The guard is evaluated inside the lock. |
| Spec C built without `source_type` → rework | Amend Spec C now: allocations are source-typed from day one. |
| PL corrective-invoice formal requirements (before/after values, KSeF) | Out of scope for the demo. Documented limitation. |
| Operators expect memos to change future billing (for example a price fix) | Clear UI copy: "Corrects this document only. Update the billing item to change future invoices." |

---

## Changelog
- 2026-11-14 — Draft from user decisions: billing-owned memo documents with a reference, created manually from the invoice page.
- 2026-11-14 — D-Q1..D-Q4 resolved (D-D7..D-D10): no void, own series, credit prefill dialog, manual refunds. Storage moved to billing-owned `billing_invoices` (Spec 0).

---

## Implementation Status

Plan: [`.ai/runs/2026-11-14-billing-credit-debit-memos/PLAN.md`](../runs/2026-11-14-billing-credit-debit-memos/PLAN.md)

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Model + creation | Done | 2026-11-15 | `corrects_invoice_number` / `corrects_issue_date` snapshot columns; create / delete-draft commands; early credit guard |
| Phase 2 — Posting + allocations | Done | 2026-11-15 | Post takes the per-account lock for every document; credit memo guard + allocation + remainder credit inside the post transaction; `credited` status from allocations |
| Phase 3 — PDF, email, UI | Done | 2026-11-15 | Memo PDF variant, create dialog, Corrections section, Type filter / column, memo events wired to auto-send and credit auto-apply |
| Phase 4 — Demo + docs | Done | 2026-11-15 | Demo memos are not seeded (the seed posts no invoices) — manual walkthrough §9 instead; `payments-sample` pays a posted debit memo. TC-BILL-010 written, not run (migrations not applied) |
