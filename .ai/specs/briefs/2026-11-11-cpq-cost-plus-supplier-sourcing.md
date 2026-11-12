# Supplier cost sourcing for on-request costs (third-party tails)

- Date: 2026-11-11
- Category: feature
- Priority signal: high — §7 Phase 2; the user's case 1 (internet with a third-party tail)
- Risk signal: medium — async external answers (correlation ids, idempotency), new non-broadcast events, Workflows recipe docs-only (U2)
- Routing: om-spec-writing "Supplier cost sourcing for on-request costs (third-party tails) — brief: .ai/specs/briefs/2026-11-11-cpq-cost-plus-supplier-sourcing.md"
- App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md — sections §1.3 (value / sourcing status, cost request, overdue request), §1.4 (R1b request part, R7, R10a, R11, R14, I-13, events + notifications), §3 (WF3), §3.5 (Cost requests page), §5 (US-3.1–3.4, US-3.7), §7 Phase 2
- Depends on: `2026-11-11-cpq-cost-plus-quote-pricing-margin.md`

## Problem

A tail cost is unknown until a carrier quotes it. In Phase 1 the pricing manager types it in after an email exchange, with no tracking. WF3 ROI: 100% of tail requests carry requested / answered timestamps; median lead time per supplier is reported from month 1; ≥ 80% of on-request costs on won quotes are answered through a request.

## Agreed direction

- Commits #22, #22a, #23, #24, #25, #28:
  - Sourcing fields on `CpqQuoteLineCost`. A request / answer / decline / cancel API with `cost_request_id` + `request_seq`, `409 COST_REQUEST_SUPERSEDED`, and idempotent answers per cost line by `supplier_quote_ref`.
  - At most one open request per cost line. Requests open only on saved recalculations; `requires_sourcing` auto-opens one.
  - Requests are cancelled in the same transaction on R1b reset, line removal, element deactivation, re-request, manual value, or quote close / delete.
  - The answer API takes the lock itself (no revision needed). On a converted quote it returns `409 QUOTE_CONVERTED`; with the toggle off, `409 COST_PLUS_DISABLED`, retryable.
  - Locked quotes: a same-value answer is confirmed (lock-exempt). A different value becomes `proposedAmount` + `COST_ANSWER_PENDING` + **Reopen and apply supplier answer**.
  - A decline clears the value (R10a); the alternative supplier's value goes on the same cost line.
  - Events `cost_requested`, `cost_request_cancelled`, `cost_valued` (non-broadcast, no amounts). Notifications: request opened → cost managers; answered / declined → quote owner.
  - Cost requests page: list, row expansion with request history, Answer / Decline dialogs, Overdue filter. No detail page (architect #1).
  - Sourcing workflow recipe (event trigger → `USER_TASK` → `CALL_API` answer), seeded disabled, plus demo quotes in `requested` / `declined` states.
- **Ladder:** events and notifications (rung 3); Workflows (rung 4, project config); API and page (rung 5). CPQ never depends on a workflow existing.
- **Rejected:** a CPQ-owned sourcing state machine (Q-D5); a supplier portal; competing bids (Q-D11); a detail page per request.

## Resolved unknowns

| Question | Answer (from the App Spec) |
|----------|----------------------------|
| Process owner | Project workflow; CPQ provides events, the queue page, the API and notifications (Q-D5) |
| Several carrier bids | Out of scope; one cost line holds the chosen answer (Q-D11) |
| Late answer after conversion | `409 QUOTE_CONVERTED` in this phase; margin-only re-confirmation arrives with ARC (Q-D13) |
| Overdue | Queue filter, default 5 working days, tenant-configurable |
| Workflows API shape | **docs-only (U2):** trigger `filterConditions`, `USER_TASK` form, `CALL_API` — verify against the installed framework |
| Acceptance criteria | §7 Phase 2 domain criteria (I-13, R11, R1b request part, events, US-3.7) and business criteria |

## Non-goals

- FX (separate feature); expiry warnings (index / expiry feature); procurement execution; supplier invoice reconciliation; CSV bulk answers.

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/`: `data/entities.ts`, `migrations/`, `api/quotes/[quoteId]/costs/**`, `api/cost-requests/**` (new), `events.ts`, `notifications.ts` (new types), `backend/cpq/cost-requests/page.tsx` (new), quote status / delete paths.
- `src/modules/demo_gix/` seed (workflow recipe, request states); `manuals/cpq-cost-plus-pricing.md`.
