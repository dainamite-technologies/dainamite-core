# Checkpoint 1 — Phase A (Steps 1–4) verified

- **Checkpoint:** 1
- **Steps covered:** A.1–A.4 (5a30eca..bb6e1d8)
- **Recorded:** 2026-11-13T08:53:50Z
- **Touched areas:** `packages/cpq` — ACL/setup + `cpq.cost_plus` toggle and CLI, `cpq_product_charges` markup columns + `cost_plus` method + markup redaction, `cpq_pricing_tables.purpose` + cost-table filtering, `cpq_charge_cost_elements` entity/migrations/validators/route, last-price-basis rule on charge writes. No UI.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn workspace @dainamite/cpq build` | ✅ pass | 203 entry points (demo tests import the CPQ `dist`) |
| `yarn generate` | ✅ pass | run by the Step 4 executor after adding `api/charge-cost-elements` |
| `yarn typecheck` | ✅ pass | clean |
| `yarn test` (full) | ✅ pass | 102 suites, 1481 tests |
| Migrations | ✅ generated, ⏭️ not applied | DB-less from the committed snapshot; `yarn mercato db migrate` needs user confirmation and a database (none here) |
| UI / integration | ⏭️ skipped | No Step in the window touched UI; no Postgres/Docker, so the app cannot run here |
