# Execution plan — CPQ cost-plus: index costs and supplier cost expiry warnings

Source doc: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md
App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md
Base branch: feat/cpq-cost-plus-arc-costs (stacked on PR #100 → #96 → #95 → #94 → #93; retarget to main once they merge)
Branch: feat/cpq-cost-plus-index-costs-expiry
Engine: om-auto-create-pr-loop (steps: 18, --loop: no)

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. Step commits flip `Status`; the main session fills `Commit` with the real code-commit SHA at each checkpoint. The first row whose `Status` is not `done` is the resume point. Step ids and `Exec` cells are immutable once committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| A | 1 | Index entities and migration | group:A1 | done | |
| A | 2 | costIndexService | group:A1 | done | |
| A | 3 | Index commands and routes | group:A2 | done | |
| A | 4 | Index pages | group:A3 | done | |
| A | 5 | Phase A close-out | group:A3 | done | |
| B | 6 | Characterize index refusal and locked recalculation | group:B1 | done | |
| B | 7 | Element index fields | group:B1 | done | |
| B | 8 | Date plumbing | group:B1 | todo | |
| B | 9 | Index cost resolution | group:B2 | todo | |
| B | 10 | Cost preview and calculate-price | group:B2 | todo | |
| B | 11 | Index UI | group:B3 | todo | |
| B | 12 | Renew index re-evaluation | group:B3 | todo | |
| B | 13 | Index demo seed and manual | group:B4 | todo | |
| B | 14 | Phase B close-out | group:B4 | todo | |
| C | 15 | Expiry ledger and lead-days toggle | group:C1 | todo | |
| C | 16 | costExpiryService, event and notification | group:C1 | todo | |
| C | 17 | Worker, schedule and CLI | group:C2 | todo | |
| C | 18 | Phase C close-out | group:C2 | todo | |

## Goal

Cost indices (e.g. data-centre power, EUR/MWh) with dated, revisioned values; `index` cost elements whose value is `factor × value in force` at the recalculation date, snapshotted on saved recalculations of unlocked quotes and frozen with the cost lock; ARC Renew re-evaluates carried index costs; and supplier cost expiry warnings (daily scheduled worker → ledger → `cpq.quote.cost_expiring` event + notification to cost managers).

## Scope

`packages/cpq/src/modules/cpq/` (CpqCostIndex / CpqCostIndexValue / CpqCostExpiryWarning entities + migrations, costIndexService, index commands / routes / pages, element index fields, `asOfDate` plumbing, indexCostResolution, cost preview + calculate-price, UI, `reevaluateCarriedIndexCosts` (fills PR #100's seam), costExpiryService, events, notifications, worker, schedule, CLI), `src/modules/demo_gix/`, `manuals/cpq-cost-plus-pricing.md`, `packages/cpq/MIGRATION.md` + changeset, `.ai/specs/capabilities/`.

## Non-goals

No migration applied locally (CI applies them).

## Delivery decision (autonomous default)

The spec's three PRs (index catalog / engine / expiry) are folded into this one PR (consistent with features 1–5); each phase keeps its own close-out step (sweep, smoke, migration notes, archive). Step 12's dependency (ARC costs, PR #100) is in this branch's history, so it is not split into a PR 2b.

## Notes from features 1–5 (as built)

- Spec "PR #87" = PR #93; order / subscription costs = PR #94; sourcing = PR #95 (`notifyCostManagers` in `lib/costNotifications.ts` already exists — reuse it; notifications is an optional peer resolved from DI); FX = PR #96 (resolver + snapshot; R3 currency path for index elements in a foreign currency); ARC = PR #100 (`reevaluateCarriedIndexCosts` is an exported no-op seam in `services/costs/arcCostCarry.ts` (or nearby) already called after `reconcileRenewCosts` — fill it, don't re-wire it).
- `index` is declared in `COST_SOURCES` but excluded from `AVAILABLE_COST_SOURCES` (data/costs.ts); the element route refuses it today (step 6 characterizes this).
- Mock-EM tests cannot see DB CHECK constraints: grep migrations for `add constraint` before writing new values (`source` on cost elements / cost lines may have a CHECK — widen it by hand if `index` isn't allowed; `value_origin` CHECK allows catalog / manual / supplier / carried).
- Workers: read node_modules/@open-mercato/queue/AGENTS.md; scheduler API in node_modules/@open-mercato/scheduler/src/index.ts.
- CI: `ci.yml` only triggers on PRs into `main` — dispatch manually; Turbopack Google-Fonts fetch failures are infra → rerun.

## Risks

- Date semantics (value in force at `asOfDate`, revisions, future values) and determinism.
- Pricing goldens must stay byte-identical (no `index` elements in the golden fixture).
- Scheduler re-seeding must never re-enable a schedule an admin disabled.

## External references

None.
