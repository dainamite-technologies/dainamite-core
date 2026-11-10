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
