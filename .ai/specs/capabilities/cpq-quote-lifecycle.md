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
The system SHALL refuse to convert a quote whose stored pricing contains an invalid manual adjustment, refuse it while any price-basis cost line on a live quote line is not `confirmed` or has `valid_until` before the conversion date, or a live line stores a cost-plus charge without a price (`422 COSTS_NOT_CONFIRMED` with `lines: [{ quoteLineId, costKeys, chargeCodes }]`, either list possibly empty; checked regardless of the toggle and without relying on cost lines existing, before the order number is allocated; ARC cancel lines — items removed on Amend / Renew and Cancel-quote lines — never block), keep today's `cancelled` / `rejected` refusal, and take the quote's pricing lock while converting. Once an order exists, cost lines SHALL NOT change the quote's prices. A successful conversion SHALL copy every non-deleted quote cost line to exactly one order line cost in the same transaction, and a refused or failed conversion SHALL write none.

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

### Scenario: Conversion fails mid-way
- WHEN copying a cost line throws
- THEN no order, order line or order line cost exists afterwards

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/orderCostCopy.test.ts`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Order activation
The system SHALL activate an order (new sale or ARC) atomically: subscriptions, items, assets, inventory costs, change-log rows and the order status SHALL be committed together or not at all, and lifecycle events SHALL be emitted only after the commit. A failed activation SHALL leave no pending change in the caller's entity manager.

### Scenario: Late failure
- WHEN activation fails after the items, item costs and change-log row were flushed
- THEN no subscription, item, asset, inventory cost or change-log row from that activation exists, the order keeps its previous status, no event is emitted, and the request entity manager has no pending change sets

### Scenario: Retry after a failure
- WHEN the same order is activated again after that failure
- THEN exactly one subscription is created

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

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
