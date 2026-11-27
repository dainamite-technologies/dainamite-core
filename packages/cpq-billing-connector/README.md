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

The connector subscribes to eight CPQ lifecycle events and translates each
to the billing API contract:

| CPQ event | Connector action |
|---|---|
| `cpq.subscription.activated` | Resolve the Billing Account from the order billing setup (or reuse / create one); create Billing Items per charge (one-time + recurring split) with the per-line bill start |
| `cpq.subscription.amended` | Create new Billing Items for added subscription items on the subscription's own account (billing prorates); set `bill_end_date` on removed items |
| `cpq.subscription.renewed` | Extend `bill_end_date` on Billing Items that run to the old term end; end the Items of removed subscription items the day before the new term; create new Items for any added subscription items |
| `cpq.subscription.cancelled` | Set `bill_end_date` on all Billing Items for the subscription |
| `cpq.subscription.merged` | Move Billing Items from source subscriptions to the merged subscription (update `subscription_id`) |
| `cpq.subscription.superseded` | Set `bill_end_date` on all Billing Items for the superseded subscription |
| `cpq.subscription_item.status_changed` | Pause / suspend / grace → a billing line status period on every recurring Billing Item of the affected items; resume → the period in force on `fromDate` ends the day before (later periods untouched) |
| `cpq.subscription.terminated` | End the Billing Items like `cancelled`: `wholeSubscription: true` (decided by CPQ at emit time) → every Billing Item of the subscription; `false` / absent → only the listed items and their devices. CPQ's current status is never read, so a replayed item-level terminate cannot end the other items |

### Line period, price phases and line status (contract C3)

Specs: [line period and status](../../.ai/specs/2026-11-26-billing-line-period-and-status.md) and
[price phases](../../.ai/specs/2026-11-26-billing-price-phases-ramp-deals.md), Phase 3.
Mapping in `lib/chargeMapper.ts`; full contract in `.ai/runs/2026-11-26-billing-cpq-flex/PLAN.md`.

- **Own billing period.** A recurring charge's `billingPeriod` becomes the item's
  period: absent or every 1 month → none (follows the account cycle, as before);
  `{month, N}` → `monthly` / N; `{year, N}` → `annually` / N. A month count above
  billing's 24-month cap that is whole years (e.g. 36) goes out as `annually` / 3.
- **sourceRef.** The every-1-month charge keeps `cpq-<sub>-<item>-recurring`
  byte for byte (idempotency of earlier events); other periods append the period
  key: `…-recurring-1y`, `…-recurring-3m`. ARC re-rates use
  `…-recurring-rerate-<order>` plus the same suffix. The rule applies to
  activation, ARC `addedItems` and `changedItems`; a changed item split per
  period gets one new Billing Item per period, and all its old recurring items end.
- **Price phases.** `charges[].phases` (CPQ's merged schedule) are sent in the
  same create write as billing phases: `durationUnit: 'month'`,
  `durationCount: months`, `priceType: 'fixed'`, `value` per the item's period,
  `phasesEnabled: true`. Names longer than 120 characters are shortened.
- **Refused charges.** A charge billing cannot take — more than 12 merged phases
  (billing's cap), an invalid phase, an unsupported period, a missing price — is
  **refused, never trimmed**: no Billing Item for that charge, one
  `console.error('[cpq-billing-connector] charge refused, no billing item created', …)`
  with the event, `sourceRef`, reason and detail; the item's other charges still
  bill and the event succeeds (a retry could never pass). On an ARC re-rate a
  refused charge leaves the whole item on its current price (its old items are
  not ended). Fix the CPQ schedule and re-run the change.
- **Line status.** Writes go through `billing.items.status_periods.*` with a
  system context (`auth: null`; billing refuses status writes on CPQ lines from
  REST / UI, D6). Replays are no-ops: a period with the same status and start is
  not created twice; a resume with no open period writes nothing; a period of
  another status still running is closed the day before the new one; a clash
  that cannot be reconciled is logged, not retried. A resume only closes the
  period in force on its `fromDate` (one starting that very day is removed, it
  never took effect); a period starting after `fromDate` is a later change and is
  never touched, so a late or replayed resume cannot undo a later pause. One-time
  items carry no status.
- **Devices.** A device's own charges bill under the asset id. Status and
  terminate events cover the assets attached to the affected items
  (`cpqInventoryService.listAssets`, best effort).

Tests: `__tests__/lib/chargeMapperPeriodPhases.test.ts`, `__tests__/lib/arcRerate.test.ts`,
`__tests__/subscribers/itemStatusAndTerminate.test.ts`, and the pure chain
`__tests__/e2e/cpqToInvoiceChain.test.ts` (CPQ payload builder → mapper → billing
engine: spec P Example A, spec L yearly mobile plan, pause / resume / terminate).
API test against a running app: `__integration__/TC-CONN-001.spec.ts`.

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
All eight subscribers are wired end-to-end — `@dainamite/cpq` emits the
matching events (`cpq.subscription.activated` on new-sale activation,
the ARC events on amend / renew / cancel / merge, the status and terminate
events from the CPQ inventory). Proration math lives
in this package: the `amended` subscriber derives the bill cycle from
the billing account via billing's `cycleContaining` (CPQ stays neutral
on billing-calendar semantics).

See [`specs/implementation/xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md)
§ CPQ Integration for the full design.

## License

MIT
