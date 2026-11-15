---
'@dainamite/billing': minor
---

Credit and debit memos (billing Spec D): posted invoices are corrected only by referenced corrective documents.

- Invoice page: **Create credit memo** (pick lines, edit quantity / unit net, "Full credit", required reason) and **Create debit memo**; draft memos can be deleted, posted ones never (no void). A Corrections section lists the memos of an invoice.
- Posting a credit memo (`CN/…` series) settles the corrected invoice through the allocation model; any remainder becomes account credit applied to the oldest open invoice. An invoice settled entirely by credit becomes `credited`. Debit memos (`invoice` series) are payable: due date, overdue, matched by number in bank imports.
- Guard: total credits on an invoice never exceed its gross plus its posted debit memos (409 `billing.memo.exceeds_invoice`).
- PDF memo variant ("Corrects invoice X of DATE", reason, settlement text); list Type filter / column (credit memo totals shown negative).
- Events `billing.credit_memo.posted`, `billing.debit_memo.posted`, `billing.invoice.credited`; `billing.invoice.posted` fires for invoices only. New permission `billing.invoice.correct`.
- Run `yarn mercato db migrate` (`Migration20261118000000_billing_memos`).
