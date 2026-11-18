---
"@dainamite/cpq": minor
---

Supplier cost sourcing for cost-plus pricing.

- Migrations `Migration20261114192129` (request columns and indexes on
  `cpq_quote_line_costs`) and `Migration20261115000100` (`value_origin` check
  allows `supplier`); run `yarn mercato db migrate`.
- A cost line carries one cost request at a time. It opens on a saved
  recalculation for `requires_sourcing` elements or manually, and is cancelled
  with its cause (reconfiguration, line removal, element deactivation, manual
  value, re-request, quote closed / deleted / converted).
- New routes: `request`, `cancel-request`, `answer`, `decline`, `apply-answer`
  under `/api/cpq/quotes/{quoteId}/costs/{costId}/`, and `GET /api/cpq/cost-requests`
  (+ `/{costId}`). Answers are idempotent (`supplierQuoteRef` + payload hash);
  stale ids get `409 COST_REQUEST_SUPERSEDED`. On a locked quote a different
  value is a proposal that blocks conversion (`422 COST_ANSWER_PENDING`) until
  "Reopen and apply supplier answer".
- New page `/backend/cpq/cost-requests`, quote Costs panel actions, three
  non-broadcast events (`cpq.quote.cost_requested`, `cost_request_cancelled`,
  `cost_valued`, no amounts) and four notification types (optional
  `notifications` peer).
- New numeric toggle `cpq.cost_requests.overdue_working_days` (default 5).
- `DELETE /api/cpq/quotes/{id}` now runs in the quoting service and cancels open
  requests; behaviour is otherwise unchanged (`409` on accepted / rejected /
  cancelled). `withQuotePricingWrite` accepts an options object (positional
  overload kept).
