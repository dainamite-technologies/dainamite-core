---
'@dainamite/billing': minor
---

Operator feedback round 1 (billing Spec F) and the Billing Account workspace (Spec E phases 2–3).

- Bill Runs: **Delete run** for test and dry runs (removes the run, its outcomes and its test invoices; real runs are never deleted — `DELETE /api/billing/runs/{id}`, permission `billing.run.delete`). "Wipe test invoices" moved to the run page; runs list gets a Mode filter and a row action.
- Items: the account currency is shown next to every price; a **Net | Gross** switch stores the price as typed (`priceBasis`) and the invoice reproduces a typed gross exactly. Fixed: editing an item's VAT rate is saved again.
- Prepaid: one run closes every due bill date (also in test / dry); recurring items honour in advance / in arrears and proration; run outcomes show prepaid cycles and skipped items; an existing statement no longer blocks the account.
- Prepaid VAT: new setting **When is VAT charged** — at top-up (default; item amounts debited as entered) or at billing (receipts without VAT, debits gross at the item rate, statement VAT summary).
- Account workspace: summary cards, deep-linkable tabs (Overview, Items, Usage, Invoices, Payments / Balance & top-ups, Statements, Bill runs), **Run billing** dialog with inline results; account list Balance due / Overdue columns and Has overdue filter.
- Settings → Billing is listed in the Settings sidebar; number-mask help explains `:N` zero-padding.
- Run `yarn mercato db migrate` (`Migration20261119000000_billing_operator_feedback`) and `yarn mercato auth sync-role-acls`.
