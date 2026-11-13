# Challenger — Phase 2 (§5 User Stories + Cross-Story Impact Matrix), CPQ Cost-Plus Pricing

Execution: fresh-context subagent, 2026-11-11. Inputs: App Spec §5 with §1.3–§3.5 as reference.

| Severity | Finding | Disposition |
|---|---|---|
| CRITICAL | US-1.1 switch back to fixed impossible (last price-basis element cannot be removed) | FIXED — method switch deactivates price-basis elements in the same save, with open-quote confirmation |
| CRITICAL | US-1.1 success line leaked cost through calculate-price | FIXED — cost preview vs list-only calculate-price |
| CRITICAL | Renew of an item whose charge became cost-plus / gained elements → blocked | FIXED — R1c Renew reconciliation; US-6.3 alternate path; matrix row |
| CRITICAL | No story closes requests on quote close / deletion / line removal | FIXED — US-3.7; `cost_request_cancelled` reasons; `409 QUOTE_CLOSED` without write |
| CRITICAL | Decline leaves an estimate pricing a sendable quote | FIXED — R10a decline clears the value |
| CRITICAL | Toggle-off mid-flow loses answers, ambiguous guards | FIXED — R14: guards / activation keep running; answers `409 COST_PLUS_DISABLED` retryable |
| CRITICAL | Answer re-prices just before the rep sends | FIXED — status transitions carry `expectedRevision` (R11) |
| WARNING | Identity mismatches (tenant admin, ARC operator, US-5.2 / 5.3 personas) | FIXED — §2 rows; story identities |
| WARNING | Re-confirm vs activation race; approval re-fired after order | FIXED — same lock; `approvalInvalidated` suppressed once an order exists |
| WARNING | `margin_hash` included statuses | FIXED — values only |
| WARNING | Reopen-not-applied state; `COST_ANSWER_PENDING` in US-3.5; Keep-current-cost evidence; mirror refresh discards renegotiation | FIXED |
| WARNING | Request flood, saved-recalc only, webhook timeout | FIXED — one open request per line; Overdue filter |
| WARNING | Answer API vs revision | FIXED — answer API takes the lock, no revision |
| WARNING | Clone vs idempotency | FIXED — scoped per cost line |
| WARNING | Missing stories: delete manual cost, bulk answers, toggle-on backfill, quote-side index, index deactivation | FIXED as alternate / failure paths (CSV import out of scope) |
| WARNING | Wording drift / vague verbs | FIXED — one action name; glossary: Renegotiation due, Keep current cost, Overdue request |
| WARNING | Matrix missing 14 stories | FIXED — rows added |
