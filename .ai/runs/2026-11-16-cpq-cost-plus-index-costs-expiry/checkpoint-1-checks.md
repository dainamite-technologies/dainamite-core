# Checkpoint 1 — Phase A (index catalog, steps 1–5) verified

- **Checkpoint:** 1
- **Steps covered:** 1 92cdc88, 2 96317dc, 3 f552941, 4 39d81c2, 5 7215809
- **Recorded:** 2026-11-16
- **Touched areas:** `CpqCostIndex` / `CpqCostIndexValue` (Migration20261116054402: `value > 0` and `revision >= 1` CHECKs, partial unique code index), `costIndexService` (revisioned appends under `PESSIMISTIC_WRITE`, atomic import with dry run, value in force), commands + routes (`/api/cpq/cost-indices…`), list / detail pages with Create / Add value / Import dialogs, confidentiality sweep, `TC-CPQ-COST-INDEX-001`, MIGRATION.md + changeset, archive of the four ADDED `cpq-cost-catalog` index requirements.

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| `yarn test` (full) | ✅ pass | 190 suites, 3136 tests; goldens unchanged |
| CI on 7215809 (manual dispatch) | ✅ pass | 3136 unit; 68 integration passed, 1 skipped (PR #95 fixme) incl. `TC-CPQ-COST-INDEX-001`; migration applied |
| UI | ⚠️ | pages / dialogs never rendered in a browser |

## Decisions accepted

- Read routes: `cpq.pricing.view` + `cpq.costs.view`; write routes: `cpq.pricing.manage` + `cpq.costs.view` (spec Q13).
- `UNKNOWN_CURRENCY` checked against `Intl.supportedValuesOf('currency')` (no hard dependency on `currencies`).
- A single append of an identical value is a new revision (explicit correction); `unchanged` detection applies to imports only.
- In-use check was a stub in steps 1–3; wired to element index columns in step 7.
- Used-by entries link to offerings generically (no offering id in the API).
