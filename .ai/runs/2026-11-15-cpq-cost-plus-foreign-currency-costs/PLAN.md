# Execution plan — CPQ cost-plus: foreign-currency costs (dated FX rates from currencies)

Source doc: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md
App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md
Base branch: feat/cpq-cost-plus-supplier-sourcing (stacked on PR #95 → #94 → #93; retarget to main once they merge)
Branch: feat/cpq-cost-plus-foreign-currency-costs
Engine: om-auto-create-pr-loop (steps: 12, --loop: no)

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. Step commits flip `Status`; the main session fills `Commit` with the real code-commit SHA at each checkpoint. The first row whose `Status` is not `done` is the resume point. Step ids and `Exec` cells are immutable once committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| A | 1 | Characterization tests | group:A1 | done | |
| A | 2 | FX settings | group:A2 | done | |
| A | 3 | FX rate resolver | group:A2 | done | |
| A | 4 | DI registration | group:A2 | done | |
| B | 5 | Entity: rate source and derivation | group:B1 | done | |
| B | 6 | Engine: snapshot policy, table currency, pricing and margin | group:B1 | done | |
| B | 7 | Writes in a foreign currency | group:B2 | done | |
| B | 8 | Read APIs and missingFxPairs | group:B2 | done | |
| C | 9 | Carry-through to order and inventory costs | group:C1 | done | |
| D | 10 | UI | group:D1 | done | |
| E | 11 | Seed, docs, migration notes and E2E | group:E1 | todo | |
| E | 12 | Archive the Delta | group:E1 | todo | |

## Goal

Foreign-currency costs convert into the quote currency with a dated rate from the framework `currencies` module (`exchangeRateService.getRate`, `autoFetch: false`, look-back 7 days, tenant-configurable); the rate, its date, provider and derivation are snapshotted on saved recalculations of unlocked quotes, frozen with the cost lock, and copied verbatim to order and inventory costs; previews compute in memory; no rate → `CURRENCY_NO_RATE` (never 1:1); cost tables prefer quote-currency entries; without `currencies` CPQ keeps the Phase 1 behaviour.

## Scope

`packages/cpq/src/modules/cpq/` (settings in `lib/costPlusDefaults.ts`, `services/costs/fxSettings.ts`, `fxRateResolver.ts`, DI, quote / order / inventory cost entities + migration, `costResolution`, `costPlusPrice`, `quoteMargin`, cost writes, read APIs, usage `missingFxPairs`, conversion / activation copy, UI), `src/modules/demo_gix/` (USD tail + demo rates), `manuals/cpq-cost-plus-pricing.md`, `packages/cpq/MIGRATION.md` + changeset, `.ai/specs/capabilities/`.

## Non-goals

Fixing the built-in NBP / Raiffeisen providers (upstream UP-FX-1). No migration applied locally (CI applies them).

## Delivery decision (autonomous default)

One PR, 12 steps, stacked on PR #95. Step 9's dependency (the order / subscription costs spec, PR #94) is in this branch's history, so step 9 stays in this PR. Step 12's dependency (feature 1's capability archive) has run.

## Notes from features 1–3 (as built)

- Spec "PR #87" = PR #93 here; order / subscription costs = PR #94; supplier sourcing = PR #95.
- PR #95 stores a supplier answer in a non-quote currency as `none` + `CURRENCY_NO_RATE` with its unit amount kept in the supplier's currency and `value_origin = 'supplier'` (services/costs/costSourcingService.ts `valuePatch`). With FX, such an answer must convert like a manual foreign-currency value (spec Q9 / Q13 "status on rate arrival") — cover it in steps 6–7.
- Manual cost writes currently refuse a non-quote currency with `422 CURRENCY_NO_RATE` (quoteCostService `valueFields`) — step 7 replaces that per Q9.
- Feature 2 copies `fx_rate` / `fx_rate_date` in the shared cost value columns of `cpq_order_line_costs` / `cpq_inventory_costs` (orderCostCopy.ts, inventoryCostSync.ts `costSeedFromOrderLineCost`, inventoryCostSnapshot.ts) — step 9 adds source + derivation.
- Mock-EM tests cannot see DB CHECK constraints: grep migrations for `add constraint` before writing new values (a `value_origin` CHECK bug was caught in PR #95).
- Margin hash must stay byte-identical for quotes without FX (Q15); pricing golden `costPlusGolden.json` untouched.
- Outward-facing actions (filing the upstream UP-FX-1 issue) are NOT done by executors: step 11 drafts the issue text into this run folder (`UP-FX-1-issue.md`) for a human to file; the manual / MIGRATION.md reference it as "to be filed".

## Risks

- Every cost-plus price path gains a rate lookup — previews must not write; saved recalculations of locked quotes must reuse the frozen snapshot.
- Rounding: multiply at full precision, one rounding (I-8 golden byte-identical).
- No database / browser locally: CI via manual `ci.yml` dispatch.

## External references

None. `currencies` APIs are read from installed `node_modules/@open-mercato/core/src/modules/currencies`.
