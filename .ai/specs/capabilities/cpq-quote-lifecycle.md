# Capability: cpq-quote-lifecycle

How CPQ quotes are recalculated, moved through their statuses and converted into orders, and how projects hook their own rules into those writes.

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
The system SHALL refuse to convert a quote whose stored pricing contains an invalid manual adjustment, in addition to today's `cancelled` / `rejected` refusal, and SHALL take the quote's pricing lock while converting.

### Scenario: Invalid adjustment blocks conversion
- WHEN an accepted quote's stored line carries `ADJUSTMENT_TARGET_MISSING`
- THEN conversion returns `422 ADJUSTMENT_INVALID` naming the line and no order is created

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Quote pricing and status events
The system SHALL emit `cpq.quote.pricing_changed` after a committed save that changes the quote's snapshot hash, and `cpq.quote.status_changed` after every committed status change (manual or automatic), each with the pricing snapshot.

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

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
