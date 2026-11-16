# Execution plan — CPQ cost-plus: ARC costs (carry, renegotiation, write-back, exposure, re-confirmation)

Source doc: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md
App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md
Base branch: feat/cpq-cost-plus-foreign-currency-costs (stacked on PR #96 → #95 → #94 → #93; retarget to main once they merge)
Branch: feat/cpq-cost-plus-arc-costs
Engine: om-auto-create-pr-loop (steps: 23, --loop: no)

## Tasks

> Authoritative status table. `Status` is `todo`, `done` or `blocked`. Step commits flip `Status`; the main session fills `Commit` with the real code-commit SHA at each checkpoint. The first row whose `Status` is `todo` is the resume point. Step ids and `Exec` cells are immutable once committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| A | 1 | Characterize ARC pricing, conversion and activation | group:A1 | done | |
| B | 2 | State hash helper and item cost state | group:B1 | done | |
| B | 3 | Activation locks | group:B1 | done | |
| B | 4 | COST_SOURCE_CHANGED guard | group:B1 | done | |
| C | 5 | Entity: carried origin and renegotiation_due | group:C1 | done | |
| C | 6 | Carry on Amend mirror | group:C1 | done | |
| C | 7 | Frozen-line lock rule | group:C1 | done | |
| C | 8 | Conversion link and write-back | group:C2 | done | |
| C | 9 | Cost-only Amend and I-9 | group:C2 | done | |
| C | 10 | Merge rule | group:C2 | done | |
| C | 11 | Forward compatibility | group:C2 | done | |
| D | 12 | Usage openArcQuotesWithCarriedCosts | group:D1 | done | |
| D | 13 | Order line cost re-confirmation | group:D1 | done | |
| E | 14 | Renew reconciliation, index re-evaluation, renegotiation due | group:E1 | done | |
| E | 15 | Keep current cost | group:E1 | done | |
| E | 16 | Refresh from subscription | group:E2 | done | |
| E | 17 | Cancel exposure | group:E2 | done | |
| E | 18 | Read projection additions | group:E2 | done | |
| F | 19 | ArcLineDiff cost and margin rows | group:F1 | done | |
| F | 20 | Quote and order pages | group:F1 | done | |
| F | 21 | Docs, demo and E2E | group:F2 | todo | |
| G | 22 | Re-price from cost | group:G1 | blocked | |
| G | 23 | Archive the Delta | group:G2 | todo | |

## Goal

ARC (Amend / Renew / Cancel) quotes carry the subscription's live costs onto their mirror lines (`carried`), keep them consistent with the subscription (`COST_SOURCE_CHANGED` at conversion and activation, activation locks), write them back in place, flag renegotiation-due costs on Renew (with Keep current cost and sourcing), show Cancel exposure, allow re-confirming order line costs before activation, and show cost / margin diffs in the ARC UI — without changing billing payloads (I-9).

## Scope

`packages/cpq/src/modules/cpq/` (lib/stateHash.ts, services/costs/itemCostState.ts, sourceQuoteLock.ts, arcCostCarry.ts, costResolution, costService / quoteCostService lock rules, orderCostCopy, inventoryCostSync, cpqOrderService activation / conversion, cpqQuotingService ARC mirror / restore / refresh, reconfirm command + route, usage, read projections, ArcLineDiff, quote / order pages), `manuals/xd-250-arc-flow.md`, `manuals/cpq-cost-plus-pricing.md`, `packages/cpq/MIGRATION.md` + changeset, `src/modules/demo_gix/`, `.ai/specs/capabilities/`.

## Non-goals

- **Step 22 (Re-price from cost) is BLOCKED** — spec Q3: it must reach billing through `modifiedItems`, which does not exist in this codebase (no `modifiedItems` anywhere in `packages/cpq`); it ships after the sibling billing-rerate / arc-continuity work provides it. Its Phase A characterization and the archive's "Amend mirror line pricing" MODIFIED text stay as built (frozen) until then.
- Index re-evaluation beyond the hook coordinated with the index-costs spec (feature 6) — step 14 calls `reevaluateCarriedIndexCosts` only if it exists, else leaves a no-op seam.

## Delivery decision (autonomous default)

The spec's internal PR 1 / PR 2 split is folded into this one PR (consistent with features 1–4). PR 3 (Phase G) is reduced to the archive (step 23) because step 22 is blocked.

## Notes from features 1–4 (as built)

- Spec "PR #87" = PR #93; "the sibling" (order / subscription costs) = PR #94; sourcing = PR #95; FX = PR #96.
- PR #94 built: atomic `activateOrder` (forked EM, `isolated.transactional`, row lock on the order config — review1-d), `orderCostCopy`, `inventoryCostSync` (create / replace (catalog-only ends; upsert when the toggle is off — review1-b) / end / repoint, no-op detection incl. fx fields), `_arcReconfigured` / `_arcCostPlusFrozen` markers, Renew freeze for cost-plus items, `stripQuoteOnlyArcMarkers`, Renew banner, change-log snapshots with costs, `cpq.subscription.cost_changed`.
- PR #95: sourcing (`cost_request_*`, `renegotiation_due` is referenced by a guarded no-op in `costSourcingService.confirmRenegotiation` — step 5 creates the column, make that branch live).
- PR #96: FX snapshot fields; carried lines must keep their stored rate (already: carried / mirror lines with a snapshot reuse).
- Mock-EM tests cannot see DB CHECK constraints: `origin` and `value_origin` have CHECKs (`cpq_quote_line_costs_origin_check`, `..._value_origin_check` — widened to `supplier` in Migration20261115000100): adding `carried` REQUIRES a migration widening both.
- CI: `ci.yml` only triggers on PRs into `main` — dispatch manually.

## Risks

- Activation lock ordering (source quote → subscriptions sorted) and the parallel-Amend race.
- I-9: amended / renewed payloads byte-identical for cost-only Amends.
- No database / browser locally.

## External references

None.
