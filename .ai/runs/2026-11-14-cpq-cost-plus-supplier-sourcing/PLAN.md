# Execution plan — CPQ cost-plus: supplier cost sourcing (cost requests, answers, notifications, queue)

Source doc: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md
App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md
Base branch: feat/cpq-cost-plus-order-subscription-costs (stacked on PR #94 → #93; retarget to main once they merge)
Branch: feat/cpq-cost-plus-supplier-sourcing
Engine: om-auto-create-pr-loop (steps: 20, --loop: no)

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. Step commits flip `Status`; the main session fills `Commit` with the real code-commit SHA at each checkpoint. The first row whose `Status` is not `done` is the resume point. Step ids and `Exec` cells are immutable once committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| A | 1 | Characterization tests | group:A1 | done | 6a9af83 |
| A | 2 | withQuotePricingWrite options object | group:A2 | done | 1dffc79 |
| A | 3 | Entity, migration and overdue toggle | group:A2 | done | d6ce394 |
| A | 4 | Pure sourcing rules | group:A2 | done | 69264a7 |
| B | 5 | Sourcing service, request / cancel commands and routes | group:B1 | done | 5502969 |
| B | 6 | Auto-open and R1b / R1a cancellation | group:B1 | done | 33168d6 |
| B | 7 | Answer and decline | group:B2 | todo | |
| B | 8 | Apply answer route | group:B2 | todo | |
| B | 9 | Cancellation on close | group:B3 | todo | |
| B | 10 | Element deactivation fan-out and sales quote deleted subscriber | group:B3 | todo | |
| B | 11 | Queue read API and usage openRequests | group:B4 | todo | |
| C | 12 | Sourcing events | group:C1 | todo | |
| C | 13 | Notifications | group:C1 | todo | |
| C | 14 | Confidentiality sweep extension | group:C1 | todo | |
| D | 15 | Cost requests page | group:D1 | todo | |
| D | 16 | Quote Costs panel additions | group:D1 | todo | |
| E | 17 | Demo seed | group:E1 | todo | |
| E | 18 | Workflow recipe seeded disabled | group:E1 | todo | |
| E | 19 | Manual, migration notes and E2E | group:E2 | todo | |
| E | 20 | Archive the Delta | group:E2 | todo | |

## Goal

A cost line carries at most one supplier cost request (`cost_request_id`, `request_seq`), opened automatically for `requires_sourcing` elements on a saved recalculation or manually; procurement (or a workflow through the API) answers with the current request id or declines; stale ids are refused, repeated answers are idempotent (`last_answer_hash`); every cause that makes a request meaningless cancels it in the same transaction; locked quotes keep their price (same value confirms, a different value becomes a proposal that blocks conversion until "Reopen and apply supplier answer"); non-broadcast events without amounts, four notification types, a Cost requests page, and a disabled workflow recipe in `demo_gix`.

## Scope

`packages/cpq/src/modules/cpq/` (quote line cost entity columns + migration, `services/costs/costSourcing.ts` + `costSourcingService`, commands, routes, `withQuotePricingWrite`, `costResolution`, quoting service close / delete / clone paths, events, notifications, subscribers, queue API, Cost requests page, quote Costs panel), `src/modules/demo_gix/seeds/`, `manuals/cpq-cost-plus-pricing.md`, `packages/cpq/MIGRATION.md` + changeset, `.ai/specs/capabilities/`. Steps follow the feature spec's Implementation Plan 1:1.

## Non-goals

FX (R3 / R4 — foreign-currency spec), full ARC cost carry (`renegotiation_due` is guarded as a no-op until the ARC spec ships), index costs and expiry. No migration is applied locally (CI applies them).

## Delivery decision (autonomous default)

The spec's internal "PR A backend / PR B UI and demo" split is folded into this one PR (consistent with features 1–2): per-step commits keep it bisectable. Stacked on PR #94's branch.

## Notes from features 1–2 (as built)

- The spec calls feature 1 "PR #87": here it is PR #93; feature 2 is PR #94. Step 1's characterization baseline is the PR #94 tip this branch starts from (e31836f), not a `main` merge SHA.
- `_arcReconfigured` (sticky, quote-only) marks reconfigured mirror lines; only those (and non-mirror lines) get catalog cost lines; the cost value PATCH accepts them; manual costs / markup overrides are refused on mirrors (feature 1). Q12/Q14 eligibility must use the same predicates (`isArcMirrorLine`, `isArcReconfigured`, `isFrozenMirrorLine`, `isArcTerminationLine`).
- The conversion guard (`services/costs/conversionGuard.ts`) and cost lock (`costLock.ts`, `COST_CLOSED_STATUSES`) are where `COST_ANSWER_PENDING` and the closed-quote rules plug in. Quote writes go through `withQuotePricingWrite` (`services/priceAdjustments/quotePricingWrite.ts`).
- Conversion copies cost lines to `CpqOrderLineCost` (`services/costs/orderCostCopy.ts`) — new sourcing columns are quote-side only unless the spec says otherwise.
- Confidentiality sweep: `services/__tests__/costConfidentiality.test.ts` (sentinel 7777.77).

## Risks

- Many write paths gain a cancellation side effect (step 9) — characterize first (step 1).
- Element deactivation fan-out is post-commit, best effort per quote (Q4).
- No database / browser locally: migrations generated DB-less; integration / Playwright run in CI via manual `ci.yml` dispatch (it only triggers for PRs into `main`).

## External references

None. Framework APIs (notifications, workflows, feature toggles) are read from installed `node_modules/@open-mercato/*`.
