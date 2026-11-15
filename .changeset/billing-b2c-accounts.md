---
'@dainamite/billing': minor
'@dainamite/cpq-billing-connector': patch
---

Billing accounts for persons (B2C), an invoice-language picklist, and pages that return to their billing account.

**`@dainamite/billing`**

- **B2C accounts.** `BillingAccount.customer_kind` (`company` | `person`, default `company`) records which customers collection `customer_id` points into. It is set on create (`customerKind`) and immutable afterwards, like `customerId`. `GET /api/billing/accounts` returns `customer_kind` and accepts a `customerKind` filter. Migration `Migration20261114000000_billing_customer_kind` adds the column (additive; existing rows become `company`). Run `yarn mercato db migrate`.
- **Account form.** A Company / Person switch picks the customer lookup (`/api/customers/companies` or `/api/customers/people`). Picking a customer prefills name, invoice email and the primary address into empty fields only. Prefill that the operator has not edited is rolled back when they pick another customer.
- **Account list and detail** show the customer's name with a company / person icon (one batched lookup per kind per page) and add a Customer type filter. The detail links to the customer record. If the customers module is unavailable, the raw id is shown.
- **Invoice language** is now a picklist of the languages the invoice template supports (`en`, `pl`).
  **Behaviour change:** `invoiceLanguage` values other than `en` / `pl` are now rejected with 400 on create and update. On create, `invoiceLanguage` is optional and defaults to `en`.
- **Navigation.** Item pages opened from a billing account return to that account (back link, after delete). Creating an item from an account returns to the account after save or cancel. Items opened from the global Items list (`?from=items`) still return to the list.

**`@dainamite/cpq-billing-connector`**

- Passes an optional `customerKind` from `cpq.subscription.activated` to the billing account it creates.
- Normalises `invoiceLanguage` and falls back to `en` for languages billing does not support, so onboarding never fails on an unsupported code.
