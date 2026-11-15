---
'@dainamite/billing': minor
---

Billing payments (Spec C): a billing-owned payment register with bank CSV import, auto-matching by invoice number, allocations and account credit.

- New **Billing → Payments** page: upload a bank CSV (`date,amount,currency,reference,payer_name,payer_account`) or record a payment; each payment shows its match outcome, allocations and actions (assign to account, allocate, un-allocate, ignore / restore, convert to a prepaid top-up). Upload batches keep counts and row errors.
- Invoices move `posted → partially_paid → paid` from allocations (always recomputed); overpayments become account credit that is applied to the oldest open invoice, on import and when an invoice is posted.
- Gateway captures (`payment_gateways.payment.captured`) now create a payment and allocate it instead of flipping the invoice status directly.
- Invoice detail shows a Payments section; the account page shows its payments and the unapplied credit.
- New permissions `billing.payment.view`, `billing.payment.manage`, `billing.payment.import`; CLI `mercato billing payments-sample` builds a demo bank file from posted invoices.
- Run `yarn mercato db migrate` (`Migration20261117000000_billing_payments`).
