# Checkpoint 2 — Steps B.7–B.11 (+ 8-typecheck-fix, 7-review-fix) verified; Phase B closed

- **Checkpoint:** 2
- **Steps covered:** B.7–B.11, 8-typecheck-fix, 7-review-fix (2911985..57fbf6e)
- **Recorded:** 2026-11-15
- **Touched areas:** `packages/cpq` — answer / decline / apply-answer commands and routes (I-13 matrix, locked proposals, `COST_ANSWER_PENDING` in the conversion guard, `value_origin = supplier`); cancellation on close (status, manual value, line removal, clone reset, conversion, quote DELETE moved into `cpqQuotingService.deleteQuote`); element deactivation fan-out; `sales.quote.deleted` subscriber (dormant — core never emits it); cost request queue API + usage `openRequests`; Migration20261115000100 (value_origin check).

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| `yarn test` (full) | ✅ pass | 154 suites, 2384 tests; golden fixtures unchanged |
| CI on e23ead6 (manual dispatch) | ✅ pass | unit + integration on Postgres; Migration20261114192129 and Migration20261115000100 applied |
| Review of Steps 7–11 | ✅ 1 major fixed | `value_origin = 'supplier'` violated the feature-1 CHECK (every answer would fail on Postgres) → 7-review-fix migration; foreign-currency answers now keep the supplier's amount (spec edge case) |
| UI / integration | ⏭️ skipped | no UI in this window |

## Decisions accepted

- `COST_ANSWER_PENDING` is checked before `COSTS_NOT_CONFIRMED` (spec does not fix the order; the proposal is the actionable message).
- Toggle off: answer / decline → 409 `COST_PLUS_DISABLED`; apply → 404 (as the contract).
- Deactivation fan-out covers cost-element writes; charge-level changes rely on R1a + the answer-side inactive-element check.
- A manual write cancels only on a value / status change (not note / supplier edits).
- `sales.quote.deleted` is declared but not emitted by core (`sales/commands/documents.ts` delete passes no events) — the subscriber is dormant; the queue's deleted-quote filter and `QUOTE_CLOSED` cover the case (Q7).
- Queue routes require `cpq.quotes.view` + `cpq.costs.view` (no status-only projection on them).
