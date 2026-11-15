# Billing — Payments: Register, CSV Upload, Auto-Matching, Allocation and Credit (Spec C)

**Date**: 2026-11-14
**Status**: Draft. Decisions agreed, ready for implementation planning review.
**Owner**: Mac
**Target**: `@dainamite/billing`
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md) (WS-4, decisions D5, D6, D9, D12, D15)
**Depends on**: [Spec B](2026-11-14-billing-invoice-documents.md) (`due_date`, `outstanding_amount` maintained at post, `partially_paid` status, invoice number on the PDF as the payment title)

> **Amended by [Spec 0](2026-11-14-billing-standalone-invoice-ledger.md):** allocations update billing-owned `billing_invoices` (`paid_total`, `outstanding`, `status`). No `sales_invoices` writes anywhere.

---

## TLDR

A billing-owned **payment register**, fully detached from core `SalesPayment`:

1. **`BillingPayment`** is one money-in event (a bank line, manual entry or gateway capture), with a match status.
2. **`BillingPaymentAllocation`** links payment → invoice with an amount. Allocations drive the invoice's `paid_total_amount`, `outstanding_amount` and `posted → partially_paid → paid` status.
3. **CSV upload** on a new **Payments** page (demo-grade, fixed columns). Each row becomes a payment. The **auto-matcher** sets `allocated / partially_allocated / matched (account only) / unmatched`.
4. **Credit**: any unallocated amount on a payment matched to an account is **account credit**, auto-applied to the oldest open invoice (on match and on invoice post).
5. **Manual actions**: assign to account, allocate, un-allocate, ignore, **convert to top-up** (prepaid accounts).
6. The demo seed generates **`payments-sample.csv`** against the seeded posted invoices, covering every match outcome.

---

## Design Decisions

| # | Decision |
|---|---|
| C-D1 | **Auto-matching uses the invoice number in the payment description only.** No payer-IBAN learning, no customer numbers (later improvement). Payments without a recognisable invoice number are `unmatched`. The operator can assign them manually. |
| C-D2 | No FX. Currency mismatch → `unmatched` (`currency_mismatch`). |
| C-D3 | A payment that resolves to a **prepaid** account is `unmatched` (`prepaid_account`). The payment detail offers a manual **"Convert to top-up"** action. It creates a captured `BillingTopup` through the existing idempotent `captureTopup` path (balance credit + transaction + VAT receipt), and the payment becomes `converted_to_topup`. Prepaid logic itself is unchanged (D8). |
| C-D4 | Each upload is recorded as a `BillingPaymentImport` batch (file, uploader, counts per outcome, row errors). After upload, a summary screen is shown, and payments can be filtered by batch. |

---

## Current State (verified 2026-11-14)

- The only path to "paid": subscriber `payment_gateways.payment.captured` with `paymentId == invoice.id` flips `posted → paid`. It records no amount, so partial payments are impossible.
- `sales_invoices.paid_total_amount` / `outstanding_amount` exist. The writer sets `outstanding = net` at draft time, and Spec B moves that to `outstanding = gross` at post. Nothing reduces it.
- `lib/creditStatus.ts` already sums `outstanding` for postpaid credit exposure. It becomes accurate once payments reduce `outstanding`.
- `BillingAccountTransaction` is the **prepaid balance ledger** (`balance = SUM(amount)`). Not reused (D9).

---

## Proposed Solution (outline)

### Status model

`BillingPayment.status`:
```
unmatched ──assign account──▶ matched ──allocate──▶ partially_allocated ──▶ allocated
    │  │                         ▲                         │ un-allocate
    │  └──ignore──▶ ignored      └─────────────────────────┘
    └──convert to top-up (prepaid account)──▶ converted_to_topup
```
- `matched`: account known, `unallocated_amount = amount`
- `partially_allocated`: `0 < unallocated_amount < amount`. The remainder is account credit.
- `allocated`: `unallocated_amount = 0`
- `ignored`: excluded from credit and matching (fees, misdirected transfers). Reversible.
- `converted_to_topup`: terminal. `topup_id` points to the created `BillingTopup`. Not reversible from the payment (reverse through the prepaid adjustment flow).

Invoice side, after every allocation change: `paid_total = Σ allocations`, `outstanding = gross − paid_total`, status = `paid` if outstanding = 0, `partially_paid` if paid_total > 0, else `posted`.

### Auto-matcher (per row, pure function + one batched lookup per file)
1. **Invoice reference**: tokenise `reference`, then look up *all* candidate tokens of the whole file in **one** query against posted / partially_paid invoice numbers of the org. Hit + same currency → account = the invoice's account, allocate `min(amount, outstanding)` to the referenced invoice(s), oldest due date first.
2. Otherwise → `unmatched` with a reason: `no_reference`, `currency_mismatch` (C-D2), `invoice_already_paid`, `prepaid_account` (C-D3), `invoice_void`.
   `payer_name` / `payer_account` are stored for the operator but not used for matching (C-D1).
4. Any remainder on a matched payment → **credit auto-apply** to the account's open invoices, oldest `due_date` first (D12).

Credit auto-apply also runs when an invoice is **posted** (subscriber on `billing.invoice.posted`), consuming available credit oldest-payment-first.

### CSV format (fixed, v1)
```
date,amount,currency,reference,payer_name,payer_account
2026-11-20,123.00,PLN,"Payment for FV/2026/11/0003",ACME Sp. z o.o.,PL61109010140000071219812874
```
- UTF-8, comma-separated, header required, `.` as decimal separator. Max 5,000 rows / 2 MB per upload, processed in one request (demo-grade, D5). Rows with amount ≤ 0 are rejected (refunds are out of scope).
- **Duplicate guard**: `source_ref = sha256(date|amount|currency|reference|payer_account|#occurrence-in-file)`, unique per org. Re-uploading the same file yields only duplicates.

### Sample CSV (demo seed)
Generated from the seeded posted invoices, so numbers and amounts line up:

| Row | Outcome shown |
|---|---|
| Exact amount, invoice number in title | `allocated`, invoice `paid` |
| Half the amount | `allocated`, invoice `partially_paid` |
| Amount + 50, invoice number | invoice `paid`, 50 credit, auto-applied to the next open invoice |
| Two invoice numbers in one title, sum of both | both invoices `paid` |
| No reference, known customer | `unmatched` → operator **assigns to account** → credit auto-applied to the oldest open invoice |
| Invoice number of a prepaid account's top-up receipt | `unmatched` (`prepaid_account`) → **Convert to top-up** → balance credited |
| Unknown payer, junk title | `unmatched` (`no_reference`) |
| EUR payment for a PLN invoice | `unmatched` (`currency_mismatch`) |
| Same line twice | 2nd counted as duplicate (the occurrence index makes both distinct within a file. Re-upload shows duplicates.) |

### Gateway subscriber (changed)
`payment_gateways.payment.captured` → instead of flipping status directly, create a `BillingPayment` (`source=gateway`, the captured amount), allocate it to the invoice, and recompute through the same allocation service. This is the single code path for "paid" (R4.7).

### UI
- **Payments** list page (`backend/billing/payments/page.tsx`): filters for status, account, batch, date range, and an "Upload CSV" button → result summary. Detail page `payments/[id]`: payment fields, match reason, allocations table, actions (Assign account, Allocate, Un-allocate, Ignore / Restore, Convert to top-up, shown only for a prepaid account with a matching currency).
- Invoice detail: a **Payments** section (allocations with links).
- Account detail: AR summary `credit_amount` filled in (from Spec B). A **Payments** section.

---

## Data Models (draft)

### BillingPayment: `billing_payments`
Standard columns + `received_at date`, `amount numeric(18,4)`, `currency_code`, `reference text?`, `payer_name text?`, `payer_account text?`, `source text` (`csv|manual|gateway`), `import_id uuid?`, `bill_account_id uuid?`, `status text`, `unallocated_amount numeric(18,4)`, `match_reason text?`, `source_ref text` (unique per tenant+org), `external_ref text?` (gateway transaction id), `topup_id uuid?` (C-D3).
Indexes: `(tenant_id, organization_id, status)`, `(bill_account_id, status)`, `(import_id)`.

### BillingPaymentAllocation: `billing_payment_allocations`
> **Amended by [Spec D](2026-11-14-billing-credit-debit-memos.md):** build this as **`BillingAllocation` (`billing_allocations`)** with `source_type` (`payment | credit_memo`) + `source_id` instead of `payment_id`, so credit memos reuse the same allocation and credit logic.

Standard columns + `payment_id uuid`, `invoice_id uuid` (FK string to `sales_invoices`), `bill_account_id uuid`, `amount numeric(18,4)`, `currency_code`, `allocated_by text` (`auto|credit|user`), `user_id uuid?`. Soft delete = un-allocate (keeps history).

### BillingPaymentImport: `billing_payment_imports` (C-D4)
Standard columns + `file_name`, `row_count`, `counts jsonb` (`allocated, partially_allocated, matched, unmatched, duplicate, rejected`), `errors jsonb` (row → message), `user_id`.

---

## API Contracts (draft)

| Method + path | Feature |
|---|---|
| `GET /api/billing/payments` | `billing.payment.view` |
| `POST /api/billing/payments` (manual entry) | `billing.payment.manage` |
| `POST /api/billing/payments/import` (multipart CSV) | `billing.payment.import` |
| `GET /api/billing/payment-imports`, `/{id}` | `billing.payment.view` |
| `POST /api/billing/payments/assign` `{ paymentId, billAccountId }` | `billing.payment.manage` |
| `POST /api/billing/payments/convert-to-topup` `{ paymentId, billAccountId }` | `billing.payment.manage` + `billing.topup.create` |
| `POST /api/billing/payments/allocate` `{ paymentId, allocations: [{ invoiceId, amount }] }` | `billing.payment.manage` |
| `POST /api/billing/payments/unallocate` `{ allocationId }` | `billing.payment.manage` |
| `POST /api/billing/payments/ignore` / `restore` | `billing.payment.manage` |
| `GET /api/billing/invoices/{id}` (+ `allocations[]`) | existing |

Events: `billing.payment.created`, `billing.payment.converted_to_topup`, `billing.payment.allocated`, `billing.payment.unallocated`, `billing.invoice.paid`, `billing.invoice.partially_paid`.
Commands are undoable: allocate ↔ un-allocate, ignore ↔ restore, assign ↔ un-assign.

---

## Implementation Plan (draft)
1. **Phase 1, model + allocation service**: entities, migration, `allocationService` (allocate / unallocate / recompute invoice / credit auto-apply) with `withAtomicFlush` and a per-account advisory lock (concurrent imports vs post). Unit tests.
2. **Phase 2, matcher + CSV import**: parser (Zod per row), batched invoice-number lookup, duplicate guard, import entity. Unit tests per sample-CSV row.
3. **Phase 3, gateway subscriber refactor** onto the allocation service. Credit apply on `billing.invoice.posted`. Convert-to-top-up command (BillingTopup with `provider_key = 'bank_transfer'`, `payment_id = BillingPayment.id`, then `captureTopup`, which is idempotent through `source_ref = topup-{paymentId}`).
4. **Phase 4, UI**: Payments list/detail, invoice and account sections, i18n en/pl.
5. **Phase 5, demo**: sample CSV generator in the seed, manual section in `billing-ui-testing.md`, Playwright flow upload → summary → invoice paid.

---

## Risks (draft)

| Risk | Mitigation |
|---|---|
| Concurrent credit auto-apply (import + post at the same time) double-spends credit | Per-account advisory lock around allocation (reuse the `tenantLock` pattern). `unallocated_amount` is updated with a guarded `UPDATE … WHERE unallocated_amount >= ?`. |
| Low auto-match rate (customers often omit the invoice number) | Accepted for v1 (C-D1). The PDF prints "Title: <invoice number>". Payer-IBAN learning is a later improvement. |
| A false-positive invoice match (a token in the title that looks like an invoice number) | Exact match on full invoice number only, currency must match, and every auto allocation can be un-allocated (undoable). |
| Large files block the request | Hard limit of 5k rows (demo-grade). Real bank import later moves to a worker. |
| Allocations drift from the invoice amounts | Always recompute invoice amounts from `Σ allocations` (never increment). Nightly reconcile could reuse the `reconcile-prepaid-balances` worker pattern later. |

---

## Changelog
- 2026-11-14 — Skeleton + design outline from umbrella D5, D6, D9, D12, D15.
- 2026-11-14 — C-Q1..C-Q4 resolved → C-D1..C-D4 (invoice-number matching only, prepaid → unmatched + convert to top-up, import batches).
- 2026-11-14 — Allocation entity generalised to source-typed `BillingAllocation` (Spec D).
- 2026-11-14 — Amended by Spec 0 (billing-owned invoice ledger).

---

## Implementation Status

Plan: [`.ai/runs/2026-11-14-billing-payments/PLAN.md`](../runs/2026-11-14-billing-payments/PLAN.md)

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Model + allocation service | Done | 2026-11-15 | Source-typed `billing_allocations` from day one; per-account blocking advisory lock; amounts always recomputed |
| Phase 2 — Matcher + CSV import | Done | 2026-11-15 | RFC-4180 parser, one batched number lookup per file, duplicate guard with occurrence index |
| Phase 3 — Commands, gateway, credit on post | Done | 2026-11-15 | Reversals are explicit inverse commands (allocate ↔ unallocate, assign ↔ unassign, ignore ↔ restore) — billing does not use the framework undo log |
| Phase 4 — UI | Done | 2026-11-15 | Payments list / detail / import pages, invoice + account Payments sections, en/pl |
| Phase 5 — Demo + docs | Done | 2026-11-15 | `mercato billing payments-sample` CLI (from real posted invoices, not a seed); TC-BILL-009 written, not run (migration not applied) |
