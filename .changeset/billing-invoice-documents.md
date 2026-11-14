---
'@dainamite/billing': minor
'@dainamite/cpq-billing-connector': patch
---

Billing invoices become real VAT documents with a PDF and email delivery (billing Spec B).

- **VAT per line.** Billing items carry `taxRate` (filled from the new organization default, 23 %, when omitted). Every invoice line gets net / VAT / gross; proration and credit lines inherit the item rate; manual lines accept `taxRate`. Existing items are migrated at 0 % (no silent re-pricing).
- **Seller settings.** Settings → Billing adds the seller block, bank / IBAN (checksum validated) / BIC, default payment terms and VAT rate, invoice footer and logo. **Posting is refused with 409 `billing.settings.incomplete` until legal name, address, tax id and IBAN are filled.**
- **Due dates and overdue.** Posting sets `due_date` (account terms or the default). The invoice list filters by `overdue`, `dueFrom`, `dueTo` and shows days overdue; the account page gets an Invoices section and `GET /api/billing/accounts/{id}/summary`.
- **PDF.** `GET /api/billing/invoices/{id}/pdf` — built-in A4 template in the account's invoice language (en / pl), frozen as an attachment at post; drafts are watermarked previews.
- **Email.** `POST /api/billing/invoices/{id}/send` (feature `billing.invoice.send`) and automatic sending per account (`autoSendInvoice`), through the platform `sendEmail()`. Deliveries are logged on the invoice; events `billing.invoice.sent` / `billing.invoice.send_failed`.
- **Dependencies:** `requires` adds `attachments`; new dependencies `pdf-lib` and `@pdf-lib/fontkit`.
- Connector: `ItemCreatePayload` accepts an optional `taxRate` (unused until CPQ exposes a per-charge rate).
- Run `yarn mercato db migrate` (`Migration20261116000000_billing_invoice_documents`).
