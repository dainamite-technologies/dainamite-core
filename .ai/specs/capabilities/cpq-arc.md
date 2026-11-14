# Capability: cpq-arc

How operators amend, renew and cancel live CPQ subscriptions through quotes, and what happens to the prices of the items involved.

## Requirement: Amend mirror line pricing
The system SHALL keep an engine-priced mirror line on an Amend quote at the source subscription item's stored charges until a pricing input of that line changes, and SHALL then re-price it at the current standard price.

### Scenario: Untouched line
- WHEN an Amend quote adds a port and the existing port's catalog price rose from 100 to 120 since activation
- THEN the existing port's line keeps 100, and activation leaves its subscription item price at 100

### Scenario: Reconfigured line
- WHEN the rep changes the existing port's speed on the Amend quote
- THEN the line is re-priced at the current standard price and the banner is shown

### Scenario: Unchanged resubmission
- WHEN the UI saves the line with the same configuration and quantity
- THEN the line stays frozen

Source: .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md

## Requirement: Costs on ARC lines
The system SHALL let a pricing manager enter and confirm the cost values of non-frozen mirror lines (Renew mirrors re-priced at today's standard, reconfigured Amend mirrors), so their price-basis costs can be confirmed before conversion. It SHALL refuse manual costs and markup overrides on mirror lines, and every cost write on frozen Amend mirror lines and ARC cancel lines (`422 LINE_NOT_ELIGIBLE`). Removing an item on an Amend / Renew quote SHALL delete its line's cost lines, and ARC cancel lines SHALL never block conversion.

### Scenario: Renew mirror line with an estimated cost
- WHEN a Renew quote mirrors an item whose offering has an on-request tail cost (estimated 300)
- THEN a pricing manager can confirm it, and the quote converts once every price-basis cost is confirmed

### Scenario: Removed item
- WHEN the rep removes that item instead
- THEN its cost lines are deleted and conversion is not blocked by them

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Frozen Renew mirror lines of cost-plus items
The system SHALL keep re-pricing engine-priced mirror lines on a Renew quote at the current standard price, **except** a mirror line whose source item is cost-plus, i.e. whose stored charges contain a charge with `pricingMethod: 'cost_plus'` (the item's contracted state; its costs and today's offering are not consulted). Such a line SHALL be created frozen at the item's stored charges, SHALL show the banner "Costs are not carried to change quotes yet", and SHALL be re-priced only when a pricing input of the line changes (the Amend rule).

### Scenario: Renew a cost-plus item
- WHEN a Renew quote mirrors an item priced 400 from a 320 tail cost, and the tail's catalog element now resolves to 360
- THEN the line keeps 400, no catalog cost line is instantiated on it, and the banner is shown

### Scenario: Renew a standard item
- WHEN a Renew quote mirrors an item whose charges are all `fixed` / `table`
- THEN the line is re-priced at today's standard, as before

### Scenario: Offering switched to cost-plus after the sale
- WHEN a Renew quote mirrors an item whose stored charges are all `fixed`, while its offering's charge has since become cost-plus
- THEN the line is not frozen, is re-priced from the current offering, and reports `NO_PRICE_BASIS_COST` (not ready) until the rep reconfigures it

### Scenario: Reconfigured cost-plus mirror
- WHEN the rep changes the bandwidth of that frozen Renew line
- THEN the line is un-frozen, marked re-priced and reconfigured, gets catalog cost lines, and is priced from today's catalog costs

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/arcPriceFreeze.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Minimal inventory-cost write-back at ARC activation
The system SHALL, when an Amend, Renew or merge-Renew order activates:
- end the item costs (`status = ended`, `ended_at` = the change-log `effective_at`) of every item removed by a `cancel` line, and the asset costs of every asset that line cancels;
- replace the item costs of every item whose mirror line was reconfigured (`_arcReconfigured`) with that line's order line costs, matched by `cost_key` — updating existing rows in place, creating rows for new keys, reactivating ended rows for returning keys and ending rows whose key is missing;
- create item costs for items added by `add` lines;
- leave the item costs of every other mirror line (frozen, or re-priced at standard without reconfiguration) unchanged;

and SHALL, when a Cancel order activates, end every open inventory cost (item and asset) of the subscription. A cost row whose values and status would not change SHALL NOT be written and SHALL NOT emit `cost_changed` (its `last_change_id` keeps pointing at the order that last changed it). No item cost id SHALL change, and every change SHALL be visible in that order's change-log snapshots.

### Scenario: Cancel
- WHEN a Cancel order for a subscription with two open item costs and one open asset cost activates
- THEN all three rows keep their ids with `status = ended`, the `cancel` row's `before_snapshot` shows them active and its `after_snapshot` shows them ended, and three `cost_changed` events with `cause: 'cancel'` are emitted

### Scenario: Re-priced mirror
- WHEN an Amend mirror line was reconfigured and its order line cost `tail` is 300 while the item cost `tail` was 270
- THEN the same item cost row now has 300, the `amend` row shows 270 → 300, and the billing payload is unchanged by the cost (it changes only through the existing price path)

### Scenario: Untouched frozen mirror
- WHEN a frozen Renew mirror line is activated
- THEN its item costs are unchanged and no `cost_changed` is emitted for them

### Scenario: Reconfigured mirror with an unchanged cost
- WHEN a reconfigured mirror line's order line cost `install` has the same values as the item cost `install`, and only `tail` changed
- THEN only `tail` is written and only one `cost_changed` (`kind: 'changed'`) is emitted

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Inventory costs follow a merge
The system SHALL, when a merge-Renew clones source items onto the merged subscription, re-point each open item cost of a cloned item to the clone (`subscription_item_id`, `subscription_id`) and each open asset cost of an asset moved to the merged subscription (`subscription_id`), without changing any id, before the `merge-result` snapshot is taken.

### Scenario: Merge two subscriptions
- WHEN subscriptions A and B, each with one costed item, are merged into M
- THEN M's two items carry the same two item cost ids, the `merge-result` `after_snapshot` shows them, and two `cost_changed` events with `cause: 'merge'` are emitted

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
