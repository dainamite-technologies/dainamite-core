# Checkpoint 4 — Steps C.11–C.13 (+ 12-review-fix) verified

- **Checkpoint:** 4
- **Steps covered:** C.11, C.12, C.13, C.12-review-fix (c7e8e7d..5e21994)
- **Recorded:** 2026-11-13T13:09:37Z
- **Touched areas:** `packages/cpq` — `GET /api/cpq/quotes/{quoteId}/costs` (two projections), `POST /api/cpq/cost-preview`, `GET /api/cpq/cost-plus/usage`; commands `cpq.quote_line_cost.create/update/delete` and `cpq.quote_markup_override.set/clear` (non-undoable, non-replayable, redacted snapshots) with routes; cost lock + R11 exemptions (`costLock.ts`); manual per_unit amounts follow the quantity. No UI.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | new routes / commands registered |
| `yarn typecheck` | ✅ pass | clean |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn test` (full) | ✅ pass | 115 suites, 1684 tests; golden fixture unchanged |
| Review of Steps 11–13 | ✅ 1 major fixed, 1 minor deferred | stale manual per_unit amount → 12-review-fix; revision bump on margin-only writes → final review (see NOTIFY) |
| UI / integration | ⏭️ skipped | no UI in this window; app not runnable here (no Postgres/Docker) |
