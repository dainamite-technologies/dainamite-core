# Checkpoint 4 — Steps D.17–D.21 verified; Phase D closed (all 21 steps done)

- **Checkpoint:** 4
- **Steps covered:** D.17–D.21 (4c4db77..e898338)
- **Recorded:** 2026-11-14
- **Touched areas:** `packages/cpq` — order page Costs section + Order margin card + `order-cpq-tab` summary; subscription / asset page costs, margins, ended toggle, `data-table:cpq.inventory_asset_costs` injection spot; Change History cost diffs (`costDiff.ts`, change-log load via `apiCall`); `manuals/cpq-cost-plus-pricing.md` "Orders and subscriptions"; Playwright `TC-CPQ-COST-ORDER-001`; capability archive (`cpq-cost-carry-through.md`, `cpq-subscription-history.md`, updates to quote-lifecycle / arc / quote-pricing).

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn typecheck` | ✅ pass | clean (covers the Playwright spec) |
| `yarn test` (full) | ✅ pass | 142 suites, 2076 tests; both golden tests unchanged |
| Review of Steps 17–21 | ✅ no major | holder detection uses the projection the API returned (top-level `currencyCode` only in the full projection); E2E builds its own fixtures via API (no demo-data dependency); toggle "off" in E2E removes the override (falls back to the default) |
| UI / integration | ⚠️ partial | UI covered by pure-helper + static-markup tests only — never rendered in a browser (none here); browser QA owed. Playwright + migrations run in CI (manual `ci.yml` dispatch on this branch, since `ci.yml` triggers only for PRs into `main`) |
