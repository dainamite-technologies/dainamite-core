# Capability: cpq-cost-sourcing

How a supplier cost is asked for, answered and applied on a quote cost line: one cost request per line, correlated and idempotent answers, the locked-quote proposal flow, cancellation with every cause, events, notifications and the request queue. The cost lines themselves live in `cpq-quote-pricing`; quote conversion in `cpq-quote-lifecycle`.

## Requirement: Cost requests on quote cost lines
The system SHALL let a user with `cpq.quotes.manage` open a cost request on any eligible cost line of a quote that is not closed and has no order — eligible meaning not on a Cancel line and not frozen-unpriceable; `catalog`, `manual` and `carried` cost lines are all eligible, including renegotiation-due costs on Renew mirrors — and SHALL return `422 LINE_NOT_ELIGIBLE` otherwise. It SHALL open one automatically on a saved recalculation of an unlocked line for every `on_request` cost line whose element has `requires_sourcing`, whose value is not confirmed and which was never requested (or was just reset by a reconfiguration). Each request SHALL get a new `cost_request_id` and `request_seq` = previous + 1, and a cost line SHALL have at most one open request.

### Scenario: Auto-open on adding a tail
- WHEN a rep adds "IP Transit with partner tail" at a site and the quote is saved
- THEN the tail cost line has `sourcing_status = requested`, a `cost_request_id`, `request_seq = 1`, and the line shows "Cost requested"

### Scenario: Preview opens nothing
- WHEN the configurator previews the same product without saving
- THEN no request exists and no `cost_requested` event is emitted

### Scenario: Re-request
- WHEN a pricing manager requests the cost again on a line with open request seq 1
- THEN request seq 1 is closed as `cancelled (re_requested)` in the history, seq 2 is open with a new id, and exactly one `cost_request_cancelled` and one `cost_requested` are emitted

### Scenario: Renegotiation-due carried cost on a Renew mirror
- WHEN a Renew quote carries an `estimated` tail cost, the rep requests the cost and procurement answers it `confirmed` with the current request id
- THEN the carried cost line is `confirmed` with `value_origin = supplier`, and conversion is no longer blocked by it (clearing the ARC spec's `renegotiation_due` flag is a no-op until that spec ships)

### Scenario: Cancel line
- WHEN a rep requests a cost on a line marked for removal (`action = 'cancel'`)
- THEN the API returns `422 LINE_NOT_ELIGIBLE` and nothing is written

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcingService.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcing.test.ts`, `packages/cpq/src/modules/cpq/api/__tests__/costSourcingRoutes.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Supplier answers are correlated and idempotent
The system SHALL apply a supplier answer only when it quotes the cost line's current open `cost_request_id`, and SHALL otherwise return `409 COST_REQUEST_SUPERSEDED` with no change; this check runs before the idempotency check. A repeated answer with the same `supplier_quote_ref` whose normalized payload hash equals the stored `last_answer_hash` SHALL return `200` without changing the revision or emitting events; the same reference with a different hash SHALL return `409 SUPPLIER_QUOTE_REF_CONFLICT`.

### Scenario: Stale answer after reconfiguration
- WHEN bandwidth changes from 1G to 10G (request seq 1 cancelled, seq 2 opened) and the carrier answers seq 1
- THEN the API returns `409 COST_REQUEST_SUPERSEDED` and the cost line is unchanged

### Scenario: Workflow retry
- WHEN a workflow posts the same answer (ref `CARR-889`) twice
- THEN the second call returns `200` with `outcome: 'noop'`, `pricingRevision` is unchanged, and no event is emitted the second time

### Scenario: Clone accepts its own answer
- WHEN a quote is cloned and the clone's cost line is requested and answered with ref `CARR-889`, already used on the source quote
- THEN the clone's answer is applied as new

### Scenario: Deactivated element
- WHEN the tail element is deactivated and the carrier answers the still-open request
- THEN the API returns `409 COST_REQUEST_SUPERSEDED` and nothing is written; the request is cancelled `(element_deactivated)` by the post-commit per-quote write or the quote's next saved recalculation (R1a)

### Scenario: Same reference, changed payload
- WHEN a second answer quotes the current request id and ref `CARR-889` but amount 295 instead of 280
- THEN the API returns `409 SUPPLIER_QUOTE_REF_CONFLICT` and nothing is written

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcingService.test.ts`, `packages/cpq/src/modules/cpq/api/__tests__/costAnswerRoutes.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Answers on unlocked and locked quotes
The system SHALL apply an answer on an unlocked quote as the cost line's value (`value_origin = supplier`, status `confirmed` or `estimated` as answered) and re-price. On a locked quote it SHALL confirm an answer with the same amount and currency without changing the price, and SHALL store an answer with a different value only as a proposal, leaving the price unchanged, and SHALL refuse conversion (`422 COST_ANSWER_PENDING`, before `COSTS_NOT_CONFIRMED`) while a price-basis proposal is unapplied. Margin-only costs are exempt from the cost lock, so their answers always apply. An answer in a currency other than the quote's SHALL be stored in its own currency with value status `none` and `CURRENCY_NO_RATE` until exchange rates exist, so nothing prices from it; the currency format (`^[A-Z]{3}$`) and a `validUntil` not before today are checked after the idempotency check (`422`).

### Scenario: Unlocked answer prices the line
- WHEN procurement answers 280 EUR, confirmed, on a `ready` quote
- THEN the cost line is `confirmed` at 280 with origin `supplier`, the line re-prices, `answered_at − requested_at` is recorded, and the requester is notified

### Scenario: Same value on a sent quote
- WHEN the quote is `with_customer` with an estimated tail of 276 and the carrier answers 276 EUR
- THEN the cost line becomes `confirmed`, `charges` and `snapshotHash` are unchanged, and conversion is no longer blocked by that line

### Scenario: Margin-only cost on a sent quote
- WHEN the quote is `with_customer` and the carrier answers a `margin_only` cost with a different value
- THEN the value is applied, no proposal exists, and the price is unchanged

### Scenario: Foreign-currency answer
- WHEN a USD answer lands on a EUR quote
- THEN the cost line keeps the supplier's amount in USD, its value status is `none` with `CURRENCY_NO_RATE`, and the line is not priced from it

### Scenario: Different value on a sent quote
- WHEN the same quote receives 310 EUR
- THEN `proposed_amount = 310`, the value stays 276 `estimated`, `charges` are unchanged, the line shows "Supplier answered with a different cost", and the requester gets the "answer pending" notification

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcingService.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcing.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Reopen and apply supplier answer
The system SHALL let a user with `cpq.quotes.manage` and `cpq.costs.manage` apply a pending proposal in one write that moves a locked quote back to `ready`, applies the proposed value under the same `cost_request_id` (`value_origin = supplier`), clears the proposal and re-prices. It SHALL require the quote's current `expectedRevision` and SHALL run the quote mutation guards.

### Scenario: Apply
- WHEN the pricing manager applies the 310 proposal with the current revision
- THEN the quote is `ready` (or `incomplete` if another line is not ready), the cost line is 310 `confirmed`, `pricing_changed` and `status_changed (manual)` are emitted, and the earlier customer acceptance must be repeated

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcingService.test.ts`, `packages/cpq/src/modules/cpq/api/__tests__/costAnswerRoutes.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Declined requests
The system SHALL let a user with `cpq.costs.manage` decline an open request with a reason (1–500 characters). On an unlocked quote the value SHALL become `none` with any estimate moved into the note; on a locked quote the amount SHALL be kept and its status set to `estimated`. A request that is not open SHALL NOT be declined.

### Scenario: No coverage
- WHEN procurement declines with "No coverage at site" on a `ready` quote whose tail was estimated at 300
- THEN `sourcing_status = declined`, `value_status = none`, the note holds "estimate 300 discarded: declined", the line is not ready, and the requester gets "Cost declined"

### Scenario: Decline an answered request
- WHEN procurement declines a request that is already `answered`
- THEN the API returns `409 REQUEST_NOT_OPEN`

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcingService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Requests are cancelled with their cause
The system SHALL cancel an open request, in the same transaction as the cause, when the cost line is reset by a reconfiguration (`reconfigured`), the line is removed (`line_removed`), the cost is re-requested (`re_requested`), a manual value is entered (`manual_value`), a user cancels it (`cancelled_by_user`), or the quote is rejected, cancelled, deleted through CPQ or converted (`quote_closed`). A later answer SHALL return `409 COST_REQUEST_SUPERSEDED`, `409 QUOTE_CLOSED` or `409 QUOTE_CONVERTED` with no write. A quote deleted through the sales module SHALL have its requests cancelled by a subscriber on `sales.quote.deleted` (eventually consistent); because core does not emit that event today, the queue hides rows of deleted quotes and the answer routes return `QUOTE_CLOSED`. `QUOTE_CONVERTED` SHALL carry the `orderId`.

### Scenario: Rep rejects the quote
- WHEN a quote with three open requests moves to `rejected`
- THEN all three are `cancelled (quote_closed)` in the same commit, three `cost_request_cancelled` events follow, and the Cost requests page no longer lists them

### Scenario: Late answer on a closed quote
- WHEN the workflow answers one of those requests afterwards
- THEN the API returns `409 QUOTE_CLOSED` and nothing is written

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costSourcingService.test.ts`, `packages/cpq/src/modules/cpq/subscribers/__tests__/sales-quote-deleted-cancel-requests.test.ts`, `packages/cpq/src/modules/cpq/commands/__tests__/quote-line-cost-sourcing.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Sourcing events carry no amounts
The system SHALL emit, after commit and never to browsers, `cpq.quote.cost_requested` once per opened request, `cpq.quote.cost_request_cancelled` once per cancelled request with its reason, and `cpq.quote.cost_valued` once per sourcing-driven value or value-status change with `leadTimeHours` for answers and declines. None of them SHALL carry a cost amount, currency amount, markup or margin.

### Scenario: Leak check
- WHEN a tail is answered at 7777.77
- THEN no payload of the three events contains 7777.77, and all three are declared `clientBroadcast: false`

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/costSourcingEvents.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/costConfidentiality.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Answer API while cost-plus is disabled
The system SHALL return `409 COST_PLUS_DISABLED` (retryable) from the answer and decline routes when the tenant toggle `cpq.cost_plus` is off, and `404` from every other sourcing route. Cancellation on quote close SHALL run regardless of the toggle.

### Scenario: Workflow answers while disabled
- WHEN the toggle is off and a workflow answers a valid open request
- THEN the API returns `409 COST_PLUS_DISABLED`, nothing is written, and the same call succeeds after the toggle is turned back on

Frozen by: `packages/cpq/src/modules/cpq/api/__tests__/costAnswerRoutes.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Cost requests queue
The system SHALL list cost requests across quotes for users with `cpq.quotes.view` and `cpq.costs.view`, filtered by sourcing status (default `requested`), cancel reason (requests closed by conversion appear under `cancelled` + `quote_closed`), supplier, quote and overdue (open longer than the tenant threshold, default 5 working days), excluding cost lines of deleted quotes, sorted oldest first, paginated (page size ≤ 100).

### Scenario: Overdue filter
- WHEN a request opened on Monday is listed with `overdue=true` on the following Tuesday (6 working days later) and another opened on Friday of the same week
- THEN only the Monday request is returned

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costRequestQueue.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Sourcing notifications
The system SHALL notify users holding both `cpq.costs.view` and `cpq.costs.manage` in the quote's organization when a request opens, and SHALL notify the user who opened the request when it is answered, answered with a different value on a locked quote, or declined. The answered notification SHALL carry the resulting `valueStatus` and say whether the line is now priced, still lacks an exchange rate, or is still not ready. Notifications SHALL carry the quote number and cost name and no amount.

### Scenario: Request opened
- WHEN a tail request opens on quote Q-123
- THEN every user of that organization with `cpq.costs.view` and `cpq.costs.manage` receives "Cost requested on quote Q-123 — Last-mile tail", linking to the Cost requests page filtered on that quote, and a user with only `cpq.costs.manage` receives nothing

### Scenario: Answered but rate missing
- WHEN a USD answer lands on a EUR quote and no exchange rate exists
- THEN the requester receives "Cost answered on quote Q-123 — exchange rate missing, line not priced yet" with `valueStatus` in the notification data

Frozen by: `packages/cpq/src/modules/cpq/lib/__tests__/costNotifications.test.ts`, `packages/cpq/src/modules/cpq/subscribers/__tests__/costRequestNotifications.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md
