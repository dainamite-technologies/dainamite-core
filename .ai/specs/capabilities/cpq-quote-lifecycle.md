# Capability: cpq-quote-lifecycle

How CPQ quotes are recalculated, moved through their statuses and converted into orders and activated, and how projects hook their own rules into those writes.

## Requirement: Recalculation
The system SHALL allow recalculating a quote only for users with `cpq.quotes.manage`, and SHALL refuse a saved recalculation on a quote in a terminal status.

### Scenario: Viewer
- WHEN a user with only `cpq.quotes.view` posts `/api/cpq/quotes/{id}/recalculate`
- THEN the API returns `403` and nothing is stored

### Scenario: Accepted quote
- WHEN a manager posts `recalculate` with `save: true` on an `accepted` quote
- THEN the API returns `409` and stored prices are unchanged

Source: .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md

## Requirement: Mutation guards on quote writes
The system SHALL consult registered mutation guards before and after status transitions, line writes, recalculation and quote-to-order conversion.

### Scenario: Project guard blocks a transition
- WHEN a project guard rejects `ready → with_customer`
- THEN the status route returns the guard's error and the status is unchanged

Source: .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md

## Requirement: Quote to order conversion
The system SHALL refuse to convert a quote whose stored pricing contains an invalid manual adjustment, refuse it while any price-basis cost line on a live quote line is not `confirmed` or has `valid_until` before the conversion date, or a live line stores a cost-plus charge without a price (`422 COSTS_NOT_CONFIRMED` with `lines: [{ quoteLineId, costKeys, chargeCodes }]`, either list possibly empty; checked regardless of the toggle and without relying on cost lines existing, before the order number is allocated; ARC cancel lines — items removed on Amend / Renew and Cancel-quote lines — never block), keep today's `cancelled` / `rejected` refusal, and take the quote's pricing lock while converting. Once an order exists, cost lines SHALL NOT change the quote's prices. The system SHALL also refuse it while any price-basis cost line has an unapplied supplier proposal (`422 COST_ANSWER_PENDING`, listing the lines; checked before `COSTS_NOT_CONFIRMED`) and refuse an ARC quote whose carried costs are stale (`409 COST_SOURCE_CHANGED`, naming the lines). A successful conversion SHALL copy every non-deleted quote cost line to exactly one order line cost and cancel every open cost request of the quote (`quote_closed`), both in the same transaction, and a refused or failed conversion SHALL write none. A carried cost line's order line cost SHALL have its `inventory_cost_id` set to the carried item cost.

### Scenario: Invalid adjustment blocks conversion
- WHEN an accepted quote's stored line carries `ADJUSTMENT_TARGET_MISSING`
- THEN conversion returns `422 ADJUSTMENT_INVALID` naming the line and no order is created

### Scenario: Estimated tail blocks conversion
- WHEN an accepted quote has an `estimated` price-basis cost
- THEN conversion returns `422 COSTS_NOT_CONFIRMED` naming the line, and no order is created

### Scenario: Unpriced cost-plus charge blocks conversion
- WHEN an accepted quote's line stores a cost-plus charge with `unitPrice: null` (toggle off, no applicable price-basis element, or a line added while the quote was locked) and has no cost lines
- THEN conversion returns `422 COSTS_NOT_CONFIRMED` with that line, `costKeys: []` and the charge code in `chargeCodes`

### Scenario: Removed ARC item never blocks
- WHEN a Renew quote's removed item (a cancel line) still has an estimated price-basis cost and every kept line is confirmed
- THEN conversion succeeds

### Scenario: Margin-only costs never block
- WHEN only a `margin_only` cost is unconfirmed
- THEN conversion succeeds

### Scenario: Confirming at the same value lifts the block
- WHEN a pricing manager confirms the estimated cost of an accepted quote at its current value
- THEN the write is accepted under the cost lock and conversion succeeds

### Scenario: Convert a costed quote
- WHEN an accepted quote whose tail line has a confirmed `price_basis` cost of 270 EUR and a `margin_only` installation cost of 1500 EUR is converted
- THEN the order line has two order line costs with the same `cost_key`s and values, and the order line's `charges`, `nrcTotal` and `mrcTotal` equal those of a conversion of the same quote without costs

### Scenario: Pending supplier answer blocks conversion
- WHEN an accepted quote has a confirmed tail of 276 and an unapplied proposal of 310
- THEN conversion returns `422 COST_ANSWER_PENDING` naming the line, and no order or order line cost is created

### Scenario: Margin-only costs never block
- WHEN only a `margin_only` cost is unconfirmed and its request is open
- THEN conversion succeeds, that cost is copied with its `value_status`, and the request is `cancelled (quote_closed)`

### Scenario: Stale carried cost
- WHEN an accepted Amend quote carries a tail cost that another ARC changed since mirroring
- THEN conversion returns `409 COST_SOURCE_CHANGED`, and no order is created

### Scenario: Carried cost link
- WHEN an Amend quote carrying item cost `C` converts
- THEN the order line cost for `tail` has `inventory_cost_id = C`

### Scenario: Conversion fails mid-way
- WHEN copying a cost line throws
- THEN no order, order line or order line cost exists afterwards

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/orderCostCopy.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/conversionGuard.test.ts`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Order activation
The system SHALL activate an order (new sale or ARC) atomically: subscriptions, items, assets, inventory costs, change-log rows and the order status SHALL be committed together or not at all, and lifecycle events SHALL be emitted only after the commit. A failed activation SHALL leave no pending change in the caller's entity manager. Every activation SHALL first lock the order, then the source quote configuration and, for ARC orders, then the target subscriptions in id order, so that it is serialized with cost re-confirmations and with other activations of the same subscriptions.

### Scenario: Late failure
- WHEN activation fails after the items, item costs and change-log row were flushed
- THEN no subscription, item, asset, inventory cost or change-log row from that activation exists, the order keeps its previous status, no event is emitted, and the request entity manager has no pending change sets

### Scenario: Retry after a failure
- WHEN the same order is activated again after that failure
- THEN exactly one subscription is created

### Scenario: Serialized with re-confirmation
- WHEN an order is activated while a re-confirmation of one of its costs is in flight
- THEN the two run one after the other, and activation writes the re-confirmed value if the re-confirmation committed first

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md


## Requirement: Post-conversion cost re-confirmation
The system SHALL let a user with `cpq.orders.manage` and `cpq.costs.manage` change the value, currency, supplier, validity or supplier term of an order line cost while the order is not yet active (`PATCH /api/cpq/orders/{orderId}/costs/{orderLineCostId}`), under these rules:
- the change runs in its own transaction under the source quote lock, and never locks the order row (so it cannot deadlock with activation);
- `total_amount` is recomputed and `reconfirmed_at` / `reconfirmed_by_user_id` are set;
- the order's charges and totals stay unchanged;
- a changed value needs a new supplier quote reference or a note (`422 NOTE_REQUIRED`), and a foreign value needs a rate (`422 CURRENCY_NO_RATE`).

The system SHALL refuse once the order is active (`409 ORDER_ACTIVATED`) or cancelled (`409 ORDER_CANCELLED`). At activation the subscription item cost takes the re-confirmed value, with `last_order_line_cost_id` pointing at that order line cost.

### Scenario: Carrier confirms a lower price
- WHEN the order manager re-confirms the tail from 276 to 270 on a draft order
- THEN the order line cost holds 270 with a recomputed `total_amount` and `reconfirmed_at`, the order totals are unchanged, and after activation the item cost holds 270, with one `cost_changed` whose cause is `amend` / `renew` (ARC) or `activation` (new sale)

### Scenario: Race with activation
- WHEN a re-confirmation and the activation of the same order run at the same time
- THEN they are serialized; if activation commits first, the re-confirmation returns `409 ORDER_ACTIVATED` and writes nothing

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/orderCostReconfirm.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Quote pricing and status events
The system SHALL emit `cpq.quote.pricing_changed` after a committed save that changes the quote's snapshot hash, and `cpq.quote.status_changed` after every committed status change (manual or automatic), each with the pricing snapshot. `cpq.quote.status_changed` SHALL also carry `hasPendingCosts` and `hasEstimatedCosts` (booleans, computed from price-basis cost lines only: the price is pending / indicative), and neither event SHALL carry any cost, markup or margin value.

### Scenario: No-op recalculation
- WHEN a saved recalculation produces the same snapshot hash
- THEN no `cpq.quote.pricing_changed` is emitted

### Scenario: Reason edit
- WHEN a rep only changes an adjustment's reason note
- THEN no `cpq.quote.pricing_changed` is emitted (reason fields are not hash inputs)

### Scenario: Legacy quote baseline
- WHEN a quote created before this change is saved for the first time and its offers are unchanged
- THEN its snapshot hash is stored and no `cpq.quote.pricing_changed` is emitted

### Scenario: Automatic status change
- WHEN deleting the last invalid adjustment moves the quote from `incomplete` to `ready`
- THEN `cpq.quote.status_changed` is emitted with `cause: 'auto'`

### Scenario: Status change with an indicative quote
- WHEN a quote with an estimated price-basis cost moves to `with_customer`
- THEN `status_changed` has `hasEstimatedCosts: true` and no cost value

### Scenario: Margin-only estimate
- WHEN a quote whose only estimated cost is `margin_only` moves to `with_customer`
- THEN `status_changed` has `hasEstimatedCosts: false` (the price is final), while the margin flags still report the estimate

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/quotePricingEvents.test.ts`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Quote margin event
The system SHALL emit the non-broadcast event `cpq.quote.margin_changed` after commit, exactly once per write that changes the quote's `margin_hash`, including a saved recalculation that creates the quote's first cost lines (`previousMarginHash: null`). The payload SHALL carry `marginHash`, `previousMarginHash` (declared optional: `null` for a quote's first cost lines), `approvalInvalidated` (true when the status is outside `new` / `incomplete` / `ready` and no order exists), contract margin, margin %, coverage, the flags and `cause`, and no per-line amounts. The quote-level margin in this payload is visible to whoever can view workflow definitions, instances and their stored context; the manual says so, and the leak sweep checks it is the only place margin appears outside `cpq.costs.view` routes. Quotes without cost lines SHALL compute no margin.

### Scenario: Confirmation without a value change
- WHEN an estimated cost is confirmed at the same value
- THEN `margin_hash` is unchanged and no `margin_changed` is emitted

### Scenario: Term change
- WHEN a rep shortens a costed line on an `approved` quote from 36 to 12 months
- THEN `margin_hash` changes and `margin_changed` is emitted with `approvalInvalidated: true`

### Scenario: First costs
- WHEN toggling cost-plus on or adding a costed line creates a quote's first cost lines on a saved recalculation
- THEN `margin_changed` is emitted once with `previousMarginHash: null`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Status transition revision check
The system SHALL accept an optional `expectedRevision` on quote status transitions, and SHALL return `409 STALE_REVISION` without changing anything when it differs from the quote's `pricingRevision`. Callers that omit it keep today's behavior.

### Scenario: Price changed since the rep looked
- WHEN a rep sends `with_customer` with revision 7 and the quote is at revision 8
- THEN the API returns `409 STALE_REVISION`, and the status is unchanged

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Quote deletion
The system SHALL refuse to delete a quote in `accepted`, `rejected` or `cancelled`, and otherwise SHALL soft-delete the quote, its lines and the linked sales quote and lines under the quote's pricing lock, after the quote mutation guards pass, cancelling every open cost request (`quote_closed`) in the same transaction.

### Scenario: Delete a draft with an open request
- WHEN a rep deletes a `ready` quote with one open tail request
- THEN the quote and lines are soft-deleted, the request is `cancelled (quote_closed)` in the same commit, and a later answer returns `409 QUOTE_CLOSED`

### Scenario: Guard blocks deletion
- WHEN a project mutation guard rejects `cpq.quote` delete
- THEN the route returns the guard's response and nothing is deleted

Frozen by: `packages/cpq/src/modules/cpq/api/quotes/[quoteId]/__tests__/route.delete.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Exchange-rate snapshots carry to orders and subscriptions
The system SHALL copy `fx_rate`, `fx_rate_date`, `fx_rate_source` and `fx_rate_derivation` unchanged from quote cost lines to `CpqOrderLineCost` at conversion and from order line costs to `CpqInventoryCost` at activation, and SHALL include them in the `items[].costs[]` change-log snapshot. It SHALL NOT look up a rate on these paths. Order and inventory cost `total_amount` SHALL be in the document currency (`instance_amount × quantity × fx_rate`, rounded once, null when a foreign cost has no rate) while unit and instance amounts stay in the cost currency.

### Scenario: Activation keeps the quote rate
- WHEN a quote with a 300 USD tail at 0.92 is converted and activated after the rate moved to 0.95
- THEN the order line cost and the subscription item cost hold `fx_rate` 0.92 with the quote's date, source and derivation

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `cpqInventoryService` activation / snapshot tests

Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Supplier cost expiry warnings
The system SHALL, once a day per organization with the `cpq.cost_plus` toggle on, emit the non-broadcast event `cpq.quote.cost_expiring` and notify users holding `cpq.costs.manage` and `cpq.costs.view` in the quote's organization (notification `cpq.cost.expiring`). This SHALL happen exactly once per `(cost line, valid_until)`, for every confirmed price-basis cost line with `valid_until <= today + N` (`cpq.cost_expiry_lead_days`, default 14) on a quote that is not rejected or cancelled and has no order. Missed days SHALL be caught up. Neither the event nor the notification SHALL carry an amount or supplier. The daily run SHALL be a module-registered schedule (`cpq-cost-expiry` queue, 06:00 UTC) whose enabled flag a re-seed never changes, and the `cpq run-cost-expiry` CLI SHALL refuse `--today` in production unless `--dry-run` is set.

### Scenario: Warned once
- WHEN a tail cost has `valid_until` 2026-11-20, N = 14, and the job runs on 2026-11-06 and 2026-11-07
- THEN exactly one event and one notification exist for that line and date

### Scenario: Validity extended
- WHEN procurement extends the cost to 2026-12-31 after the warning
- THEN no further warning is sent until 2026-12-17, when one is sent for 2026-12-31

### Scenario: Missed days
- WHEN the job did not run for three days
- THEN the next run warns every in-scope line that became due in those days (including already expired ones, flagged `expired: true`), with no duplicates

### Scenario: Excluded quotes
- WHEN the quote is cancelled, or has been converted to an order
- THEN no warning is emitted for its cost lines

### Scenario: Schedule disabled by an admin
- WHEN a tenant admin disables the schedule and `seed-cost-plus` or tenant setup runs again
- THEN the schedule stays disabled

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costExpiryService.test.ts`, `packages/cpq/src/modules/cpq/workers/__tests__/cost-expiry.worker.test.ts`, `packages/cpq/src/modules/cpq/lib/__tests__/costExpirySchedule.test.ts`, `packages/cpq/src/modules/cpq/__tests__/cli.test.ts`, `costConfidentiality.test.ts` (Phase C)

Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md
