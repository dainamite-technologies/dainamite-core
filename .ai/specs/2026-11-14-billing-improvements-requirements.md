# Billing Improvements — Requirements Collection (umbrella)

**Date**: 2026-11-14
**Status**: Requirements agreed. Specs A/B/C to be written
**Owner**: Mac
**Target package**: `@dainamite/billing` (`packages/billing/`, v0.20.0)
**Related**: [`xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md) (postpaid engine),
[`SPEC-002`](SPEC-002-2026-06-17-prepaid-billing.md) (prepaid balance)

> This is an **umbrella** document. Each workstream gets its own spec once its
> requirements are agreed. This file stays as the index and decision log.

---

## TLDR

| WS | Topic | Spec | In scope now |
|---|---|---|---|
| WS-0 | **Standalone invoice ledger**: billing-owned invoices, numbering, statuses, VAT. No core `sales` | [Spec 0](2026-11-14-billing-standalone-invoice-ledger.md) | Yes, **first** |
| WS-1 | Bill Run cycle semantics: in-advance charging, proration, catch-up by default, multi-cycle test/dry | [Spec A](2026-11-14-billing-cycle-semantics.md) | Yes |
| WS-2 | Invoices: VAT, numbering, due date from payment terms, list filters (overdue), Invoices tab on the account | [Spec B](2026-11-14-billing-invoice-documents.md) | Yes |
| WS-3 | Invoice PDF (built-in template, branded, multi-language) and email | [Spec B](2026-11-14-billing-invoice-documents.md) | Yes |
| WS-4 | Payments: payment register, CSV upload, auto-match to account/invoice, allocation, credit | [Spec C](2026-11-14-billing-payments.md) | Yes (demo-grade import) |
| WS-7 | Billing Account workspace (summary + tabs), B2C person accounts, invoice-language picklist, return-to-account navigation | [Spec E](2026-11-14-billing-account-workspace.md) | Yes (Phase 1 can ship first) |
| WS-8 | Operator feedback round 1: run delete, NET/GROSS entry, prepaid timing + VAT at consumption, settings visibility, Spec E Phases 2–3 | [Spec F](2026-11-15-billing-operator-feedback.md) | Yes |
| WS-5 | Dunning (reminder ladder) | — | **Deferred** |
| WS-6 | Credit / debit memos (manual corrections of posted invoices) | [Spec D](2026-11-14-billing-credit-debit-memos.md) | Yes |
| — | Prepaid | — | **Unchanged** (keep SPEC-002 behaviour) |

Suggested order: **0 → A → B → C → D**. C depends on B, because matching needs `due_date` and `outstanding_amount` to be maintained.

---

## Decisions (2026-11-14)

| # | Decision |
|---|---|
| D1 | Recurring charge timing is **per item**: `in_advance` (default) or `in_arrears`. |
| D2 | Proration is **per recurring item**, `prorate` flag, default `true`. |
| D3 | Every real Bill Run catches up on **all** periods due up to `asOfDate`. The `catchUp` flag is removed. To bill less, run with an earlier date. Test and dry runs simulate every period too. |
| D4 | PDF: one built-in template, tenant logo and details, not editable. Language follows `account.invoice_language`. |
| D5 | Payments: a register of payments, plus a demo-grade CSV upload whose rows become payments that are `matched` or `unmatched` against accounts and invoices. Sample CSV ships with the demo seed. Bank formats (CAMT/MT940) and a real import come later. |
| D6 | Overpayments and partial payments: keep remaining money as account credit. |
| D7 | Dunning deferred. Now: `due_date` on every posted invoice (from account payment terms, adding the field), and an **Overdue** filter on the invoice list. |
| D8 | Prepaid stays as it is. |
| D9 | Payments are a separate `BillingPayment` entity with its own *Payments* page (not a reuse of the prepaid transaction ledger). |
| D10 | Seller/billing settings are **per organization** (`organization_id` + `tenant_id`), so each org in each tenant has its own seller details, IBAN and logo. |
| D11 | Scheduled runs catch up too. One rule for every trigger. |
| D12 | Credit from overpayments and account-only payments is auto-applied to the oldest open invoice (on payment match and on invoice post). |
| D13 | Invoice email: manual "Send" button plus a per-account `auto_send_invoice` flag. Uses the standard `sendEmail()` from `@open-mercato/shared/lib/email/send` (transport via `communication_channels` / `channel_resend`). No custom mail infrastructure. |
| D15 | Payments are **fully detached from core** `SalesPayment` / `SalesPaymentAllocation`. Billing owns `BillingPayment` + source-typed `BillingAllocation`, which drive `paid_total` / `outstanding` / status on billing-owned invoices (Spec 0). |
| D16 | VAT: the tax rate is set on the Billing Item and carried to invoice lines (net / rate / VAT / gross). Fixed in Spec B (today invoices are VAT-less). |
| D17 | Credit and debit memos are billing invoice documents (`metadata.document_type` + reference to the corrected invoice), created **manually** from a posted invoice's page. Not core `SalesCreditMemo`. |
| D18 | Memos get their own **Spec D**, sequenced after Spec C (reuses allocations). |
| D19 | **Billing never records documents in core Open Mercato.** Invoices, memos and receipts live in billing-owned tables with billing-owned numbering. Dependencies on core business modules (`sales`, `dictionaries`, `configs`) are removed. Platform services (auth, directory, events/queue, email, attachments) stay. |
| D20 | Every capability added by these specs is visible on the **Billing Account** page (summary + tabs). The account page is the operator's workspace (Spec E). |
| D21 | Billing accounts can belong to a **company or a person** (B2C). |
| D22 | Invoice language is a **picklist** of template-supported languages, narrowed by `BillingSettings`. |
| D23 | Item and usage pages opened from an account navigate back to that account. |
| D14 | No data-preserving migration for live items. New defaults apply, demo seeds are updated, and all instances are reseeded. |

---

## Current State (verified against code, 2026-11-14)

### Bill Run (`lib/billRunEngine.ts`, `lib/billPeriod.ts`, `lib/itemSelector.ts`)
- Cycles are **per account** (`next_bill_date` + `bill_cycle`). `bill_cycle_anchor` is stored but unused by the engine.
- Billing is **in arrears only**: the period is `[next_bill_date − cycle, next_bill_date − 1]`.
- Catch-up needs `mode=real` + `triggeredBy=manual` + `catchUp=true`. The UI never sends `catchUp`. Scheduled runs bill 1 cycle.
- Test and dry runs always stop after 1 cycle (`break`, because state is not advanced).
- Mid-cycle recurring starts and ends are skipped silently. Skip reasons are computed by the selector but discarded.
- The CPQ connector creates accounts with `next_bill_date = activation + 1 month`.

### Invoices
- Written to `core/sales` `sales_invoices` with `metadata.bill_account_id / bill_period_* / bill_run_id / test_run`.
- `GET /api/billing/invoices?billAccountId=` exists but is unused on the account page.
- `due_date` is never set. `paid_total_amount` and `outstanding_amount` are never maintained.
- No PDF, no email. Core only ships quote emails. Available: `pdf-lib`, and `sendEmail()` with attachments in `@open-mercato/shared/lib/email/send`.
- `directory.Organization` has `logo_url` only (no address, VAT ID, or bank details).

### Payments
- `posted → paid` only via `payment_gateways.payment.captured` with `paymentId == invoice.id`.
- Core `SalesPayment` is tied to **orders**, not invoices. It is unsuitable as-is (and billing must not depend on order-only semantics).

---

## WS-1 — Bill Run cycle semantics (Spec A)

**Model.** The account's `next_bill_date` is the **bill date** D. A run with `asOfDate ≥ D` produces one invoice for bill date D containing:
- `in_advance` recurring items → period `[D, D + cycle − 1]`
- `in_arrears` recurring items → period `[D − cycle, D − 1]`
- usage → `[D − cycle, D − 1]` (always in arrears)
- `one_time` → unchanged (first bill date whose window overlaps)

The engine then advances D by one cycle and repeats while `D ≤ asOfDate` (hard cap stays at 60).

**Worked example (the operator's test).** Item monthly, in advance, starting 2026-11-14. Account `next_bill_date = 2026-11-14`. Run as of 2027-02-01 → 3 invoices:
Nov 14–Dec 13, Dec 14–Jan 13, Jan 14–Feb 13.

**Requirements**
- R1.1 Add `BillingItem.charge_timing` (`in_advance | in_arrears`, default `in_advance`) and `BillingItem.prorate` (bool, default `true`). Both are editable in ItemForm.
- R1.2 Proration: when an item's start or end falls inside the period, charge `amount × days_active / days_in_period` (calendar days, half-up to 2dp) and label the line "(prorated d/n days)". With `prorate=false`, keep today's skip behaviour.
- R1.3 Remove `catchUp` from the engine, command, and API. The API accepts and ignores it for one minor version, with a deprecation note in CHANGELOG.
- R1.4 Test and dry modes iterate over **in-memory** copies of `next_bill_date` and `billed_to_date`, producing one draft (test) or one preview (dry) per period. Nothing about the account is persisted.
- R1.5 Persist item skip reasons in `BillingRunOutcome.warnings.skipped_items`.
- R1.6 CPQ connector: set the default `next_bill_date` to the subscription **start date** (not +1 month), so in-advance billing starts at activation.
- R1.7 Anti-duplicate: the `billed_to_date` watermark stays the guard. Switching an item between timings must never bill a period twice (needs a unit test).

## WS-2 — Invoices: due date, filters, account tab (Spec B)

- R2.1 Add `BillingAccount.payment_terms_days` (int, nullable). The org default lives in `BillingSettings.default_payment_terms_days` (default 14). At **post**, set `due_date = issue_date + terms` and `outstanding_amount = grand_total_gross`.
- R2.2 Invoice list filters: status, account, period, **Overdue** (`status in (posted, partially_paid) AND due_date < today AND outstanding > 0`), Test/Real. Columns: due date, outstanding, days overdue.
- R2.3 Add an **Invoices** section on `accounts/[id]` (postpaid), using the existing `billAccountId` filter, plus a summary showing open AR, overdue, and available credit (credit comes from WS-4).
- R2.4 Add a `partially_paid` invoice status (dictionary entry seeded in `setup.ts`).

## WS-3 — Invoice PDF and email (Spec B)

- R3.1 Server-side render via `pdf-lib` (already installed, so no headless browser). The built-in template covers: seller block, buyer block (`invoice_address`, `tax_id`), invoice no / issue / due / period, lines, VAT summary, totals, payment instructions (IBAN + "reference: invoice number"), and logo.
- R3.2 Labels are translated through billing i18n (en, pl) by `invoice_language`. Money and dates are formatted per locale.
- R3.3 `GET /api/billing/invoices/{id}/pdf`. Drafts render with a "DRAFT" watermark. A posted invoice's PDF is generated once at post and stored as an attachment, so it stays immutable.
- R3.4 `POST /api/billing/invoices/{id}/send` emails the PDF to `invoice_email` via `sendEmail()` (attachment). Auto-send on post when `account.auto_send_invoice`. Delivery is logged on the invoice.
- R3.5 New `BillingSettings` (one per organization): legal name, address, VAT ID, IBAN/BIC, bank name, footer, logo (attachment, falls back to `directory.Organization.logo_url`), default payment terms. Shown on a settings page (`pageContext: 'settings'`).

## WS-4 — Payments (Spec C)

**Why not reuse `BillingAccountTransaction`:** it is the **prepaid balance ledger**. Its invariant is `balance = SUM(amount)`, and `bill_account_id` and `balance_after` are both NOT NULL. An unmatched bank line has no account, and a postpaid payment must not move a prepaid balance. Mixing the two would break SPEC-002's core invariant. So we add a separate register.

- R4.1 New entity `BillingPayment`: `received_at`, `amount`, `currency_code`, `reference` (bank title), `payer_name`, `payer_account` (IBAN), `source` (`csv | manual | gateway`), `import_batch_id`, `bill_account_id?`, `status` (`unmatched | matched | partially_allocated | allocated | ignored`), `unallocated_amount`, `source_ref` (idempotency: hash of the CSV row).
- R4.2 New entity `BillingPaymentAllocation`: payment → invoice, amount. Each allocation updates the invoice's `paid_total_amount` and `outstanding_amount`, and its status (`partially_paid` / `paid`).
- R4.3 CSV upload (`POST /api/billing/payments/import`, multipart) with fixed columns `date,amount,currency,reference,payer_name,payer_account`. It returns a batch summary (matched / unmatched / duplicates).
- R4.4 Auto-match by invoice number in `reference` only (Spec C, C-D1). Otherwise `unmatched`. Prepaid-account payments → `unmatched` + manual "Convert to top-up" (C-D3).
- R4.5 Manual actions: assign to account, allocate to invoice(s), un-allocate, ignore.
- R4.6 Credit: `unallocated_amount` on matched payments = available account credit, auto-applied oldest-invoice-first.
- R4.7 The existing gateway subscriber also creates a `BillingPayment` + allocation, so there is one source of truth for "paid". No core `SalesPayment` is involved (D15).
- R4.8 Sample `payments-sample.csv` generated by the demo seed against seeded invoices. It mixes exact matches, partial, overpayment, account-only, unmatched, and a duplicate row.

## WS-5 — Dunning (deferred)
Placeholder. Builds on R2.1 (`due_date`) and R4.2 (`outstanding_amount`).

---

## Changelog
- 2026-11-14 — Skeleton + current-state audit.
- 2026-11-14 — Round 1 decisions D1–D8 folded in. WS split into Specs A/B/C. Dunning deferred.
- 2026-11-14 — Round 2 decisions D9–D14. Spec A drafted: [`2026-11-14-billing-cycle-semantics.md`](2026-11-14-billing-cycle-semantics.md).
- 2026-11-14 — D15 (payments detached from core), D16 (item-level VAT). Spec B drafted.
- 2026-11-14 — Spec B: customer tax treatment dropped. Spec C skeleton drafted.
- 2026-11-14 — Spec C decisions C-D1..C-D4. All three specs drafted.
- 2026-11-14 — D17–D18: credit/debit memos → Spec D drafted. Spec C allocations become source-typed.
- 2026-11-14 — D19: billing decoupled from core sales → Spec 0 (runs first). Spec D: no void.
- 2026-11-14 — Spec 0 decisions E-D1..E-D3. All five specs drafted, no open questions.
- 2026-11-14 — D20–D23: account workspace, B2C, language picklist, navigation → Spec E drafted.
- 2026-11-14 — Spec E decisions E2-D1..E2-D3. All six specs drafted, no open questions.
- 2026-11-15 — Operator feedback round 1 → Spec F drafted (F-D1..F-D5). Spec E Phases 2–3 move into Spec F.
