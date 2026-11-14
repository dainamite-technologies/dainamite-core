# Execution plan — Invoice documents: VAT, due date, overdue, account invoices, PDF, email (Spec B)

Source spec: .ai/specs/2026-11-14-billing-invoice-documents.md (B-D1..B-D9; umbrella D4, D7, D10, D13), as amended by Spec 0
Base branch: feat/billing-account-workspace (Spec E Phase 1 + Spec A + Spec 0, commit 6c138f8)
Branch: feat/billing-invoice-documents
Packages: `@dainamite/billing` (minor), `@dainamite/cpq-billing-connector` (no code change expected, see 1.4)

## What Spec 0 already delivered (not repeated here)

| Spec B item | State after Spec 0 |
|---|---|
| B-D4 `DRAFT-` numbers, real number at post | **Done** (configurable masks) |
| `BillingSettings` entity + API + page | **Exists** with prepaid defaults + masks. This plan adds seller/PDF columns. |
| `due_date`, `paid_total`, `outstanding`, `pdf_attachment_id`, `seller_snapshot` columns | **Exist** on `billing_invoices`. `outstanding = total_gross` is set at post; `due_date` is not. |
| `partially_paid` status | **Exists** in the status enum (no dictionary seed; the spec's "seed into `sales.invoice_status`" is obsolete) |
| VAT helpers | `lib/vat.ts` (`lineAmountsFromNet`, `sumTotals`), half-up per line |

The spec's references to `sales_invoices`, `sales:sales_invoice`, `metadata.pdf_attachment_id` and `backend/billing/settings` are read as `billing_invoices`, `billing:billing_invoice`, the `pdf_attachment_id` column and `/backend/config/billing`.

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | `BillingItem.tax_rate` + `BillingSettings.default_tax_rate` + migration + validators | todo |
| 1 | 1.2 | Item create/update fills the rate from settings (B-D1); bulk create too | todo |
| 1 | 1.3 | Writer: per-line VAT from the item rate (recurring, proration/credit, usage, one-time) | todo |
| 1 | 1.4 | Manual line add/edit accept `taxRate`; connector check; demo seeds with rates | todo |
| 1 | 1.5 | Unit tests: rounding, mixed rates, 0 %, negative credit lines, default fill | todo |
| 2 | 2.1 | Settings: seller block, bank, footer, logo, default terms + IBAN validation | todo |
| 2 | 2.2 | `BillingAccount.payment_terms_days` + `auto_send_invoice`; account/item forms | todo |
| 2 | 2.3 | Post: completeness guard (409), due date, seller snapshot, `metadata.draft_number` | todo |
| 2 | 2.4 | Invoice list: overdue / due filters + columns (SQL), overdue predicate in `lib/overdue.ts` | todo |
| 2 | 2.5 | `GET /api/billing/accounts/{id}/summary` (AR part) + Invoices section on the account page | todo |
| 2 | 2.6 | Unit tests: due-date math, overdue predicate, settings validation, guard | todo |
| 3 | 3.1 | Dependencies: `pdf-lib`, `@pdf-lib/fontkit`, Noto Sans TTF in the package | todo |
| 3 | 3.2 | `lib/pdf/invoiceModel.ts` (pure document model) + `lib/pdf/invoiceTemplate.ts` (renderer) | todo |
| 3 | 3.3 | Document i18n by `invoice_language` (en/pl) independent of the request locale | todo |
| 3 | 3.4 | `GET /api/billing/invoices/{id}/pdf` (frozen vs. draft watermark) + freeze after post | todo |
| 3 | 3.5 | Unit tests: model (en/pl, VAT summary, multi-page), render smoke, freeze/lazy fallback | todo |
| 4 | 4.1 | `lib/invoiceDelivery.ts` + `POST /api/billing/invoices/{id}/send` + ACL `billing.invoice.send` | todo |
| 4 | 4.2 | Auto-send subscriber on `billing.invoice.posted`; events `sent` / `send_failed` | todo |
| 4 | 4.3 | Invoice detail: Download PDF / Send / Resend, delivery history; list PDF row action | todo |
| 4 | 4.4 | Unit tests: delivery log, idempotent auto-send, placeholder email refusal | todo |
| 5 | 5.1 | Integration tests: TC-BILL-007 (VAT + due date + PDF), TC-BILL-008 (send, email capture) | todo |
| 5 | 5.2 | Docs: MIGRATION.md, changeset, manual §3e–3g, spec status | todo |
| 5 | 5.3 | Gate: build:packages, generate, typecheck ×3, test, build | todo |

## Goal

A posted billing invoice is a valid PL/EU VAT document: VAT per line from the item, seller and buyer blocks, issue and due dates, payment instructions. It can be downloaded as a PDF in the customer's language and emailed (manually or automatically). Operators see what each account owes and which invoices are overdue.

## Non-goals

- Payments, allocations, `partially_paid` transitions (Spec C). `credit_amount` in the summary stays 0.
- Credit/debit memos (Spec D). The PDF template is written so a memo can reuse it (title + "corrects" line), but no memo flow ships here.
- Customer-level tax treatment (B-D9). Email subject/body templates (fixed i18n texts in v1).
- Full account workspace with tabs (Spec E Phase 2). This plan adds the Invoices **section** and the summary endpoint Spec E will reuse.
- Applying migrations without confirmation.

## Decisions (confirmed 2026-11-14)

| # | Decision |
|---|---|
| P-D1 | **PDFs and the logo are stored through core `attachments`.** It is already a hard dependency of the app, so `requires` becomes `['auth', 'directory', 'attachments']` (platform module, not a business module). |
| P-D2 | **Add `@pdf-lib/fontkit` and ship Noto Sans (Regular + Bold) in the package; `pdf-lib` becomes a direct dependency.** Open Mercato core uses `pdf-lib` (forms `pdf-snapshot-service.ts`, attachments PDF processing) but not fontkit: it embeds the standard Helvetica font and replaces every character outside U+0020–U+00FF with `?` (`sanitizeForWinAnsi`), which would turn ą ę ł ś ż ź ć ń into `?`. |
| P-D3 | **AR summary ships as Spec E's `GET /api/billing/accounts/{id}/summary`** (not `ar-summary`). The Invoices section is a separate component added to today's account page; Spec E Phase 2 moves it into the Invoices tab. |
| P-D4 | **Posting is blocked until seller settings are complete** (409 `billing.settings.incomplete`). Demo seed fills settings for every demo org; integration tests fill them in `beforeAll` (TC-BILL-006 adapted). |
| P-D5 | **Existing items get `tax_rate = 0` from the migration** (no back-fill). Demo data is reseeded with real rates (N6). |

### Reference pattern: core forms PDF snapshot

`@open-mercato/core/src/modules/forms/services/pdf-snapshot-service.ts` already does what 3.2–3.4 need, and billing follows its shape (without importing it):
- a pure document model built first, then laid out with `pdf-lib`;
- the rendered bytes stored as an attachment, linked by an id column on the record (`pdfSnapshotAttachmentId` there, `pdf_attachment_id` here);
- idempotent: if the id is already set, the stored file is reused instead of re-rendering.

Differences: billing embeds a Unicode font (P-D2) instead of sanitising to WinAnsi, and renders synchronously after the post commits (with a lazy render on first download) instead of through a queue worker.

---

## Step details

### 1.1 Data + validators
- `BillingItem.tax_rate` `numeric(7,4) not null default 0` (`taxRate: string`).
- `BillingSettings.default_tax_rate` `numeric(7,4) not null default 23`.
- Hand-written `Migration20261116000000_billing_invoice_documents.ts` with **all** Spec B columns (1.1 + 2.1 + 2.2) so there is one migration for the branch, plus `down`.
- Validators: `taxRate` on item create/update (`0 ≤ x ≤ 100`, optional on create), `taxRate` optional on `add-line` / `edit-line`. Tests.

### 1.2 Default rate fill (B-D1)
- `commands/items.ts` create + bulk create: when `taxRate` is absent, read `getBillingSettings(em, scope).defaultTaxRate` once per command and store it on the item. Update never re-fills.
- Covers the connector, because it creates items through `billing.items.create` / `bulk_create`.

### 1.3 Writer VAT
- `InvoiceLineDescriptor` gains `taxRate: string`. `buildRecurringLineDescriptors` / usage / one-time builders take it from the item; Spec A proration and credit lines inherit the item's rate.
- `writeDraftInvoice`: `vat.lineAmountsFromNet(net, rate)` per line (`unit_price_net` unchanged; line `tax_rate`, `tax_amount`, `gross_amount`), totals via `vat.sumTotals`. Negative credit lines keep the sign on tax and gross.
- In-memory test/dry-run simulation uses the same path, so previews show VAT.

### 1.4 Manual lines, connector, seeds
- `add-line` / `edit-line`: `taxRate` defaults to the org default (add) or keeps the line's rate (edit); recompute totals (existing recompute helper).
- Connector: CPQ subscription items carry no tax rate today (`cpqOrderService` writes 0), so nothing is passed and the default applies. Add an optional `taxRate` to `ItemCreatePayload` for when CPQ gains one; no behaviour change. Connector tests stay green.
- `lib/seeds/demo.ts`: rates on every item (23 % default, one 8 % and one 0 % item), and seller settings per demo org (needed by P-D4).
- `LineFormDialog` + `ItemForm`: VAT % field (item form prefilled from `GET /api/billing/settings`).

### 1.5 Tests
Writer (mixed rates on one invoice, 0 %, credit lines with VAT, totals = sum of lines), engine simulation shows VAT, items create fills default once and doesn't touch updates, line commands with `taxRate`, seeds test.

### 2.1 Settings fields
- Columns on `billing_settings`: `legal_name`, `seller_address` (jsonb: line1, line2, city, postal_code, country), `tax_id`, `bank_name`, `iban`, `bic`, `invoice_footer`, `logo_attachment_id`, `default_payment_terms_days` (int, 14), `default_tax_rate` (from 1.1).
- `billingSettingsUpdateSchema`: IBAN normalised (spaces stripped, upper-case) and mod-97 checked in `lib/iban.ts` (pure); BIC 8/11 chars; terms 0–365.
- `lib/billingSettings.ts`: `missingSellerFields(settings)` → `['legal_name','seller_address','tax_id','iban']` subset.
- Settings page (`/backend/config/billing`): new "Seller" and "Payment" sections; logo upload through the attachments upload API (entity `billing:billing_settings`, record = settings id), preview, remove. Falls back to `directory.Organization.logo_url` in the PDF.
- `GET /api/billing/settings` adds `completeness: { ready, missing[] }` for the UI banner.

### 2.2 Account fields
- `BillingAccount.payment_terms_days` (int null), `auto_send_invoice` (bool default false). Validators, account commands, export (`schemaVersion` 4), `AccountForm` (terms placeholder shows the org default).

### 2.3 Post changes (`commands/invoices.ts`)
Inside the existing locked transaction, before claiming the number:
1. Guard: settings incomplete → `CrudHttpError(409, { code: 'billing.settings.incomplete', missing })`. No number consumed.
2. `due_date = issue_date + (account.paymentTermsDays ?? settings.defaultPaymentTermsDays)` via `lib/dueDate.ts` (pure, date-only, UTC).
3. `seller_snapshot` = legal name, address, tax id, bank, iban, bic, footer, logo attachment id (frozen so later settings edits don't change issued documents).
4. `metadata.draft_number` = the `DRAFT-…` number being replaced.

Payload of `billing.invoice.posted` gains `dueDate`. The UI shows the 409 with a link to settings.

### 2.4 Invoice list
- `lib/overdue.ts`: `isOverdue(inv, today)` and `daysOverdue(inv, today)` (B-D6), plus the matching SQL fragment builder so list and summary share one definition.
- `GET /api/billing/invoices`: filters `overdue=true`, `dueFrom`, `dueTo` (validated); response adds `due_date`, `days_overdue` (computed in SQL, `today` from the request date). `outstanding` already returned. Index `(bill_account_id, status, due_date)` exists.
- List page: "Overdue" filter preset, due date / outstanding / days overdue columns (destructive colour when > 0).

### 2.5 Account summary + Invoices section
- `GET /api/billing/accounts/{id}/summary` (`billing.account.view`): one aggregate SQL over `billing_invoices` → `{ open_amount, overdue_amount, overdue_count, credit_amount: 0, currency_code }`. Spec E later adds prepaid balance / next bill date to the same response.
- Account detail page: summary cards + an Invoices section (`DataTable`, server-paginated via `GET /api/billing/invoices?billAccountId=`, status + overdue filter, row → invoice detail with return-to-account navigation from Spec E Phase 1). Extracted as `components/AccountInvoicesSection.tsx` so Spec E's tab reuses it (the page is already 626 lines).

### 2.6 Tests
`dueDate` (month ends, leap year, 0 days), `overdue` (each status, today boundary, zero outstanding), IBAN checksum, settings validation, post guard (409 + no sequence claimed), seller snapshot frozen, summary SQL shape.

### 3.1 Dependencies
- `packages/billing/package.json` `dependencies`: `pdf-lib@^1.17.1`, `@pdf-lib/fontkit@^1.1.1` (regular deps, they are not `@open-mercato` / `@dainamite`).
- `src/modules/billing/lib/pdf/fonts/NotoSans-{Regular,Bold}.ttf` + OFL licence file; build copies them (check `build:packages` copies non-TS assets, else load via `fs` relative to `import.meta`/`__dirname` with a fallback path).

### 3.2 Model + template
- `invoiceModel.ts` (pure): `buildInvoiceDocumentModel({ invoice, lines, seller, buyer, labels, locale })` → sections (header, parties, meta, line rows with service period in the description, VAT summary grouped by rate, totals, payment instructions with "Title: <number>", footer). All money/date formatting via `Intl` with the locale. Draft flag → watermark.
- `invoiceTemplate.ts`: A4 renderer with pdf-lib: column layout, row wrapping, page breaks repeating the table header, "Page n / m", diagonal "DRAFT" watermark, logo (PNG/JPEG; other types skipped with a log).
- Built so a credit memo later only changes the title and adds a "corrects" line (Spec D).

### 3.3 Document i18n
- `lib/pdf/labels.ts`: loads `billing.pdf.*` keys from the module's `i18n/en.json` / `pl.json` for `invoice_language` (fallback en), independent of the operator's request locale. Language taken from `buyer_snapshot.invoice_language` on posted documents (frozen), from the account on drafts.

### 3.4 PDF route + freeze
- `GET /api/billing/invoices/{id}/pdf` (`billing.invoice.view`, `openApi`): posted with `pdf_attachment_id` → stream the stored file; posted without (render failed earlier) → render, store, set the column, stream; draft → live render with watermark, never stored; test-run → watermark "TEST".
- After the post transaction commits: render + `createAttachmentFromBuffer({ entityId: 'billing:billing_invoice', recordId, fileName: '<number>.pdf' })`, set `pdf_attachment_id`, then emit `billing.invoice.posted`. A render failure is logged, the post stays committed (lazy fallback above).

### 3.5 Tests
Model: en + pl labels and formatting, VAT summary sums equal header totals, service period text, 60-line invoice paginates (3 pages). Renderer: smoke test that the output loads in `PDFDocument.load` with the right page count and that the font embeds (Polish text doesn't throw). Text extraction with `pdfjs-dist` only if jest can load its legacy build; otherwise model-level assertions are the contract (see Risks). Route: draft vs posted branches with mocked storage.

### 4.1 Delivery
- `lib/invoiceDelivery.ts` `sendInvoice(em, container, { invoiceId, trigger })`:
  - posted only (409 `billing.invoice.not_posted`);
  - recipient = account `invoice_email`; `@invalid.local` or invalid → 422 `billing.invoice.email_invalid`;
  - load the frozen PDF (render+freeze if missing);
  - `sendEmail({ to, subject, react: <InvoiceEmail/>, attachments: [{ filename, content: base64, contentType: 'application/pdf' }], tenantId, organizationId })`, subject/body from `billing.email.*` in the document language;
  - append `metadata.deliveries[] = { at, to, status, error?, trigger }`; emit `billing.invoice.sent` / `billing.invoice.send_failed`. Transport errors (incl. `EMAIL_TRANSPORT_NOT_CONFIGURED`) become a `failed` entry, not a 500.
- `POST /api/billing/invoices/{id}/send` (`billing.invoice.send`, new feature, granted to admin + finance role; `setup.test.ts` count 22).

### 4.2 Auto-send
- `subscribers/invoice-auto-send.ts` on `billing.invoice.posted`, `persistent: true`: if `account.auto_send_invoice` and no `sent` delivery with trigger `auto` exists for the invoice → `sendInvoice(trigger: 'auto')`. Idempotent on redelivery.
- `events.ts`: `billing.invoice.sent`, `billing.invoice.send_failed`.

### 4.3 UI
Invoice detail: Download PDF (also on drafts, labelled "Preview"), Send / Resend with a confirm dialog showing the recipient (Cmd/Ctrl+Enter, Escape), delivery history table, due date and days overdue in the header. Invoice list + account section: PDF row action.

### 4.4 Tests
Delivery log appended on success and failure, placeholder email → 422 with no send, draft → 409, auto-send skips when already sent, auto-send skips when the flag is off.

### 5.1 Integration tests
- **TC-BILL-007**: fill settings → account (terms 7) → items 23 % and 0 % → real run → draft totals with VAT → post → `due_date = issue + 7`, PDF endpoint returns `application/pdf`, draft PDF works before post; post with incomplete settings in a fresh org isn't feasible in one tenant, so the guard is unit-tested only.
- **TC-BILL-008**: `OM_TEST_MODE` email capture → send → capture file has the recipient and a `.pdf` attachment; delivery history shows `sent`; placeholder email → 422.
- TC-BILL-006 adapted: its `beforeAll` fills seller settings.

### 5.2 Docs
- `MIGRATION.md`: new columns, post guard (settings must be filled before posting), `requires` + `attachments`, new deps, export `schemaVersion` 4.
- Changeset: billing minor.
- `manuals/billing-ui-testing.md`: §3e seller settings, §3f VAT + due dates + overdue, §3g PDF + sending.
- Spec B: Implementation Status; Spec E: note the summary endpoint + Invoices section delivered.

### 5.3 Gate
`yarn build:packages`, `yarn generate`, typecheck (billing, connector, app), `yarn test`, `yarn build`. Migration written, **not applied** without confirmation.

---

## Risks

| Risk | Mitigation |
|---|---|
| Jest can't load `pdfjs-dist` (ESM) for text extraction | The pure document model is the tested contract; the renderer gets a load/page-count smoke test. pdfjs extraction is a nice-to-have. |
| Fonts not copied into `dist` by `build:packages` | Checked in 3.1; fallback resolves the path from `src` and fails loudly with a clear message. |
| Posting blocked for existing orgs after upgrade (P-D4) | 409 lists the missing fields and links to settings; demo seed fills settings; documented in MIGRATION.md. |
| Wrong VAT after a default change | Rate is stored on the item at creation (B-D1); default only affects new items. |
| Per-line vs per-rate rounding differs by 0.01 | Both allowed; VAT summary is the sum of line VAT, so the document is internally consistent. |
| Email transport not configured | Logged as a `failed` delivery, shown in the UI; posting unaffected. |
| PDF render failure at post | Post stays committed; first download renders and freezes. |
| Account page grows further | Invoices section and summary cards are separate components that Spec E's tabs reuse. |
