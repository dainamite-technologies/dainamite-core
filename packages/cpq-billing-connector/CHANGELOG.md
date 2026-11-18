# @dainamite/cpq-billing-connector

## 5.2.0

### Minor Changes

- dc9a79d: ARC credit reasons, end-date clamp and an activation guard (spec `2026-11-16-billing-operator-polish-and-bill-cycle-day`, Part 2 / Phase 9).

  - **End-date clamp.** The `amended` / `cancelled` / `superseded` subscribers end each billing item at `max(effectiveDate − 1, billStartDate − 1)` (`lib/arcEndDate.ts`). An item that has not started yet ends the day before its start ("cancelled before start"), so it never bills and never trips billing's `billing.item.end_before_start`. Items that already end on or before that date are left alone: a re-delivered event writes nothing, and an earlier end is never extended.
  - **Credit reasons.** Every ARC end-date write sends `creditReasonCode` (`subscription_amended` / `subscription_cancelled` / `subscription_superseded`) plus `creditReasonParams { reference?, effectiveDate }`. `reference` is the CPQ order number, best-effort. Billing stores the reason only when the end date credits already-billed days, and renders it in the invoice language. This needs a `@dainamite/billing` release that accepts the fields; older billing versions drop them.
  - **Earliest activation date.** `GET /api/cpq_billing_connector/order-setups/:orderId` adds `earliestActivationDate` (`YYYY-MM-DD` or null) and `earliestActivationReason { subscriptionId, itemDescription }` (or null). For an `amend` / `cancel` order this is the day billing of every target subscription has begun: per subscription, the earliest `billStartDate` among its active billing items that do not end before they start (a future-dated item does not block). Renewals and new business get null. The Billing tab shows an amber callout while that date is in the future (i18n en / es / de / pl).
  - **Activation guard.** New `data/guards.ts` registers a mutation guard on `cpq.order` / `update`. For `{ action: 'activate' }` it rejects activation before the earliest date with 422 `{ error, code: 'cpq_billing_connector.activation_before_billing_start', earliestActivationDate }`. If billing cannot be read, the guard fails open and logs a warning. Requires `@dainamite/cpq` with mutation-guard wiring on the activate route. Run `yarn generate` after upgrading.

- dc9a79d: Bill cycle day. Follows `@dainamite/billing` 1.1 (peer range now `^1.1.0`; `@dainamite/cpq` `^1.1.0` for the activation guard). Order-setup overrides take `billCycleInterval` + `billCycleDay`; `billCycleAnchor` and `quarterly` are rejected.

  - **New accounts are created with `billCycle` + `billCycleInterval` + `billCycleDay`** instead of `billCycleAnchor`. Default: every 1 month on day 1. `quarterly` is gone; a legacy `quarterly` in an upstream payload is read as monthly × 3, and an invalid upstream combination falls back to the unit's defaults instead of failing onboarding.
  - **`nextBillDate` is sent only when the operator or upstream set one.** Otherwise billing starts the account on the first bill cycle day on or after today. The connector no longer derives it from the earliest line bill start or the activation date; recurring items that start later produce empty cycles until their bill start.
  - **Order setup.** The free-text "Bill cycle anchor" input is replaced by "Every [N] [unit] on [day]" controls (1–31 for months / years, a weekday for weeks, hidden for days). "First bill date" is optional. Saved `accountOverrides` take `billCycleInterval` / `billCycleDay` (validated against the unit); `billCycleAnchor` is rejected.

### Patch Changes

- dc9a79d: Order billing setup: follow-ups from the PR review.

  - **Concurrent saves no longer fail with a 500.** When two requests create an order's billing setup at the same time, the loser hits the unique index and now retries once: it finds the winner's row and updates it (PUT replaces the whole setup, so the last writer wins). The activation lock (`markApplied`) retries the same way and keeps the first `appliedAt`.
  - **A saved account that is no longer usable is flagged.** If the account saved for an order was deactivated, deleted, or no longer matches the customer and currency, the Billing tab shows a warning and re-derives the account choice (one candidate → preselected, none → create new, several → pick one) instead of re-submitting a selection the API rejects with 422. Saved bill start dates are kept. Activation already falls back safely when nobody re-saves.

## 5.1.0

### Minor Changes

- 9370e52: New read-only AI tool `cpq_billing_connector.get_order_setup`: shows how a CPQ order will be billed (account, bill start dates per line, whether the setup is applied). It calls `GET /api/cpq_billing_connector/order-setups/:orderId` and needs `cpq_billing_connector.order_setup.view`.

  The connector adds this tool, a prompt hint and a starter suggestion to the billing package's `billing.operator_assistant` agent, so operators can ask the billing assistant about CPQ orders. Billing itself does not depend on the connector.

  The package lists `@open-mercato/ai-assistant` `^0.9.0` as an **optional** peer dependency: the tool only imports its types at load time and loads the runner when it is called, so apps without the AI assistant keep working. After upgrading, run `yarn generate`.

### Patch Changes

- 478c144: Peer dependency ranges accept the stable 1.x line: `@dainamite/billing` `^0.22.0 || ^1.0.0` and `@dainamite/cpq` `^0.8.0 || ^1.0.0`. No code changes.

## 5.0.0

### Minor Changes

- a4fb34b: Billing setup on the CPQ order: choose the billing account and set the bill start per line before activation.

  **`@dainamite/cpq`**

  - **New injection spot `cpq.order.detail:tabs`** on the CPQ order detail page. Widgets with `kind: 'tab'` become tabs next to "Line items". With nothing injected the page renders exactly as before. Context: `{ orderId, salesOrderId, cpqStatus, customerId, currencyCode, quoteType }`; `data` is the order API result.
  - **Richer `cpq.subscription.activated` payload** (additive, all optional): `customerName`, `customerKind`, `invoiceEmail` and `invoiceAddress` from the sales order snapshot (decrypted), plus `items[].orderLineId` and `items[].startDate`. Declared in `events.ts` `payloadSchema`.
  - **`cpqOrderService.getOrderCustomerFields(orderId, scope)`**: the same customer fields, for add-ons that need them before activation.
  - **ARC events** (`cpq.subscription.amended` / `renewed`): `addedItems[].orderLineId` and `addedItems[].startDate` (additive), matched from the change log's quote line to the order line built from it.

  **`@dainamite/cpq-billing-connector`**

  - **Billing tab on CPQ orders.** Use an existing billing account (only active accounts of the customer in the order's currency) or create a new one prefilled from the customer, with every field editable. One default bill start for the order ("on activation" by default), changeable per line.
  - **No more junk accounts.** A new account takes the customer's name, email and billing address instead of `Customer <uuid>`, `billing+<id>@invalid.local` and `TBD`. Placeholders are only a last resort.
  - **Bill start per line:** line override → CPQ service start → order default → activation date. A new account's first bill date is the earliest bill start.
  - **Amend / renew orders:** the Billing tab sets the bill start of the **added** lines only (fallback: the effective date for amend, the new term start for renew). They always bill to the subscription's existing account. `renewed` / `amended` lock the setup once applied. Cancel orders show "nothing to bill". Multi-subscription (merge) renewals are not covered: `cpq.subscription.merged` carries no added items.
  - **Fix:** activation never reuses an inactive account or one in another currency (it used to take the customer's first account). `cpq.subscription.amended` adds items to the subscription's own account.
  - **API:** `GET` / `PUT /api/cpq_billing_connector/order-setups/:orderId` (undoable command `cpq_billing_connector.order_setup.save`). **ACL:** `cpq_billing_connector.order_setup.view` / `.manage` (admin: both; employee: view).
  - **Migration** `Migration20261115000000_cpq_billing_connector_order_setups` (the connector's first table). Run `yarn mercato db migrate`, then `yarn generate`.
  - New peer dependencies: `@open-mercato/ui`, `next`, `react`, `react-dom` (the connector now ships UI).

### Patch Changes

- Updated dependencies [a4fb34b]
  - @dainamite/cpq@0.8.0

## 4.0.0

### Patch Changes

- Updated dependencies [34d3ac4]
- Updated dependencies [d86651d]
  - @dainamite/billing@0.22.0
  - @dainamite/cpq@0.7.0

## 3.1.0

### Minor Changes

- 486db4d: Bill runs catch up on every due cycle, bill recurring items in advance or in arrears, and prorate partial periods (billing Spec A).

  **`@dainamite/billing`**

  - **Every run catches up.** Manual or scheduled, in real, test or dry mode, a run bills every due bill date up to `asOfDate`, with one draft per bill date (capped at 60 per account). Test and dry runs simulate every cycle in memory without changing the account. **Breaking:** the `catchUp` trigger flag and the `catch_up` run column/response field are removed. A `catchUp` sent by an old client is ignored.
  - **Charge timing per item.** Recurring items carry `chargeTiming` (`in_advance` by default, or `in_arrears`). **Behaviour change:** recurring items are now billed in advance by default, so `next_bill_date` marks the start of the period billed.
  - **Proration per item.** `prorate` defaults to `true`. A partial period (the item starts or ends mid-cycle) is charged by calendar days instead of being skipped. An in-advance item that ends after it was billed gets a negative credit line for the unused days. With `prorate: false`, partial periods are skipped and reported.
  - **Run outcomes** carry `cycles` (bill date, service period, status, lines, net, invoice). `warnings.skipped_items` lists items that were not billed and why. The run summary adds `cycles_processed`. The run detail page shows a Cycles table and a Skipped items table.
  - **Draft invoices** carry `metadata.bill_date`, the de-duplication key, together with `test_run`. Test drafts and real drafts never block each other. Lines carry `service_period_start` / `service_period_end`, plus `proration` and `credit_for` where they apply.
  - **Item form** gets Charge timing and Prorate partial periods fields. The items list gets a Timing column.
  - **Migration** `Migration20261114100000_billing_cycle_semantics`. Run `yarn mercato db migrate`. See `MIGRATION.md`; reseeding is recommended.

  **`@dainamite/cpq-billing-connector`**

  - **Proration moves to billing.** `cpq.subscription.amended` no longer posts `one_time` proration items, because the billing engine prorates. Release together with billing: an older connector would double-charge.
  - **First bill date.** New billing accounts start billing on the activation date (they used to start one month later), so the first period is billed in advance.
  - Removes `lib/prorationHelper` and the runtime import of billing's `cycleContaining`.

### Patch Changes

- d126be2: Billing accounts for persons (B2C), an invoice-language picklist, and pages that return to their billing account.

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

- c8a1bf7: Billing invoices become real VAT documents with a PDF and email delivery (billing Spec B).

  - **VAT per line.** Billing items carry `taxRate` (filled from the new organization default, 23 %, when omitted). Every invoice line gets net / VAT / gross; proration and credit lines inherit the item rate; manual lines accept `taxRate`. Existing items are migrated at 0 % (no silent re-pricing).
  - **Seller settings.** Settings → Billing adds the seller block, bank / IBAN (checksum validated) / BIC, default payment terms and VAT rate, invoice footer and logo. **Posting is refused with 409 `billing.settings.incomplete` until legal name, address, tax id and IBAN are filled.**
  - **Due dates and overdue.** Posting sets `due_date` (account terms or the default). The invoice list filters by `overdue`, `dueFrom`, `dueTo` and shows days overdue; the account page gets an Invoices section and `GET /api/billing/accounts/{id}/summary`.
  - **PDF.** `GET /api/billing/invoices/{id}/pdf` — built-in A4 template in the account's invoice language (en / pl), frozen as an attachment at post; drafts are watermarked previews.
  - **Email.** `POST /api/billing/invoices/{id}/send` (feature `billing.invoice.send`) and automatic sending per account (`autoSendInvoice`), through the platform `sendEmail()`. Deliveries are logged on the invoice; events `billing.invoice.sent` / `billing.invoice.send_failed`.
  - **Dependencies:** `requires` adds `attachments`; new dependencies `pdf-lib` and `@pdf-lib/fontkit`.
  - Connector: `ItemCreatePayload` accepts an optional `taxRate` (unused until CPQ exposes a per-charge rate).
  - Run `yarn mercato db migrate` (`Migration20261116000000_billing_invoice_documents`).

- Updated dependencies [d126be2]
- Updated dependencies [486db4d]
- Updated dependencies [c8a1bf7]
- Updated dependencies [6c138f8]
- Updated dependencies [418d67c]
- Updated dependencies [3dc3fa5]
- Updated dependencies [418d67c]
  - @dainamite/billing@0.21.0

## 3.0.0

### Patch Changes

- Updated dependencies [adcb50f]
- Updated dependencies [8d57b1b]
  - @dainamite/cpq@0.6.0

## 2.0.0

### Minor Changes

- d7ce539: Require Open Mercato `0.9.0`. Peer ranges move from `^0.6.7` to `^0.9.0` for
  `@open-mercato/core`, `shared`, `ui`, `events` and `queue`, and the MikroORM
  peers from `^7.1.5` to `^7.1.14`. Consumers on Open Mercato `0.6.x`–`0.8.x`
  must upgrade before taking these versions.

  `@dainamite/cpq` and `@dainamite/billing` now peer on `@tanstack/react-table`
  `^9.0.0` (was `^8.0.0 || ^9.0.0`): Open Mercato 0.7 moved its `DataTable` to
  TanStack Table v9, and list pages now import `LegacyColumnDef` from
  `@tanstack/react-table/legacy`, which v8 does not have.

  `@dainamite/cpq` also fixes CPQ quote and order API routes answering `500`
  instead of the service's typed status (e.g. `404 Quote not found`). Next
  bundles the package once per server layer and the DI container is shared, so
  the route could catch a `QuotingError` / `OrderError` from the other copy of
  the class and `instanceof` failed. Both classes now carry a `Symbol.for`
  brand; new `isQuotingError` / `isOrderError` guards are exported alongside
  them and should be used instead of `instanceof` in route handlers.

### Patch Changes

- Updated dependencies [924c8b6]
- Updated dependencies [d7ce539]
  - @dainamite/billing@0.20.0
  - @dainamite/cpq@0.5.0

## 1.0.0

### Minor Changes

- 8834b8b: Require Open Mercato `0.6.7`. Peer ranges move from `^0.6.0` to `^0.6.7` for
  `@open-mercato/core`, `shared`, `ui`, `events` and `queue`, and the MikroORM
  peers from `^7.0.0` to `^7.1.5` (7.1 split the SQL layer into
  `@mikro-orm/sql`, so a shared 7.1 instance is required).

  No package source changes — this only narrows the supported framework range.
  Consumers on Open Mercato `0.6.0`–`0.6.6` must upgrade before taking these
  versions.

  Note for consumers running commands with a system identity (`ctx.auth: null`):
  `0.6.7` hardened `ensureTenantScope` / `ensureOrganizationScope`. Those calls
  are still no-ops with `auth: null`, but an unscoped organization command now
  logs a warning and will throw `403` if `OM_ENFORCE_ORG_SCOPE_STRICT=true`.

### Patch Changes

- Updated dependencies [8834b8b]
  - @dainamite/cpq@0.4.0
  - @dainamite/billing@0.19.0

## 0.1.1

### Patch Changes

- f8210ac: Bump `@dainamite/billing` peer dependency to `^0.18.0` (prepaid billing,
  SPEC-002 / XD-304). No connector code changes — the connector keeps emitting
  the same command-bus calls; this only widens the supported billing range.
- Updated dependencies [f8210ac]
  - @dainamite/billing@0.18.0

## 0.1.0 — Initial release (unreleased)

- 6 subscribers translating CPQ subscription lifecycle events to
  `@dainamite/billing` command-bus calls:
  - `cpq.subscription.activated` _(awaits CPQ upstream PR)_ → create
    Billing Account if missing, bulk-create Billing Items per charge.
  - `cpq.subscription.amended` → bulk-add new items (including the
    proration `one_time` Item the connector computes here), set
    `bill_end_date` on removed items.
  - `cpq.subscription.renewed` → extend `bill_end_date` + bulk-add any
    new items.
  - `cpq.subscription.cancelled` → set `bill_end_date` on every item
    for the cancelled subscription.
  - `cpq.subscription.merged` → re-link items from source
    subscriptions to the merged target.
  - `cpq.subscription.superseded` → set `bill_end_date` on every
    item for the superseded subscription.
- Pure helpers:
  - `lib/prorationHelper.ts` — `unitPrice × quantity × daysRemaining
/ daysInPeriod` with half-up 2dp rounding, matching the spec's
    invoice-amount rounding policy. Proration math lives here (not
    in CPQ) so CPQ stays neutral on billing calendar semantics.
  - `lib/chargeMapper.ts` — CPQ charge → billing item create payload.
- `lib/billingApiClient.ts` — internal commandBus wrapper. Subscribers
  go through the same command IDs that the billing REST routes
  use — `billing.accounts.create`, `billing.items.bulk_create`,
  etc. — so there is only one write path for billing state. Item
  creation always goes through `billing.items.bulk_create` (one
  batched account lookup + idempotency query + flush) rather than a
  per-item loop.
- Module ID: `cpq_billing_connector` (plural-ish-snake-case, matches
  OM's `auth` / `customers` / `dictionaries` convention).
