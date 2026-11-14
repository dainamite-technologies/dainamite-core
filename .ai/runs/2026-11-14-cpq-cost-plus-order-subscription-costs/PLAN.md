# Execution plan — CPQ cost-plus: carry quote costs to orders and subscriptions (no billing impact) with ARC safety

Source doc: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md
Base branch: feat/cpq-cost-plus-quote-pricing-margin (stacked on PR #93; retarget to main once #93 merges)
Branch: feat/cpq-cost-plus-order-subscription-costs
Engine: om-auto-create-pr-loop (steps: 21, --loop: no)

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. Step commits flip `Status`; the main session fills `Commit` with the real code-commit SHA at each checkpoint. The first row whose `Status` is not `done` is the resume point. Step ids and `Exec` cells are immutable once committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| A | 1 | Characterization tests | group:A | done | 5f93d4d |
| B | 2 | Order line cost and inventory cost entities | group:B1 | done | d14f36a |
| B | 3 | Atomic activation | group:B1 | done | be31f71 |
| B | 4 | Conversion copy | group:B2 | done | a6e8f50 |
| B | 5 | Item cost sync and activation write | group:B2 | done | f02d114 |
| B | 6 | Subscription snapshots carry costs | group:B3 | done | e7ed015 |
| B | 7 | cost_changed event | group:B3 | done | 0091fd9 |
| B | 8 | Read APIs and redaction | group:B4 | done | 7ff047f |
| B | 9 | Confidentiality sweep extension | group:B4 | done | cdcb3e2 |
| C | 10 | Renew freeze | group:C1 | done | cc67ea5 |
| C | 11 | Reconfigured mirrors get cost lines | group:C1 | done | 7831f1d |
| C | 12 | Renew banner | group:C2 | done | b1e3da8 |
| C | 13 | Write-back for Amend / Renew / Cancel | group:C2 | done | 0f3a170 |
| C | 14 | Merge re-point | group:C3 | done | a382317 |
| C | 15 | Scrub CLI | group:C3 | done | a1dc794 |
| C | 16 | MIGRATION.md and changeset | group:C3 | done | 5fbeb65 |
| D | 17 | Order page costs and margin | group:D1 | done | |
| D | 18 | Subscription and asset pages costs | group:D1 | todo | |
| D | 19 | Change History cost diffs | group:D2 | todo | |
| D | 20 | Docs and E2E | group:D2 | todo | |
| D | 21 | Archive the Delta | group:D2 | todo | |

## Goal

Conversion copies every quote cost line to a `CpqOrderLineCost` in the order's transaction; activation (made atomic) creates one `CpqInventoryCost` per costed owner (subscription item or asset) and `cost_key`, with a stable id for the life of the purchase; the subscription change log carries cost snapshots (redacted without `cpq.costs.view`); a non-broadcast `cpq.subscription.cost_changed` event; order / subscription / asset cost read APIs and UI; ARC safety until cost carry-over ships (Renew freeze for cost-plus items, reconfigured mirrors get cost lines, minimal write-back on Amend / Renew / Cancel, merge re-point). Billing payloads stay byte-identical (I-9).

## Scope

`packages/cpq/src/modules/cpq/` (entities + migration, `services/cpqOrderService.ts` activation/conversion, `services/cpqInventoryService.ts`, `services/costs/*`, ARC mirror code, events, API routes, order / subscription / asset UI, CLI), `manuals/cpq-cost-plus-pricing.md`, `packages/cpq/MIGRATION.md` + changeset, `.ai/specs/capabilities/`. Steps follow the feature spec's Implementation Plan 1:1.

## Non-goals

Supplier sourcing, FX, full ARC cost carry (Phase 3), index costs — each ships in its own stacked PR. No migration is applied locally (needs user confirmation and a database; CI applies them).

## Delivery decision (autonomous default)

The spec's internal "PR 1 / PR 2" split is folded into this one PR (consistent with feature 1, PR #93): the per-step commits keep it bisectable. Stacked on PR #93's branch.

## Notes from feature 1 (as built)

- PR #93's review fix review1-c lets NON-frozen ARC mirror lines (Renew mirrors re-priced at today's standard, reconfigured Amend mirrors) carry catalog cost lines, and ARC termination lines never bind conversion. This spec's step 1 assumes "mirror lines never get catalog cost lines": characterize the behaviour AS BUILT; steps 10–11 then narrow it per this spec (Renew mirrors of cost-plus items frozen; only mirrors with `_arcReconfigured` get cost lines).
- The conversion guard (R7, incl. unpriced cost-plus charges → `COSTS_NOT_CONFIRMED` with `chargeCodes`) and the cost lock (`COST_CLOSED_STATUSES = rejected / cancelled`) live in `services/costs/conversionGuard.ts` and `costLock.ts`.

## Risks

- Atomic activation (step 3) changes the transaction boundary of a hot path — characterize first (step 1), re-run the ARC integration specs in CI.
- I-9 billing payload golden must stay byte-identical (steps 1, 7, 13).
- No database / browser locally: migrations generated DB-less from the committed snapshot; integration / Playwright run in CI only.

## External references

None. Framework APIs are read from installed `node_modules/@open-mercato/*`.
