# Checkpoint 3 — Steps B.9, B.10 (+ 9-review-fix) verified; Phase B closed

- **Checkpoint:** 3
- **Steps covered:** B.9, B.10, B.9-review-fix (8801297..a371ea3)
- **Recorded:** 2026-11-13T09:44:39Z
- **Touched areas:** `packages/cpq` — `costPlusPrice` (R2 formulas, single rounding, per_unit unit at 4 dp, COST_PENDING / NO_PRICE_BASIS_COST / COST_PLUS_DISABLED / MARKUP_INVALID into line validation errors), `COST_PLUS_NOT_AVAILABLE` lifted, cost values handed in memory from resolution to pricing (save persists, preview computes, locked reads stored), `quoteMargin` (`computeQuoteMargin`, `computeMarginHash`), percent price rules exact on cost-plus totals. No UI.

## Checks

| Check | Result | Notes |
|---|---|---|
| Golden fixture | ✅ unchanged | no diff since 064dd52; golden test green |
| `yarn typecheck` | ✅ pass | clean |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn test` (full) | ✅ pass | 108 suites, 1622 tests |
| Review of Steps 9–10 | ✅ 1 major fixed | percent price rules drifted on cost-plus per_unit totals → 9-review-fix |
| UI / integration | ⏭️ skipped | no UI in this window; app not runnable here |
