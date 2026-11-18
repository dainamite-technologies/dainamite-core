# Execution plan — Payments: register, CSV import, auto-matching, allocation, credit (Spec C)

Source spec: .ai/specs/2026-11-14-billing-payments.md (C-D1..C-D4; umbrella D5, D6, D9, D12, D15), amended by Spec 0 (billing-owned ledger) and Spec D (source-typed allocations)
Base branch: feat/billing-account-workspace (Spec E1 + A + 0 + B, commit c8a1bf7)
Packages: `@dainamite/billing` (minor)
Next: Spec D builds on this plan (see `.ai/runs/2026-11-14-billing-credit-debit-memos/PLAN.md`).

## Resume protocol (read first when continuing)

Work top-down through the task table. After each step: update its status here (`todo → done`), keep the code compiling (`cd packages/billing && yarn typecheck`) and the billing suite green (`npx jest --config jest.config.cjs packages/billing` from repo root). Never commit (the user commits). Never apply migrations. Hand-written migrations only (package modules are not diffed by `yarn mercato db generate`).

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | Entities `BillingPayment`, `BillingAllocation` (source-typed), `BillingPaymentImport` + migration + entity ids/registry | done |
| 1 | 1.2 | Validators: payment statuses / sources / match reasons, manual create, assign, allocate, unallocate, ignore/restore, convert, list queries | done |
| 1 | 1.3 | `lib/accountLock.ts` — blocking per-account advisory xact lock | done |
| 1 | 1.4 | `lib/allocation.ts` — allocate / unallocate / recompute invoice / credit auto-apply (pure planner + DB service) | done |
| 1 | 1.5 | Unit tests for 1.3–1.4 (planner math, recompute statuses, credit oldest-first, guarded unallocated update) | done |
| 2 | 2.1 | `lib/paymentCsv.ts` — CSV parser (RFC-4180 quotes, header check, Zod per row, limits, source_ref with occurrence index) | done |
| 2 | 2.2 | `lib/paymentMatcher.ts` — token extraction + pure matcher over a batched invoice lookup | done |
| 2 | 2.3 | `lib/paymentImport.ts` + command `billing.payments.import` — batch record, duplicates, match, allocate, counts | done |
| 2 | 2.4 | Unit tests: one per sample-CSV outcome, parser edge cases, duplicates | done |
| 3 | 3.1 | Commands: create manual, assign / unassign, allocate / unallocate, ignore / restore (undoable) | done |
| 3 | 3.2 | Command `billing.payments.convert_to_topup` (C-D3) via `captureTopup` | done |
| 3 | 3.3 | Gateway subscriber `payment-captured-to-paid` → BillingPayment + allocation (single "paid" path) | done |
| 3 | 3.4 | Subscriber `invoice-apply-credit` on `billing.invoice.posted` (credit auto-apply) | done |
| 3 | 3.5 | Events + ACL features + setup grants; account summary `credit_amount` | done |
| 3 | 3.6 | Unit tests for commands / subscribers | done |
| 4 | 4.1 | API routes: payments list/detail/create, import (multipart), imports list/detail, assign, allocate, unallocate, ignore, restore, convert-to-topup | done |
| 4 | 4.2 | Invoice detail API: `allocations[]` | done |
| 4 | 4.3 | UI: Payments list (+ upload dialog + summary), Payment detail (actions), Import detail | done |
| 4 | 4.4 | UI: invoice Payments section, account Payments section, summary credit card | done |
| 4 | 4.5 | i18n en/pl | done |
| 5 | 5.1 | Demo seed: posted invoices + `payments-sample.csv` generator (CLI) covering every outcome | done |
| 5 | 5.2 | Integration test TC-BILL-009 (upload → summary → invoice paid / partially paid / credit) | done |
| 5 | 5.3 | Docs: MIGRATION.md, changeset, manual §8 Payments, spec status | done |
| 5 | 5.4 | Gate: build:packages, generate, typecheck ×3, test, build | done (app build deferred — dev server running) |

## Goal

Money-in is recorded in billing's own register. Bank CSV uploads are matched to invoices by number, invoices move `posted → partially_paid → paid` from allocations, overpayments become account credit that is applied to the oldest open invoice, and operators fix the rest by hand. Gateway captures go through the same path.

## Non-goals

- Refunds / negative payments (rows with amount ≤ 0 are rejected). FX. Payer-IBAN learning (C-D1). Dunning.
- Real bank formats (MT940, camt.053) and background import workers (5k-row, one-request limit).
- Credit memos as allocation sources — the model supports them (`source_type`), Spec D adds the behaviour.

## Decisions (from spec + this plan)

| # | Decision |
|---|---|
| P-D1 | Allocations are source-typed from day one: `billing_allocations (source_type 'payment'\|'credit_memo', source_id)`. Spec D only adds the credit-memo source. |
| P-D2 | Invoice amounts are always **recomputed** from `Σ active allocations` (never incremented): `paid_total`, `outstanding = gross − paid_total − credited_total` (credited_total stays 0 until Spec D), status `paid` / `partially_paid` / `posted`. Applies to `invoice` and `debit_memo` documents. |
| P-D3 | Concurrency: every allocation change for an account runs inside `withAccountLock` (blocking `pg_advisory_xact_lock(hashtext('billing-ar:' || account_id))`), so import, post-credit and manual actions serialise per account. `unallocated_amount` is additionally updated with a guarded `UPDATE … WHERE unallocated_amount >= ?`. |
| P-D4 | Un-allocate = soft delete (`deleted_at`, `deallocated_by_user_id`), history kept. |
| P-D5 | Credit auto-apply order: open invoices by `due_date` asc (nulls last), then `issue_date`, then `number`; credit sources consumed oldest `received_at` first. |
| P-D6 | Invoice number tokens: the matcher extracts tokens `[A-Za-z0-9/_.-]{3,64}` from the reference (trailing punctuation stripped, case-insensitive compare), looks up all tokens of the file in **one** query (`upper(number) = ANY(?)`, posted / partially_paid / paid, document types invoice / debit_memo / receipt). Exact full-number match only. |
| P-D7 | `source_ref = sha256(tenant|org|date|amount4|currency|reference|payer_account|#occurrence)`; unique partial index per (tenant, org). A duplicate row is counted, not stored. |
| P-D8 | Receipts (prepaid top-up receipts) referenced in a title resolve the account; a prepaid account → `unmatched/prepaid_account` (C-D3). |
| P-D9 | Gateway capture (`payment_gateways.payment.captured`, `paymentId = invoice.id`): idempotent on `external_ref = transactionId ?? paymentId` (unique per org when not null). Captured amount comes from the payload (`amount`) when present, else the invoice outstanding. |
| P-D10 | Payments page lives at `/backend/billing/payments` (list + `[id]` detail) in the Billing sidebar group; import batches at `/backend/billing/payments/imports/[id]` (no separate nav entry; list filter by batch). |

## Data model

### `billing_payments` — `BillingPayment`
Standard columns (`id`, `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`) +
`received_at date not null`, `amount numeric(18,4) not null` (> 0), `currency_code text`, `reference text null`, `payer_name text null`, `payer_account text null`, `source text` (`csv|manual|gateway`), `import_id uuid null`, `bill_account_id uuid null`, `status text` (`unmatched|matched|partially_allocated|allocated|ignored|converted_to_topup`), `unallocated_amount numeric(18,4)`, `match_reason text null` (`no_reference|currency_mismatch|invoice_already_paid|prepaid_account|manual`), `source_ref text not null`, `external_ref text null`, `topup_id uuid null`, `metadata jsonb null`.
Indexes: `(tenant_id, organization_id, status)`, `(bill_account_id, status)`, `(import_id)`, unique `(tenant_id, organization_id, source_ref) where deleted_at is null`, unique `(tenant_id, organization_id, external_ref) where external_ref is not null`.

### `billing_allocations` — `BillingAllocation`
Standard columns + `source_type text` (`payment|credit_memo`), `source_id uuid`, `invoice_id uuid`, `bill_account_id uuid`, `amount numeric(18,4)` (> 0), `currency_code text`, `allocated_by text` (`auto|credit|user|gateway`), `user_id uuid null`, `deallocated_by_user_id uuid null`.
Indexes: `(source_type, source_id)`, `(invoice_id)`, `(bill_account_id)` — all `where deleted_at is null`.

### `billing_payment_imports` — `BillingPaymentImport`
Standard columns + `file_name text`, `row_count int`, `counts jsonb` (`allocated, partially_allocated, matched, unmatched, duplicate, rejected`), `errors jsonb` (`[{ row, message }]`, capped at 200), `user_id uuid null`.

Migration `Migration20261117000000_billing_payments.ts` (hand-written, with `down`). Entity ids: `payment`, `allocation`, `paymentImport` → `node scripts/generate-entity-registry.mjs`, update `entityRegistry.test.ts`.

## Step details

### 1.3 `lib/accountLock.ts`
`withAccountLock(em, { tenantId, billAccountId }, fn(tem))` → `em.transactional(async tem => { await tem.execute('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['billing-ar:'+tenant+':'+account]); return fn(tem) })`. Blocking (unlike `tenantLock`'s try-lock). Lock several accounts in sorted order when an operation spans accounts (matcher allocating one payment to two accounts never happens: a payment belongs to one account).

### 1.4 `lib/allocation.ts`
- **Pure:**
  - `planAllocation(amount, invoices[{id, outstanding, dueDate, issueDate, number}])` → `[{invoiceId, amount}]` oldest-first, never exceeding outstanding; returns remainder.
  - `recomputeInvoiceAmounts({ totalGross, creditedTotal, allocationsSum, status, documentType })` → `{ paidTotal, outstanding, status }` (never touches `draft`; `credited` set by Spec D).
  - `paymentStatusFor({ billAccountId, amount, unallocated, status })` → `matched | partially_allocated | allocated` (keeps `ignored` / `converted_to_topup` / `unmatched`).
- **Service (all inside `withAccountLock`):**
  - `allocate(tem, { source, invoiceId, amount, by, userId })` — validates same account + currency, invoice open, amount ≤ min(source unallocated, invoice outstanding); inserts allocation; guarded `UPDATE billing_payments SET unallocated_amount = unallocated_amount - ? WHERE id = ? AND unallocated_amount >= ?` (0 rows → 409 `billing.payment.insufficient_unallocated`); recomputes invoice + payment status.
  - `unallocate(tem, { allocationId, userId })` — soft delete, restore unallocated, recompute both.
  - `recomputeInvoice(tem, invoiceId)` — `SELECT COALESCE(SUM(amount),0) FROM billing_allocations WHERE invoice_id = ? AND deleted_at IS NULL AND source_type = 'payment'` (+ credit_memo bucket for Spec D), write `paid_total` / `outstanding` / `status`.
  - `applyAccountCredit(tem, { tenantId, organizationId, billAccountId })` — sources = payments of the account with `unallocated_amount > 0` and status in (matched, partially_allocated) oldest first; invoices = open receivables oldest due first; allocate pairwise with `allocated_by = 'credit'`. Returns allocations made.
  - `getAccountCredit(em, account)` → `Σ unallocated_amount` of matched / partially_allocated payments (Spec D adds credit-memo unallocated).
- Events after commit: `billing.payment.allocated` / `unallocated`, `billing.invoice.paid` / `partially_paid` when the status changes.

### 2.1 `lib/paymentCsv.ts`
Pure. `parsePaymentCsv(text)` → `{ rows: [{ line, receivedAt, amount, currency, reference, payerName, payerAccount }], errors: [{ line, message }] }`. Header must equal `date,amount,currency,reference,payer_name,payer_account` (trimmed, case-insensitive, BOM stripped). Quoted fields with `""` escapes and commas. Zod per row: ISO date, amount `^\d+(\.\d{1,4})?$` > 0, currency 3 letters (upper-cased). Limits: 5,000 data rows, 2 MB (checked by the route too). `paymentSourceRef(scope, row, occurrence)` (P-D7).

### 2.2 `lib/paymentMatcher.ts`
- `extractInvoiceTokens(reference)` (P-D6).
- `matchPayment(row, lookup: Map<UPPER(number), {invoiceId, billAccountId, currency, outstanding, status, documentType, billingMode, dueDate, issueDate}>)` → `{ outcome: 'allocate' | 'unmatched', billAccountId?, invoiceIds[], reason? }`:
  - no token hit → `unmatched/no_reference`;
  - hits on different accounts → `unmatched/no_reference` (ambiguous; operator assigns);
  - receipt / prepaid account → `unmatched/prepaid_account` (account kept for the convert action);
  - currency ≠ → `unmatched/currency_mismatch`;
  - all referenced invoices settled → `matched` + reason `invoice_already_paid` (amount becomes credit, auto-applied).
  - otherwise allocate to referenced open invoices oldest-first, remainder → credit auto-apply.

### 2.3 Import
Command `billing.payments.import` `{ fileName, content }`: parse → create `BillingPaymentImport` → load existing `source_ref`s for the file in one query → one batched invoice lookup → per row create `BillingPayment` (status/reason) → per affected account `withAccountLock`: allocate referenced invoices, then `applyAccountCredit` → finalize counts (`allocated`, `partially_allocated`, `matched`, `unmatched`, `duplicate`, `rejected`) and errors. Returns the import summary. Route: `POST /api/billing/payments/import` multipart (`file`) or JSON `{ fileName, content }`; 413 over 2 MB.

### 3.1 Commands (undoable via `extractUndoPayload`)
`billing.payments.create` (manual; status `matched` when `billAccountId` given → credit auto-apply, else `unmatched/manual`), `billing.payments.assign` / undo = unassign (only when nothing allocated), `billing.payments.allocate` `{ paymentId, allocations[{invoiceId, amount}] }` / undo = unallocate created rows, `billing.payments.unallocate` `{ allocationId }` / undo = re-allocate, `billing.payments.ignore` / `restore` (only with zero allocations).

### 3.2 Convert to top-up
`{ paymentId, billAccountId }`: account must be prepaid, same currency, payment `unmatched` and unallocated. Creates `BillingTopup` (`provider_key = 'bank_transfer'`, `payment_id = payment.id`, `source_ref = topup-{paymentId}`, status pending) then `captureTopup(em, { topup, account, taxRate: settings.topupTaxRate })`; payment → `converted_to_topup`, `topup_id`, `unallocated_amount = 0`. Idempotent on `source_ref`.

### 3.3 Gateway subscriber
Rewrite `subscribers/payment-captured-to-paid.ts`: billing invoice by `id = paymentId` (unchanged discovery) → find-or-create `BillingPayment{ source: 'gateway', external_ref }` → `withAccountLock` allocate `min(amount, outstanding)` with `allocated_by = 'gateway'` → remainder credit. Re-delivery → existing payment found → no-op.

### 3.4 Credit on post
`subscribers/invoice-apply-credit.ts` (`billing.invoice.posted`, persistent, id `billing-invoice-apply-credit`): `withAccountLock` → `applyAccountCredit`. (Spec D adds `billing.debit_memo.posted`.)

### 3.5 Events / ACL / summary
- Events: `billing.payment.created`, `billing.payment.allocated`, `billing.payment.unallocated`, `billing.payment.converted_to_topup`, `billing.invoice.paid`, `billing.invoice.partially_paid`, `billing.payment_import.completed`.
- ACL: `billing.payment.view`, `billing.payment.manage`, `billing.payment.import` (admin via `billing.*`, `billing_admin` via all, finance user gets `billing.payment.view`). `setup.test.ts` count +3.
- `lib/accountSummary.ts`: `credit_amount = getAccountCredit` (one extra aggregate query).
- `lib/accountStatus.getPostpaidOutstanding` already sums `outstanding` → accurate automatically.

### 4.x API + UI
- Routes per the spec's API table (hand-written SQL lists like the invoice list; commands for writes; mutation guards on custom write routes, see `api/invoices/[id]/send/route.ts`).
- `GET /api/billing/invoices/{id}` adds `allocations[]` `{ id, source_type, source_id, source_label (payment reference / memo number), amount, allocated_by, created_at }`.
- Payments list: `DataTable` (status, account, batch, date range, search reference / payer), **Upload CSV** dialog (file input, Cmd/Ctrl+Enter, Escape) → import summary dialog with counts + link to the batch filter. Detail page: fields, match reason, allocations table (un-allocate row action), actions per status (Assign account select, Allocate dialog listing open invoices of the account with editable amounts, Ignore / Restore, Convert to top-up).
- Invoice detail: **Payments** section (allocations). Account page: **Payments** section (payments of the account) + credit stat now real.
- Reuse the `InvoicesTable` patterns (shared formatters); new `components/PaymentsTable.tsx` shared by the list and account section.

### 5.1 Demo
`lib/seeds/paymentsSample.ts`: `buildPaymentsSampleCsv({ invoices, prepaidReceipt, currencies })` (pure) produces the 9 rows of the spec's sample table from given posted invoices. CLI `yarn mercato billing payments-sample --org <id>` (in `cli.ts`) writes `payments-sample.csv`; the demo seed posts two invoices per demo postpaid account so the sample has targets. Unit-tested.

### 5.2 Integration test TC-BILL-009
Self-contained: settings → account + item → run → post two invoices → upload a CSV built in the test (exact, half, overpay with two numbers, junk, EUR) → assert summary counts, invoice statuses, account summary credit, re-upload = all duplicates.

## Risks

| Risk | Mitigation |
|---|---|
| Double-spent credit (import vs post vs manual) | Per-account blocking advisory lock + guarded unallocated update; amounts always recomputed from allocations. |
| False-positive matches | Exact full-number match, currency check, ambiguous multi-account hits → unmatched, every auto allocation is un-allocatable. |
| Large uploads | 5k rows / 2 MB hard limits; one batched lookup per file; per-account transactions keep locks short. |
| Gateway double capture | Unique `external_ref` per org + find-or-create. |
| Spec D rework | Source-typed allocations and the `credited_total` term are in place from step 1.1. |

## Completion notes (2026-11-15)
- All steps done. Gate: build:packages, typecheck (billing, connector, app), 1552 unit tests green. `yarn build` deferred while the dev server is running (shared `.mercato/next`); run it with dev stopped.
- Not run: TC-BILL-009 (needs the Spec E/A/0/B/C migrations applied).
- Deviations: reversals are explicit inverse commands (billing does not use the framework undo log); the demo CSV is generated by `mercato billing payments-sample` from real posted invoices instead of the seed posting invoices; credit-memo sources are already handled by the allocation service (Spec D only adds the post flow).
