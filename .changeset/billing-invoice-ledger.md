---
'@dainamite/billing': minor
---

Billing owns its documents. Invoices, credit / debit memos and top-up receipts are no longer written to Open Mercato core `sales` (billing Spec 0).

- **New tables:** `billing_invoices`, `billing_invoice_lines`, `billing_document_sequences`, `billing_settings`. Run `yarn mercato db migrate`. No data is migrated: reseed, or see `MIGRATION.md` for removing old billing rows from `sales_invoices`.
- **Numbering at post.** Drafts carry `DRAFT-…`, and the series number is claimed when the invoice is posted (gap-free, inside the post transaction). A mask per series is set on the new **Billing settings** page (`/backend/config/billing`), using `{YYYY} {YY} {MM} {DD}` plus one counter token: `{SEQUENCE_NUM}` (never resets), `{SEQUENCE_NUM_YEAR}` or `{SEQUENCE_NUM_MONTH}`, with an optional `:N` zero-pad. The default is `INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`. A mask that repeats an issued number fails the post with 409 `billing.invoice.number_conflict`.
- **Breaking:**
  - Invoice API fields are renamed to billing names (`number`, `total_gross`, `outstanding`, `bill_date`, `period_start`, …). The full map is in `MIGRATION.md`.
  - The `void` status is removed. Statuses are now `draft | posted | partially_paid | paid | credited`.
  - The account export moves to `schemaVersion: 3`.
- **Top-up receipts** are billing documents (`document_type = 'receipt'`, `RC/…` series). VAT is split by billing's own `lib/vat.ts`.
- **Prepaid settings** move from core `configs` to per-organization billing settings (same defaults).
- **Dependencies:** `requires` is now `['auth', 'directory']`. `payment_gateways` is optional: without it, online top-ups return 501 `billing.topup.gateway_unavailable` and the Top up button is hidden. The unused `billing.uom` dictionary seed is removed. An isolation test fails the build if billing imports core `sales`, `configs`, `dictionaries` or `payment_gateways`.
- **New permissions:** `billing.settings.view` and `billing.settings.manage`.
