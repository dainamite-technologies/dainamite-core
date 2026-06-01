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

There is no UI or schema of its own to configure — it is pure event glue.
Engines: **Node ≥ 24**.

The connector subscribes to six CPQ lifecycle events and translates each
to the billing API contract:

| CPQ event | Connector action |
|---|---|
| `cpq.subscription.activated` | Create Billing Account if missing; create Billing Items per charge (one-time + recurring split) |
| `cpq.subscription.amended` | Create new Billing Items for added subscription items; compute proration value for the partial cycle and post as `one_time` Billing Item; set `bill_end_date` on removed items |
| `cpq.subscription.renewed` | Extend `bill_end_date` on existing Billing Items; create new Items for any added subscription items |
| `cpq.subscription.cancelled` | Set `bill_end_date` on all Billing Items for the subscription |
| `cpq.subscription.merged` | Move Billing Items from source subscriptions to the merged subscription (update `subscription_id`) |
| `cpq.subscription.superseded` | Set `bill_end_date` on all Billing Items for the superseded subscription |

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
