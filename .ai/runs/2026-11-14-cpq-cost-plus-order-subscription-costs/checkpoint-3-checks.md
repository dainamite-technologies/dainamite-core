# Checkpoint 3 — Steps C.10–C.16 (+ 14-review-fix) verified; Phase C closed

- **Checkpoint:** 3
- **Steps covered:** C.10–C.16, 14-review-fix (cc67ea5..2996d06)
- **Recorded:** 2026-11-14
- **Touched areas:** `packages/cpq` — Renew freeze for cost-plus items (`costPlusItem.ts`, `_arcCostPlusFrozen`, `isFrozenMirrorLine`); `_arcReconfigured` marker and catalog cost lines on reconfigured mirrors only (R1c), value PATCH accepts them (no conversion deadlock); Renew banner on the quote page; inventory cost write-back on Amend / Renew / Cancel (`replaceItemCosts`, `endItemCosts`, `endAssetCosts`, `endSubscriptionCosts`); merge re-point (`repointItemCosts`, `repointAssetCosts`); `cpq scrub-change-log-costs` CLI; MIGRATION.md + changeset.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | CLI registered |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn typecheck` | ✅ pass | clean |
| `yarn test` (full) | ✅ pass | 138 suites, 2047 tests; pricing golden + subscription event payload golden unchanged |
| Review of Steps 10–16 | ✅ 1 minor fixed | merged asset's ended cost rows stayed on the old subscription id → 14-review-fix; write-back reads `_arcReconfigured` from the source quote line before the quote-only markers are stripped (verified) |
| UI / integration | ⏭️ skipped | Renew banner is a pure helper + `Alert` (unit-tested); app not runnable here (no Postgres/Docker/browser) — `TC-CPQ-ARC-*` in CI |

## Decisions accepted

- `isFrozenMirrorLine` for Renew requires both `_arcPriceFrozen` and `_arcCostPlusFrozen` (always set together by the builder).
- Feature-1 cost rows on unreconfigured mirror lines are soft-deleted by cost resolution (feature 1 unreleased; no production rows).
- ARC `add` lines own item costs only (Q2); a re-pointed cost ended in the same merge reports only `ended`.
- Scrub CLI covers soft-deleted change-log rows; `--tenant` optional (all tenants by default).
