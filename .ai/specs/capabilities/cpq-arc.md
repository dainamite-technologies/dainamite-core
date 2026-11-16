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

Note: re-pricing a frozen Amend line from its renegotiated cost (Re-price from cost, ARC costs spec step 22) is pending on `modifiedItems`, which this codebase does not have yet; this requirement stays as it is until then.

## Requirement: Costs on ARC lines
The system SHALL let a pricing manager enter and confirm the cost values of non-frozen mirror lines (Renew mirrors re-priced at today's standard, reconfigured Amend mirrors), so their price-basis costs can be confirmed before conversion, and the `carried` costs of frozen Amend mirror lines (a margin-only change, see "Price lock on frozen Amend lines"). It SHALL refuse manual costs and markup overrides on mirror lines, and every other cost write on frozen Amend mirror lines and ARC cancel lines (`422 LINE_NOT_ELIGIBLE`). Removing an item on an Amend / Renew quote SHALL delete its line's cost lines, and ARC cancel lines SHALL never block conversion.

### Scenario: Renew mirror line with an estimated cost
- WHEN a Renew quote mirrors an item whose offering has an on-request tail cost (estimated 300)
- THEN a pricing manager can confirm it, and the quote converts once every price-basis cost is confirmed

### Scenario: Removed item
- WHEN the rep removes that item instead
- THEN its cost lines are deleted and conversion is not blocked by them

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Renew mirror line pricing
The system SHALL re-price an engine-priced mirror line on a **standalone** Renew quote at the current standard price. A cost-plus charge is priced from the line's reconciled cost lines.

The system SHALL create a mirror line on a **merge** Renew quote frozen at the item's stored charges (`_arcCostPlusFrozen`) when its source item is cost-plus. Such a line carries no cost lines, shows "Costs are not carried to merged subscriptions", and is re-priced only when a pricing input changes.

A standalone Renew line created frozen before cost carry-over SHALL stay frozen until a pricing input changes or the line is refreshed from the subscription.

### Scenario: Renew a cost-plus item
- WHEN a standalone Renew quote mirrors an item priced 400 from a carried 320 tail cost with markup 25%
- THEN the line is priced 400.00 from the carried cost, and no Phase 1 banner is shown

### Scenario: Renew a standard item
- WHEN a Renew quote mirrors an item whose charges are all `fixed` / `table`
- THEN the line is re-priced at today's standard, as before

### Scenario: Offering switched to cost-plus after the sale
- WHEN a Renew quote mirrors an item whose stored charges are all `fixed`, while its offering's charge has since become cost-plus
- THEN the line is re-priced from the current offering and reconciled: it gets a catalog cost line for each applicable element and is not ready until its price-basis cost is confirmed

### Scenario: Merge-renew of a cost-plus item
- WHEN a merge Renew quote mirrors the same item
- THEN the line keeps 400, carries no cost lines and shows the merge notice

### Scenario: Renew created under Phase 1
- WHEN a standalone Renew line created with `_arcCostPlusFrozen` before cost carry-over is recalculated
- THEN it keeps its contracted price, and Refresh from subscription re-mirrors it with carried costs

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/arcPriceFreeze.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Minimal inventory-cost write-back at ARC activation
The system SHALL, when an Amend, Renew or merge-Renew order activates, write inventory costs through one replace rule.

**Lines that replace their item's costs with their order line costs, matched by `cost_key`:**
- every mirror line that carries costs (`_arcCostsCarried`);
- every reconfigured mirror line (`_arcReconfigured`).

Replacing means:
- updating existing rows in place (same id);
- creating rows for new keys;
- reactivating the ended row of a returning key, never inserting a second row;
- ending rows whose key is missing;
- leaving rows whose state is unchanged unwritten, with no event.

**Other lines:**
- `cancel` lines end their item's costs and the asset costs of every asset they cancel (`ended_at` = the change-log `effective_at`);
- `add` lines create item costs;
- every other mirror line leaves item costs unchanged.

Asset costs are otherwise untouched by Amend and Renew (mirror lines exist for items only). A Cancel order SHALL end every open inventory cost (item and asset) of the subscription. No inventory cost id SHALL change, and every change SHALL be visible in that order's change-log snapshots and emit one `cpq.subscription.cost_changed` with `cause` `amend`, `renew`, `cancel` or `merge`.

### Scenario: Cancel
- WHEN a Cancel order for a subscription with two open item costs and one open asset cost activates
- THEN all three rows keep their ids with `status = ended`, the `cancel` row's `before_snapshot` shows them active and its `after_snapshot` shows them ended, and three `cost_changed` events with `cause: 'cancel'` are emitted

### Scenario: Cost-only Amend
- WHEN a cost-only Amend lowering the tail from 270 to 240 is moved `ready → accepted`, converted and activated
- THEN the item cost keeps its id and holds 240, the Amend change-log row shows 270 → 240, one `cost_changed (amend)` is emitted, and the amended billing payload has no added or removed items

### Scenario: Re-priced mirror
- WHEN an Amend mirror line was reconfigured and its order line cost `tail` is 300 while the item cost `tail` was 270
- THEN the same item cost row now has 300, the `amend` row shows 270 → 300, and the billing payload is unchanged by the cost (it changes only through the existing price path)

### Scenario: Returning key
- WHEN a Renew re-instantiates an element whose item cost was ended by an earlier Amend
- THEN the ended row is reactivated with the new value and keeps its id

### Scenario: Renew created before cost carry-over
- WHEN a Renew quote created under the Phase 1 freeze is activated after cost carry-over
- THEN its untouched frozen lines activate at the contracted price, and their item costs are unchanged

### Scenario: Reconfigured mirror with an unchanged cost
- WHEN a reconfigured mirror line's order line cost `install` has the same values as the item cost `install`, and only `tail` changed
- THEN only `tail` is written and only one `cost_changed` (`kind: 'changed'`) is emitted

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Inventory costs follow a merge
The system SHALL, when a merge-Renew clones source items onto the merged subscription, re-point each open item cost of a cloned item to the clone (`subscription_item_id`, `subscription_id`) and each open asset cost of an asset moved to the merged subscription (`subscription_id`), without changing any id, before the `merge-result` snapshot is taken. Merge-Renew mirror lines SHALL carry no cost lines. A re-point SHALL count as a change for the stale-carried-cost check of any other ARC quote that carried the cost.

### Scenario: Merge two subscriptions
- WHEN subscriptions A and B, each with one costed item, are merged into M
- THEN M's two items carry the same two item cost ids, the `merge-result` `after_snapshot` shows them, and two `cost_changed` events with `cause: 'merge'` are emitted

### Scenario: Stale after merge
- WHEN an Amend order on A that carried A's tail cost is activated after the merge
- THEN activation returns `409 COST_SOURCE_CHANGED`

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Amend carries subscription item costs
The system SHALL create one `carried` cost line on every Amend mirror line of a standalone target for each open cost of the source subscription item. Each line SHALL have:
- the same `cost_key`;
- `value_status = confirmed` and `value_origin = carried`;
- the item cost's `role`, `cost_type`, `charge_code`, `source`, `cost_model`, amounts, currency, FX, `index_snapshot`, supplier, supplier quote ref, validity and supplier term;
- `carried_from_item_cost_id` and `carried_from_hash`.

The system SHALL NOT instantiate catalog cost lines on an unreconfigured Amend mirror.

### Scenario: Amend a costed item
- WHEN an Amend quote mirrors an item with a tail cost of 270 EUR (Carrier X, term to 2028-11-30)
- THEN the mirror line has one carried cost line `tail` at 270 EUR, confirmed, with Carrier X and 2028-11-30, and the price is unchanged

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/arcCostCarry.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Price lock on frozen Amend lines
The system SHALL treat every cost change on a frozen Amend mirror line as margin-only:
- it SHALL NOT change the line's charges or offer price;
- it SHALL be allowed in every non-terminal quote status while no order exists;
- it SHALL change the quote's `margin_hash`.

### Scenario: Supplier renegotiation without a customer change
- WHEN procurement sets the carried tail cost on a frozen line of an Amend quote in `with_customer` from 270 to 240, with supplier quote ref `CX-2207`
- THEN the line's charges and `snapshotHash` are unchanged, the margin rises by 30 per month, and `margin_changed` is emitted

Frozen by: `packages/cpq/src/modules/cpq/commands/__tests__/quote-line-costs.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Renew reconciles costs with today's catalog
The system SHALL, on every saved recalculation of an unlocked, cost-managed standalone Renew mirror line, first run `reconcileRenewCosts`:
- carry each open item cost whose `cost_key` matches an applicable catalog element, or that has no element;
- instantiate each applicable element the item does not have;
- list each open item cost whose element no longer applies as dropped at renewal, without carrying it.

The system SHALL then run the index spec's `reevaluateCarriedIndexCosts` (an exported no-op seam until the index-costs feature fills it). It changes only the value and `index_snapshot` of carried `index` lines with `value_origin = carried` that are not renegotiation due.

### Scenario: Charge became cost-plus after the sale
- WHEN an item's charge was switched to cost-plus with an `on_request` tail element after activation, and the item is renewed
- THEN the Renew line has a catalog `tail` cost line (estimate or `none`), and the line prices from cost once the cost is known

### Scenario: Element no longer applicable
- WHEN an item cost's element no longer applies to the item's configuration
- THEN the cost is shown as dropped at renewal and, after activation, the item cost is ended

### Scenario: Index cost on a Renew
- WHEN a carried `index` cost with `value_origin = carried` that is not renegotiation due is recalculated after reconciliation
- THEN only its value and `index_snapshot` change, as of the recalculation date

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/arcCostCarry.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Renegotiation due on Renew
The system SHALL mark a carried MRC cost on a Renew line as `renegotiation_due`, with `value_status = estimated` and its value kept, when its `valid_until` or `supplier_term_end` is before the renewal's new term end. Such a cost MAY be requested and answered through the sourcing API.

The flag SHALL clear when the cost is confirmed in either way:
- by a supplier answer, or a value confirmed by hand;
- by Keep current cost, with evidence (a new supplier quote ref or a note) and dates not before the new term end (the supplier term may instead be cleared to "rolling"; `422 RENEGOTIATION_DATES_SHORT` otherwise, `422 NOT_RENEGOTIATION_DUE` on a cost that is not due).

### Scenario: Supplier term ends first
- WHEN a subscription with a tail whose supplier term ends 2027-06-30 is renewed to 2028-12-31
- THEN the tail cost line is estimated and renegotiation due, keeps its value, and conversion returns `422 COSTS_NOT_CONFIRMED`

### Scenario: Supplier answer
- WHEN procurement requests the cost and the carrier answers 255 EUR valid to 2028-12-31 for the current request id
- THEN the line is confirmed at 255, `renegotiation_due` is false, and conversion succeeds

### Scenario: Keep current cost
- WHEN procurement keeps the current cost with `valid_until` 2028-12-31 and the note "Carrier confirmed rolling term"
- THEN the line is confirmed at the same value, the flag clears, `margin_hash` is unchanged and conversion succeeds

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/arcCostCarry.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/quoteCostService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Cancel shows supplier early-exit exposure
The system SHALL show to holders of `cpq.costs.view`, for each item cancelled by a Cancel quote or by a cancel line, and for each asset cancelled with it, every **open** inventory cost (item or asset cost) whose `supplier_term_end` is after the reference date, with the whole calendar months of exposure (at least 1). MRC costs without a supplier term SHALL show "Supplier term unknown".

The reference date SHALL be today while the quote is open, and the change-log `effective_at` of the activating order afterwards. The system SHALL NOT record any cost and SHALL show no amount.

### Scenario: Supplier term outlives the cancel
- WHEN, on 2027-11-30, an open Cancel quote cancels a subscription whose Carrier X tail term ends 2028-11-30
- THEN the quote lists "Carrier X tail — term ends 2028-11-30 (exposure 12 months)"

### Scenario: After activation
- WHEN that quote's order activates on 2027-12-15
- THEN the order shows the same cost with exposure measured from 2027-12-15

### Scenario: Asset licence outlives the cancel
- WHEN that subscription also has a server asset whose licence cost term ends 2028-05-31
- THEN the quote also lists "Server licence — term ends 2028-05-31 (exposure 6 months)"

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/cancelExposure.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Stale carried costs block conversion and activation
The system SHALL refuse with `409 COST_SOURCE_CHANGED` to convert an ARC quote, or to activate its order, when any cost-managed mirror line's open item costs differ from the state recorded at mirroring. A difference in value, supplier, validity, term, status, item or set of keys counts. The response SHALL name the lines, and the system SHALL write nothing. A Refresh from subscription on a line re-mirrors it (configuration, charges and carried costs) and discards that line's renegotiated costs.

### Scenario: Two Amends renegotiate the same tail
- WHEN two Amend orders both carry the tail cost of one item, both wait for activation, and both are activated at the same time
- THEN exactly one activation succeeds, and the other returns `409 COST_SOURCE_CHANGED` and leaves the order, the items and the item costs unchanged

### Scenario: Refresh recovers a stale quote
- WHEN conversion returned `409 COST_SOURCE_CHANGED` for a line and the line is refreshed from the subscription
- THEN the line carries the current item costs and conversion succeeds

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Cost and margin in the ARC line diff
The system SHALL show in the ARC line diff, only to holders of `cpq.costs.view`, each line's MRC / NRC cost and margin. The "before" values come from the open item costs, and the "after" values from the line costs and the offer. On an order the "before" values exist only until activation.

### Scenario: Renegotiated tail
- WHEN a frozen Amend line's tail cost goes from 270 to 240 at an MRC of 345
- THEN the diff shows cost 270 → 240 and margin 75 → 105, and a user without `cpq.costs.view` sees only the price rows

Frozen by: `packages/cpq/src/modules/cpq/components/__tests__/ArcLineDiff.test.tsx`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md
