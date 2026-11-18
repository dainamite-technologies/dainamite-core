# Billing — Invoice Documents: VAT, Numbering, Due Date, Overdue, Account Invoices, PDF and Email (Spec B)

**Date**: 2026-11-14
**Status**: Draft. Decisions agreed, ready for implementation planning review.
**Owner**: Mac
**Target**: `@dainamite/billing` (minor bump, after Spec A), `@dainamite/cpq-billing-connector` (tax rate passthrough)
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md) (WS-2, WS-3, decisions D4, D7, D10, D13)
**Depends on**: [Spec A](2026-11-14-billing-cycle-semantics.md) (invoice `bill_date`, line service periods, proration/credit lines)

> **Amended by [Spec 0](2026-11-14-billing-standalone-invoice-ledger.md):** invoices are billing-owned (`billing_invoices`). Every reference below to `sales_invoices`, the core `salesDocumentNumberGenerator`, the `sales.invoice_status` dictionary or the core tax service is replaced by the billing equivalents described in Spec 0 ("Impact on Specs A–D"). Number formats move to the settings page.

---

## TLDR

Make billing invoices real, sendable documents:

1. **VAT**: a tax rate on every Billing Item, carried to each invoice line (net, rate, VAT, gross). Invoice totals and the PDF show a VAT summary by rate. *(Today every billing invoice is VAT-less. See Problem.)*
2. **Gap-free numbering**: drafts get a temporary `DRAFT-…` number. The real sequence number is assigned at **post**.
3. **Billing settings per organization**: seller details, bank account, logo, default payment terms, default tax rate.
4. **Due date and amounts at post**: `due_date = issue_date + payment terms`, `outstanding_amount = grand_total_gross`.
5. **Overdue** is computed (no stored status). It becomes an invoice-list filter plus columns. A `partially_paid` status is seeded for Spec C.
6. **Invoices section on the Billing Account** page, plus an AR summary.
7. **PDF**: one built-in branded template, en/pl by `invoice_language`, rendered with `pdf-lib`. Drafts get a watermarked preview. The posted PDF is frozen as an attachment.
8. **Email**: a "Send" button plus an `auto_send_invoice` account flag, via the standard `sendEmail()` (`@open-mercato/shared/lib/email/send`).

---

## Design Decisions

| # | Decision |
|---|---|
| B-D1 | The tax rate lives on the **Billing Item** (`tax_rate`, percent). It is snapshotted onto each invoice line as net / rate / VAT / gross. If an item is created without a rate, it takes `BillingSettings.default_tax_rate` **at creation time** (stored on the item, not looked up live, so changing the default never silently re-prices existing subscriptions). |
| B-D2 | VAT is calculated at **draft creation** (not at post), so drafts and previews show true totals. Rounding is **per line**, half-up to 2 dp. The invoice tax total is the sum of line VAT. The PDF shows a VAT summary grouped by rate. |
| B-D3 | Fixed inside this spec as Phase 1 (the PDF depends on it). |
| B-D4 *(delivered by Spec 0)* | Drafts get a `DRAFT-<short-uuid>` number. The real sequence number (core `salesDocumentNumberGenerator`) is assigned at **post**. Test drafts keep `TEST-…` and are never numbered. |
| B-D5 | Draft PDF preview is allowed, with a diagonal "DRAFT" watermark. Never stored. |
| B-D6 | Overdue is **computed**: `status ∈ {posted, partially_paid} AND due_date < today AND outstanding_amount > 0`. No worker until dunning. |
| B-D7 | Payments (Spec C) are **fully detached from core** `SalesPayment` / `SalesPaymentAllocation`. Billing owns its payment register and allocations, and maintains `paid_total_amount` / `outstanding_amount` / status on the `sales_invoices` rows it already owns. |
| B-D8 | Prepaid top-up receipts keep their existing rate source (`prepaid.topup_tax_rate` config). Prepaid is unchanged (D8). |
| B-D9 | **No customer-level tax treatment** (reverse charge, exempt, export) in this spec. The item rate is the only source. A customer needing 0% gets items at 0%. Known limitation, revisit when a B2B cross-border customer needs it. |

---

## Problem Statement

Verified against v0.20.0:

| Today | Effect |
|---|---|
| `invoiceWriter` writes `tax_rate = 0` and gross = net. Its comment says the tax service runs on POST, but `billing.invoices.post` only flips the status. | **Every postpaid billing invoice is VAT-less.** It isn't a valid invoice in PL/EU, and the PDF would expose that. |
| The real sequence number is taken at draft creation. Deleting or wiping drafts leaves holes. | Gaps in invoice numbering, which PL accounting rules flag. |
| `due_date`, `paid_total_amount`, `outstanding_amount` are never set | No due date on documents, no overdue view, nothing for payments to reduce. |
| No seller data anywhere (`directory.Organization` has only `logo_url`) | Nothing to print in the seller block or payment instructions. |
| Invoice list: status and test-run filters only. Account page: no invoices. | Operators can't see what a customer owes. |
| No PDF, no email | Invoices can't reach customers. |

---

## Proposed Solution

### 1. VAT
- `BillingItem.tax_rate` numeric(7,4), not null. Validators: `0 ≤ rate ≤ 100`.
- `InvoiceLineDescriptor` gains `taxRate`. The writer computes `taxAmount = round(net × rate / 100)`, `gross = net + tax`, and `unitPriceGross` likewise. Line `tax_rate` / `tax_amount` / `total_gross_amount` are written to `sales_invoice_lines`. Invoice `tax_total_amount` and `grand_total_gross_amount` are summed.
- Usage lines use the usage item's rate. Proration and credit lines (Spec A) inherit their item's rate.
- Manual draft edits (`add-line` / `edit-line`) accept `taxRate`, defaulting to the org default.
- The CPQ connector passes the CPQ charge's tax rate when it has one. Otherwise the default applies.

### 2. Numbering
- Writer: real mode → `DRAFT-<8 hex>`. Test mode → `TEST-…` (unchanged).
- Post command: `salesDocumentNumberGenerator.generate({ kind: 'invoice' })` inside the same atomic flush as the status flip. The draft number is kept in `metadata.draft_number`.

### 3. Billing settings (per organization)

> The `BillingSettings` entity is created in **Spec 0** (it carries the prepaid settings, E-D2, and the number-series formats). This spec adds the seller / payment / PDF fields below.

| Field | Notes |
|---|---|
| `legal_name`, `address` (jsonb: line1, line2, city, postal_code, country) | Seller block |
| `tax_id` | Seller VAT ID |
| `bank_name`, `iban`, `bic` | Payment instructions |
| `invoice_footer` | Free text (registration court, share capital…) |
| `logo_attachment_id?` | Uploaded through `attachments`. Falls back to `directory.Organization.logo_url`. |
| `default_payment_terms_days` | int, default 14 |
| `default_tax_rate` | numeric, default 23 |
| `email_subject_template`, `email_body_template`? | **Not in v1.** Fixed i18n texts. |

Settings page: `backend/billing/settings/page.tsx`, `pageContext: 'settings'`, `navHidden: true`. A missing settings row is lazily created with defaults. Posting is **blocked** (409 `billing.settings.incomplete`) until `legal_name`, `address`, `tax_id` and `iban` are filled. A posted invoice must be printable.

### 4. Post flow (changed)
`draft → posted` in one atomic flush:
1. assign the real number
2. `issue_date = today`, `due_date = issue_date + (account.payment_terms_days ?? settings.default_payment_terms_days)`
3. `paid_total_amount = 0`, `outstanding_amount = grand_total_gross`
4. status → `posted`

After commit: render the PDF and store it as an attachment (`createAttachmentFromBuffer`, entity `sales:sales_invoice`, record = invoice id), set `metadata.pdf_attachment_id`, then emit `billing.invoice.posted`. If rendering fails, the post is **not** rolled back: the PDF is rendered lazily on the first download and the failure is logged.

### 5. Email
- `POST /api/billing/invoices/{id}/send` (posted only): loads the frozen PDF and calls `sendEmail({ to: account.invoice_email, subject, react: <InvoiceEmail/>, attachments: [{ filename: '<number>.pdf', content: base64, contentType: 'application/pdf' }], tenantId, organizationId })`.
- Subscriber `billing.invoice.posted` → auto-send when `account.auto_send_invoice`. It is persistent and idempotent (skips if `deliveries` already has a `sent` entry for that number).
- Each attempt appends `metadata.deliveries[] = { at, to, status: 'sent'|'failed', error? , trigger: 'manual'|'auto' }`. The invoice detail shows the delivery history and a "Resend" button.
- Emits `billing.invoice.sent` / `billing.invoice.send_failed`.
- Placeholder emails (`@invalid.local`, created by the connector) are refused with 422 `billing.invoice.email_invalid`.

### 6. PDF template (built-in, `lib/pdf/invoiceTemplate.ts`)
A4, single template, `pdf-lib` with an embedded Unicode font (Polish diacritics). Sections: logo + seller block | buyer block (`invoice_address`, `tax_id`) | number, issue date, due date, bill date and service period | lines table (description incl. service period, qty, unit net, VAT %, net, VAT, gross) | VAT summary by rate | totals | payment instructions (IBAN, BIC, "Title: <invoice number>", which Spec C's matcher relies on) | footer | page numbers. Labels come from billing i18n by `invoice_language` (en, pl, falling back to en). Money and dates use `Intl` with that locale. Tests check structure (text extraction via `pdfjs-dist`), not pixels.

### 7. Invoice list and account page
- `GET /api/billing/invoices` adds the filters `overdue=true`, `dueFrom`, `dueTo`, `billAccountId` (exists), and `status` gains `partially_paid`. Response adds `due_date`, `outstanding_amount`, `days_overdue`.
- Invoice list: an Overdue filter preset, columns for due date / outstanding / days overdue (red when > 0), and a PDF download row action.
- Account detail (postpaid): an **Invoices** section (DataTable, paginated, linked to the invoice detail), plus an AR summary card from `GET /api/billing/accounts/{id}/ar-summary` → `{ open_amount, overdue_amount, overdue_count, credit_amount }`. `credit_amount` is 0 until Spec C.
- Account form: `payment_terms_days`, `auto_send_invoice`.
- Item form: `tax_rate` (prefilled with the org default).

---

## Data Models

### BillingSettings (new): table `billing_settings`
Standard columns (`id`, `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`) + the fields in §3. Unique `(tenant_id, organization_id)` where `deleted_at is null`.

### BillingItem (+)
`tax_rate numeric(7,4) not null default 0` (the application layer always sets it from settings at create).

### BillingAccount (+)
`payment_terms_days int null`, `auto_send_invoice boolean not null default false`.

### Invoice metadata (+, on `sales_invoices.metadata`)
`draft_number`, `pdf_attachment_id`, `deliveries[]`.

### Dictionary
Seed `partially_paid` into `sales.invoice_status` in `setup.ts` (idempotent).

---

## API Contracts

| Method + path | Feature | Notes |
|---|---|---|
| `GET /api/billing/settings` | `billing.settings.view` | Current org. Lazily created with defaults. |
| `PUT /api/billing/settings` | `billing.settings.manage` | Zod-validated. IBAN checksum validated. |
| `GET /api/billing/invoices` | `billing.invoice.view` | + `overdue`, `dueFrom`, `dueTo`. + response fields. |
| `GET /api/billing/invoices/{id}/pdf` | `billing.invoice.view` | `application/pdf`. Frozen attachment if posted, live watermarked render if draft. |
| `POST /api/billing/invoices/{id}/send` | `billing.invoice.send` (new) | 409 if draft. 422 on invalid email. |
| `POST /api/billing/invoices/post` | existing | + numbering, due date, outstanding, settings-completeness guard |
| `POST /api/billing/invoices/add-line`, `edit-line` | existing | + `taxRate` |
| `POST/PUT /api/billing/items` | existing | + `taxRate` |
| `POST/PUT /api/billing/accounts` | existing | + `paymentTermsDays`, `autoSendInvoice` |
| `GET /api/billing/accounts/{id}/ar-summary` | `billing.account.view` | new. **Superseded by Spec E** `GET /api/billing/accounts/{id}/summary`. |

Every route exports `openApi`. New ACL features are added in `acl.ts` and granted to admin in `setup.ts`.

---

## Implementation Plan

### Phase 1: VAT + numbering
1. `BillingItem.tax_rate`, migration. Validators and their tests.
2. Writer: per-line VAT, totals, `DRAFT-` numbers. Add/edit-line tax. Unit tests: rounding, mixed rates, 0% items, credit lines with VAT.
3. Post: real number assignment. Unit test: no number consumed by deleted drafts.
4. Connector: tax rate passthrough. Demo seeds: rates on all items (incl. one 0% item).

### Phase 2: Settings + due date + overdue
1. `BillingSettings` entity, API, settings page. ACL.
2. Post: due date, outstanding, completeness guard. `partially_paid` dictionary seed.
3. Invoice list filters/columns. AR summary API. Account Invoices section. Account/item form fields.
4. Tests: due-date math, overdue predicate, settings validation.

### Phase 3: PDF
1. `lib/pdf/invoiceTemplate.ts` + font embedding. i18n labels en/pl.
2. PDF route (frozen vs draft preview). Attachment on post.
3. Tests: text-extraction assertions for both languages, a 3-page invoice.

### Phase 4: Email
1. Send route, auto-send subscriber, delivery log, events.
2. Invoice detail: Download / Send / Resend, delivery history.
3. Integration test with `OM_TEST_MODE` email capture (`open-mercato-email-capture.jsonl`).
4. Manuals: `billing-ui-testing.md` sections for settings, PDF, sending.

---

## Risks

| Risk | Mitigation |
|---|---|
| Wrong VAT on live subscriptions after a default-rate change | The rate is snapshotted on the item (B-D1). The default only affects new items. |
| Per-line rounding differs from per-rate-total rounding by 0.01 | Both methods are permitted in PL/EU. Documented. The VAT summary is the sum of line VAT, so the PDF stays internally consistent. |
| Email transport not configured on an instance | `sendEmail` throws `EMAIL_TRANSPORT_NOT_CONFIGURED`. This is logged as a `failed` delivery and surfaced in the UI. Posting is unaffected. |
| PDF font size or Unicode coverage | Embed one subsetted TTF (e.g. Noto Sans) in the package. |
| Posting blocked for orgs without settings | A clear 409 with a link to the settings page. The demo seed fills settings for every demo org. |

---

## Changelog
- 2026-11-14 — Skeleton. VAT gap and numbering gap found.
- 2026-11-14 — B-Q1..B-Q5 resolved (B-D1..B-D8). Full draft.
- 2026-11-14 — B-Q6 dropped: no customer-level tax treatment (B-D9).
- 2026-11-14 — Amended by Spec 0 (billing-owned invoice ledger).
- 2026-11-14 — B-D4 (draft numbers, real number at post) delivered by Spec 0 with configurable masks; Spec B keeps VAT, due date, PDF, email and seller settings.

---

## Implementation Status

Plan: [`.ai/runs/2026-11-14-billing-invoice-documents/PLAN.md`](../runs/2026-11-14-billing-invoice-documents/PLAN.md)

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — VAT | Done | 2026-11-14 | Item `tax_rate` (default filled at create), per-line VAT in the writer / dry & test runs, manual lines, demo seeds |
| Phase 2 — Settings, due date, overdue | Done | 2026-11-14 | Seller / bank / terms / VAT default on `/backend/config/billing`, post guard, due date, overdue filters, account summary + Invoices section |
| Phase 3 — PDF | Done | 2026-11-14 | Pure document model + pdf-lib A4 template (Noto Sans subset, en / pl), frozen attachment at post, watermarked drafts |
| Phase 4 — Email | Done | 2026-11-14 | Send command / route, auto-send subscriber, delivery log, events, invoice detail actions |

Deviations from the text above (all agreed in the plan, P-D1..P-D5):
- Billing-owned tables (Spec 0): `sales_invoices` → `billing_invoices`, `metadata.pdf_attachment_id` → column, attachment entity `billing:billing_invoice`; no dictionary seed (`partially_paid` is a status of the billing enum).
- Settings live at `/backend/config/billing` (framework settings convention).
- AR summary ships as Spec E's `GET /api/billing/accounts/{id}/summary`.
- Email bodies are plain text + HTML built from billing i18n (no React email component).
- Tests assert the pure document model plus a pdf-lib load / page-count smoke test instead of `pdfjs-dist` text extraction (not loadable in Jest).
- Integration tests TC-BILL-007 / TC-BILL-008 are written but not run — the migration is not applied yet.
