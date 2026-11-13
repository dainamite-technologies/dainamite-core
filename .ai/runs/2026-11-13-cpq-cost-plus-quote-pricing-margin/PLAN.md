# Execution plan — CPQ cost-plus: charges, cost catalog and quote margin (known costs)

Source doc: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md
Base branch: main
Branch: feat/cpq-cost-plus-quote-pricing-margin
Engine: om-auto-create-pr-loop (steps: 24, --loop: no)

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| A | 1 | Toggle and ACL | group:A | done | 5a30eca |
| A | 2 | Charge columns and markup redaction | group:A | done | 6bfa375 |
| A | 3 | Pricing table purpose | group:A | done | e64e095 |
| A | 4 | Cost elements | group:A | done | bb6e1d8 |
| B | 5 | Characterize before any change | group:B1 | done | 064dd52 |
| B | 6 | Refactor the lookup into costLookup | group:B1 | done | d4e5744 |
| B | 7 | Cost line and markup override entities | group:B2 | done | 4838c55 |
| B | 8 | Cost resolution | group:B2 | done | 4a7abaf |
| B | 8-review-fix | Cost element codes unique across a line's charges | inline | done | faefbb0 |
| B | 9 | Cost-plus price | group:B3 | done | 8801297 |
| B | 10 | Margin | group:B3 | done | daa5323 |
| B | 9-review-fix | Percent price rules keep cost-plus totals exact | inline | done | a371ea3 |
| C | 11 | Read API, cost preview, usage | group:C1 | done | c7e8e7d |
| C | 12 | Write commands part 1 (cost lines, lock) | group:C1 | done | 4cf143d |
| C | 13 | Write commands part 2 (markup override) | group:C1 | done | a831390 |
| C | 12-review-fix | Manual per_unit costs follow the quantity | inline | done | 5e21994 |
| C | 14 | Signals (marginTracker, margin_changed) | group:C2 | done | 4bc3274 |
| C | 15 | Status revision | group:C2 | done | b99e088 |
| C | 16 | Conversion guard | group:C2 | done | 8526cf9 |
| C | 17 | Confidentiality sweep | group:C2 | done | 59f580e |
| C | 14-review-fix | margin_changed for a write creating the first cost lines | inline | done | 0c7c25d |
| D | 18 | Charge editor UI | group:D | done | f6e0157 |
| D | 19 | Quote page: badges, Costs panel | group:D | done | ac914b8 |
| D | 19-review-fix | Unpriced cost-plus charges carry the fallback price | inline | done | 9870e69 |
| D | 20 | Quote page: Margin card and dialogs | group:D | done | b42681c |
| E | 21 | Calculate-price | group:E1 | done | |
| E | 22 | Clone, removal, toggle-off | group:E1 | todo | |
| E | 23 | Demo seed and docs | group:E2 | todo | |
| E | 24 | Archive the Delta | group:E2 | todo | |

## Goal

A charge can be priced `cost_plus` from catalog cost elements; every quote line carries cost lines; a cost-plus list price is markup(Σ price-basis costs) and flows through the existing waterfall; holders of `cpq.costs.view` see costs and a computed margin; conversion is refused while price-basis costs are not confirmed. Everything is behind the tenant toggle `cpq.cost_plus` (default off).

## Scope

`packages/cpq/src/modules/cpq/` (entities, migrations, validators, services/costs, commands, API routes, quote/charge UI, events, ACL, setup), `src/modules/demo_gix` seed, `manuals/cpq-cost-plus-pricing.md`, `packages/cpq/MIGRATION.md` + changeset, `.ai/specs/capabilities/` archive. Steps follow the feature spec's Implementation Plan 1:1.

## Non-goals

Supplier sourcing (request/answer), FX conversion, order/subscription costs, ARC carry, index costs and expiry warnings — each ships on its own stacked PR per its feature spec. No migrations are applied (`yarn mercato db migrate` needs user confirmation).

## Delivery decision (autonomous default)

The App Spec is delivered as **one implementation PR per feature spec**, stacked in dependency order: (1) quote pricing & margin → (2) order & subscription costs → (3) supplier sourcing → (4) foreign-currency costs → (5) ARC costs → (6) index costs & expiry. The feature spec's internal "PR 1 / 2 / 3" split is folded into this one PR; the per-step commits keep it bisectable and reviewable.

## Risks

- The engine refactor (step 6) must keep the golden test byte-identical (I-8).
- No database or browser here (Docker socket denied, no Postgres): migrations are generated DB-less from the committed snapshot (MikroORM migrator, `connect: false`); integration/Playwright specs are written but not executed; DB-backed checks are deferred to CI.
- Cost confidentiality (I-4) — sweep in step 17.

## External references

None. Framework APIs are read from installed `node_modules/@open-mercato/*`.
