---
'@dainamite/cpq': minor
'@dainamite/cpq-billing-connector': minor
---

Billing setup on the CPQ order: choose the billing account and set the bill start per line before activation.

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
