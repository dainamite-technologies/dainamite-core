# Capability: cpq-cost-carry-through

How the costs of a cost-plus quote travel to the order at conversion and to the subscription items and assets at activation, who may see them, and the margins computed from them. Quote-side costs live in `cpq-quote-pricing`.

## Requirement: Order line costs copied at conversion
The system SHALL copy every non-deleted quote cost line to exactly one `CpqOrderLineCost` on the corresponding order line when a quote is converted, in the same transaction as the order, keeping `cost_key`, values, currency, FX / index snapshots, supplier, validity and supplier term, and recording `source_quote_line_cost_id`. Order line costs SHALL NOT change any order price.

### Scenario: Convert a costed quote
- WHEN an accepted quote whose tail line has a confirmed `price_basis` cost of 270 EUR and a `margin_only` installation cost of 1500 EUR is converted
- THEN the order line has two order line costs with the same `cost_key`s and values, and the order line's `charges`, `nrcTotal` and `mrcTotal` equal those of a conversion of the same quote without costs

### Scenario: Conversion fails mid-way
- WHEN copying a cost line throws
- THEN no order, order line or order line cost exists afterwards

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/orderCostCopy.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Inventory costs at activation
The system SHALL create, when an order activates, one `CpqInventoryCost` per order line cost, owned by the record that carries the order line's price — the new subscription item, or, for an assetizable line that becomes an asset without an item, that asset — with status `active` and `started_at` = activation date, in the same transaction as its owner, and SHALL set the order line cost's `inventory_cost_id`. Exactly one owner SHALL be set on each inventory cost. At most one inventory cost SHALL exist per (owner, `cost_key`), and its id SHALL never change.

### Scenario: Activate a new sale
- WHEN the order from the previous scenario is activated
- THEN the tail item has two item costs (270 and 1500 EUR), each order line cost points at its item cost, and `cpq.subscription.cost_changed` is emitted twice with `cause: 'activation'` after commit

### Scenario: Activate a new sale with an assetizable server
- WHEN a new sale has a server line (assetizable spec, NRC 5000) with a hardware cost of 3200 (NRC) and a licence cost of 40 per month (MRC), and is activated
- THEN the server asset owns two asset costs (3200 and 40), the server's order line costs point at them, the `created` change-log row's `after_snapshot` lists the asset with its `costs`, and two `cost_changed` events with `ownerType: 'asset'` and `cause: 'activation'` are emitted

### Scenario: Activation fails after the items are written
- WHEN activation throws after the subscription and its items were flushed
- THEN no subscription, item, item cost or change-log row remains, the order is still `draft`, and a retry activates it once

### Scenario: Toggle off
- WHEN the tenant toggle `cpq.cost_plus` is off and a converted order with order line costs is activated
- THEN item costs are written exactly as with the toggle on

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/inventoryCostSync.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Billing payloads are unaffected by costs
The system SHALL emit `cpq.subscription.activated`, `amended`, `renewed`, `cancelled`, `merged` and `superseded` payloads that are byte-identical (ignoring generated ids and timestamps) for the same quote with and without cost lines, and with the toggle on or off.

### Scenario: Golden billing payload
- WHEN two identical quotes, one with cost lines and one without, are converted and activated
- THEN the two `cpq.subscription.activated` payloads are equal after normalizing ids and timestamps

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/subscriptionEventPayloads.golden.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Order and item costs are confidential
The system SHALL return order line cost and inventory cost amounts, suppliers, FX data and margins only to users with `cpq.costs.view`, only while the toggle is on. Users with the read feature but without `cpq.costs.view` SHALL get a status-only projection. The system SHALL emit `cpq.subscription.cost_changed` with no amount and `clientBroadcast: false`.

### Scenario: User without cost access
- WHEN a user with `cpq.orders.view`, `cpq.inventory.view` and `cpq.arc.changelog.view` but not `cpq.costs.view` reads the order, subscription, item, asset, change-log and cost routes of an order whose tail cost is 7777.77
- THEN the cost routes return only ids, cost keys, names, roles and statuses, and no payload contains 7777.77, a supplier name, or a key named `unitAmount`, `instanceAmount`, `totalAmount`, `fxRate`, `supplier*` or `margin*`, and no change-log snapshot item or asset has a `costs` key

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/costConfidentiality.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Order and item margin
The system SHALL compute, for holders of `cpq.costs.view`, the order margin from order line `charges` and order line costs (the PR #87 margin rules), per subscription item the MRC margin (`mrcAmount` − Σ open MRC item cost totals) and the NRC margin at activation (`nrcAmount` − Σ NRC item cost totals), per cost-owning asset the NRC margin (`purchasePrice` − Σ NRC asset cost totals) and its open recurring cost, and per subscription a roll-up over its items and cost-owning assets, with cost coverage. Margin SHALL NOT be stored.

### Scenario: Item margin
- WHEN an item has `mrcAmount` 400 and one open MRC item cost with `total_amount` 270
- THEN its MRC margin is 130 and its margin % is 32.5

### Scenario: Recurring asset cost in the roll-up
- WHEN that subscription also has a server asset with an open MRC licence cost of 40
- THEN the subscription MRC margin is 90 (400 − 270 − 40), and the asset shows a recurring cost of 40 with no recurring revenue

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/itemMargin.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Usage reports live costed subscriptions
The system SHALL report in `GET /api/cpq/cost-plus/usage` the number of subscriptions with at least one open inventory cost (item or asset) as `liveSubscriptions`.

### Scenario: Before switching the toggle off
- WHEN one active subscription has an open item cost
- THEN `liveSubscriptions` is 1

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
