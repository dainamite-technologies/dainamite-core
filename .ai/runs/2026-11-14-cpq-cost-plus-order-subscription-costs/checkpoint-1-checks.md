# Checkpoint 1 — Steps A.1, B.2–B.5 verified

- **Checkpoint:** 1
- **Steps covered:** A.1, B.2, B.3, B.4, B.5 (5f93d4d..f02d114)
- **Recorded:** 2026-11-14
- **Touched areas:** `packages/cpq` — characterization tests; `CpqOrderLineCost` / `CpqInventoryCost` entities + Migration20261114101001 (two tables, partial uniques, owner/status CHECKs); atomic `activateOrder` (forked EM, one transaction, events after commit, pre-generated change-log ids); conversion copy (`orderCostCopy.ts`); item / asset cost sync at activation (`inventoryCostSync.ts`, `createSubscriptionWithCosts`, new-sale assets created inside `createSubscription`). No UI, no events added yet.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn workspace @dainamite/cpq build` | ✅ pass | |
| `yarn typecheck` | ✅ pass | clean |
| `yarn test` (full) | ✅ pass | 128 suites, 1945 tests; `costPlusGolden.json` and the subscription event payload golden unchanged |
| Migration snapshot diff | ✅ pass | table/column/index comparison: only `cpq_inventory_costs` and `cpq_order_line_costs` added (the large textual diff is reordering) |
| Review of Steps 3–5 | ✅ no major | `activateOrder` refuses to run inside an outer transaction — all callers (activate route, `transitionOrderStatus`, `demo_gix` seed via plain `seedExamples` EM) verified non-transactional; cost copy uses the quote-margin per-line total; assetizable-line costs owned by the asset (Q2) |
| UI / integration | ⏭️ skipped | no UI in this window; app not runnable here (no Postgres/Docker) — `TC-CPQ-ARC-*` run in CI |

## Characterization changes (deliberate, per spec MODIFIED scenarios)

- Activation trace now wrapped in `tx:begin`…`tx:commit` on a forked EM (Step 3).
- `created` snapshot lists new-sale assets (was `assets: []`); asset creation moved inside `createSubscription` (Step 5).
- Confidentiality sweep: `CpqOrderLineCost` rows legitimately hold cost values; returned order DTO still clean (Step 4).
