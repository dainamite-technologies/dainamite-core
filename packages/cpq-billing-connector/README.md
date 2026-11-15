# @dainamite/cpq-billing-connector

Pre-built integration that wires `@dainamite/cpq` subscription lifecycle
events to `@dainamite/billing` API calls.

It depends on both `@dainamite/cpq` and `@dainamite/billing` (as peers) and
**must be registered after both** so their services are resolvable when its
subscribers fire:

```typescript
// src/modules.ts — order matters
{ id: 'cpq', from: '@dainamite/cpq' }
{ id: 'billing', from: '@dainamite/billing' }
{ id: 'cpq_billing_connector', from: '@dainamite/cpq-billing-connector' }
```

```bash
yarn generate
yarn mercato db migrate
```

It ships one table (`cpq_billing_connector_order_setups`) and one UI: the
**Billing** tab on the CPQ order detail page (see below). Everything else is
event glue. Engines: **Node ≥ 24**.

The connector subscribes to six CPQ lifecycle events and translates each
to the billing API contract:

| CPQ event | Connector action |
|---|---|
| `cpq.subscription.activated` | Resolve the Billing Account from the order billing setup (or reuse / create one); create Billing Items per charge (one-time + recurring split) with the per-line bill start |
| `cpq.subscription.amended` | Create new Billing Items for added subscription items on the subscription's own account (billing prorates); set `bill_end_date` on removed items |
| `cpq.subscription.renewed` | Extend `bill_end_date` on existing Billing Items; create new Items for any added subscription items |
| `cpq.subscription.cancelled` | Set `bill_end_date` on all Billing Items for the subscription |
| `cpq.subscription.merged` | Move Billing Items from source subscriptions to the merged subscription (update `subscription_id`) |
| `cpq.subscription.superseded` | Set `bill_end_date` on all Billing Items for the superseded subscription |

## Order billing setup (Billing tab)

Spec: [`.ai/specs/2026-11-15-cpq-billing-connector-order-billing-setup.md`](../../.ai/specs/2026-11-15-cpq-billing-connector-order-billing-setup.md).

CPQ exposes a neutral injection spot, `cpq.order.detail:tabs`. The connector
fills it with a **Billing** tab, editable while a new-sale order is `draft` /
`pending_activation`:

- **Billing account.** *Use existing* lists only active accounts of the
  customer in the order's currency (one candidate is preselected). *Create new*
  is prefilled from the sales order's customer snapshot; only the fields the
  operator changes are stored as overrides.
- **Bill start.** One default for the order (empty = activation date) plus an
  optional date per line. Effective bill start of a line: line override → CPQ
  service start → order default → activation date.

**Amend / renew orders** show only the bill start of the lines they add
(empty = the effective date for amend, the new term start for renew); those
lines always bill to the subscription's existing account. Multi-subscription
(merge) renewals are not covered.

Saving is optional — without a saved setup, activation uses the customer's
data, reuses the newest matching account, and bills from the activation date.
Activation records the account it used (`applied_at`), which makes the setup
read-only and keeps a re-fired event on the same account.

| | |
|---|---|
| API | `GET` / `PUT /api/cpq_billing_connector/order-setups/:orderId` |
| Command | `cpq_billing_connector.order_setup.save` (undoable) |
| ACL | `cpq_billing_connector.order_setup.view`, `cpq_billing_connector.order_setup.manage` |
| DI | `cpqBillingOrderSetupService` |

Without the connector, CPQ's spot stays empty and the order page looks as it
always did — CPQ never references billing.

## Status

**Built — publishing soon** (alongside `@dainamite/billing`; not yet on npm).
All six subscribers are wired end-to-end — `@dainamite/cpq` emits the
matching events (`cpq.subscription.activated` on new-sale activation,
the ARC events on amend / renew / cancel / merge). Proration math lives
in this package: the `amended` subscriber derives the bill cycle from
the billing account via billing's `cycleContaining` (CPQ stays neutral
on billing-calendar semantics).

See [`specs/implementation/xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md)
§ CPQ Integration for the full design.

## License

MIT
