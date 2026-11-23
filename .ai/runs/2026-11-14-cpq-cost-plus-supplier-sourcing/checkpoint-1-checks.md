# Checkpoint 1 — Steps A.1–A.4, B.5–B.6 (+ 4-review-fix, 6-review-fix) verified; Phase A closed

- **Checkpoint:** 1
- **Steps covered:** A.1–A.4, B.5, B.6, 4-review-fix, 6-review-fix (6a9af83..408849a)
- **Recorded:** 2026-11-14
- **Touched areas:** `packages/cpq` — characterization tests; `withQuotePricingWrite` options (`shortCircuit`, `afterCommit`); sourcing columns + queue / request indexes (Migration20261114192129) + `cpq.cost_requests.overdue_working_days` toggle; pure rules `costSourcing.ts`; `costSourcingService` + request / cancel-request commands and routes; actor threading; auto-open + R1a / R1b cancellation in cost resolution; sourcing signal seam for step 12.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn typecheck` | ✅ pass | clean after 6-review-fix |
| `yarn test` (full) | ✅ pass | 149 suites, 2280 tests; golden fixtures unchanged |
| Review of Steps 1–6 | ✅ 2 fixed | margin-only answers / declines lock-exempt (R11) → 4-review-fix; clone's first recalculation opened requests (spec "Clone", R16) → 6-review-fix |
| UI / integration | ⏭️ skipped | no UI in this window; app not runnable here — CI (manual dispatch) |

## Decisions accepted

- Request `note` is not persisted (no column in the spec).
- R1b cancels an open request on any driver change, including lines whose value was already `none`.
- Sourcing signals from `recalculateLockedQuote` callers (adjustment / quote cost services) are not wired yet — step 12 wires the publisher (locked quotes never auto-open; R1a / R1b cancellations there must be covered by step 12).
