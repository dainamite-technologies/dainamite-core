# Execution plan — CPQ manual price adjustments

Source spec: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
Base branch: fix/cpq-quote-pricing-integrity (PR #84)
Branch: feat/cpq-manual-price-adjustments
Engine: om-auto-create-pr-loop (steps: 22, --loop: no)

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Characterize pricing | inline | done | 73c9553 |
| 1 | 1.2 | Capture list and standard prices | inline | done | 5c46335 |
| 1 | 1.3 | Entity and migration | inline | done | 4bb5bc0 |
| 1 | 1.4 | Manual adjustment resolver | inline | done | cfbfa2f |
| 1 | 1.5 | Summary math | inline | done | this commit |
| 1 | 1.6 | Quote transaction boundary | inline | todo | — |
| 1 | 1.7 | Integrate adjustment pricing | inline | todo | — |
| 2 | 2.1 | Undoable commands | inline | todo | — |
| 2 | 2.2 | Adjustment CRUD routes | inline | todo | — |
| 2 | 2.3 | Draft preview | inline | todo | — |
| 2 | 2.4 | ACL and reason dictionary | inline | todo | — |
| 2 | 2.5 | Clone and removal | inline | todo | — |
| 2 | 2.6 | Conversion validation | inline | todo | — |
| 2 | 2.7 | Calculate-price waterfall opt-in | inline | todo | — |
| 3 | 3.1 | Quote pricing and status events | inline | todo | — |
| 4 | 4.1 | Waterfall and price columns | inline | todo | — |
| 4 | 4.2 | Adjustment dialog and preview | inline | todo | — |
| 4 | 4.3 | Adjustment management panel | inline | todo | — |
| 4 | 4.4 | Order and inventory waterfall | inline | todo | — |
| 5 | 5.1 | Operator manual and migration notes | inline | todo | — |
| 5 | 5.2 | Demo seed | inline | todo | — |
| 5 | 5.3 | Archive capability delta | inline | todo | — |

## Goal

Let reps negotiate permanent charge and line discounts, retain list/standard/offer prices, and expose pricing snapshots for project approval workflows.

## Scope

CPQ engine, quote transaction boundary, adjustment entity/commands/routes, preview, pricing events, quote UI and downstream read-only waterfall.

## Non-goals

Time windows, quote-wide discounts, ARC mirror-line adjustments and billing re-rating belong to later features. Do not apply migrations without confirmation.

## Risks

Preserve all no-adjustment prices and legacy discountTotal; serialize aggregate writes; enforce tenant isolation and locks. Database-backed and browser validation depend on a runnable test environment. New branch publication requires Cezar Guard confirmation.

## External references

No external skill URLs. Framework APIs are inspected in installed dependencies.

## Implementation plan

### Phase 1: Waterfall foundation

1.1. **Characterize pricing** — implement the corresponding source-spec step, with tests and one commit.
1.2. **Capture list and standard prices** — implement the corresponding source-spec step, with tests and one commit.
1.3. **Entity and migration** — implement the corresponding source-spec step, with tests and one commit.
1.4. **Manual adjustment resolver** — implement the corresponding source-spec step, with tests and one commit.
1.5. **Summary math** — implement the corresponding source-spec step, with tests and one commit.
1.6. **Quote transaction boundary** — implement the corresponding source-spec step, with tests and one commit.
1.7. **Integrate adjustment pricing** — implement the corresponding source-spec step, with tests and one commit.

### Phase 2: Adjustments API

2.1. **Undoable commands** — implement the corresponding source-spec step, with tests and one commit.
2.2. **Adjustment CRUD routes** — implement the corresponding source-spec step, with tests and one commit.
2.3. **Draft preview** — implement the corresponding source-spec step, with tests and one commit.
2.4. **ACL and reason dictionary** — implement the corresponding source-spec step, with tests and one commit.
2.5. **Clone and removal** — implement the corresponding source-spec step, with tests and one commit.
2.6. **Conversion validation** — implement the corresponding source-spec step, with tests and one commit.
2.7. **Calculate-price waterfall opt-in** — implement the corresponding source-spec step, with tests and one commit.

### Phase 3: Pricing signals

3.1. **Quote pricing and status events** — implement the corresponding source-spec step, with tests and one commit.

### Phase 4: UI

4.1. **Waterfall and price columns** — implement the corresponding source-spec step, with tests and one commit.
4.2. **Adjustment dialog and preview** — implement the corresponding source-spec step, with tests and one commit.
4.3. **Adjustment management panel** — implement the corresponding source-spec step, with tests and one commit.
4.4. **Order and inventory waterfall** — implement the corresponding source-spec step, with tests and one commit.

### Phase 5: Documentation

5.1. **Operator manual and migration notes** — implement the corresponding source-spec step, with tests and one commit.
5.2. **Demo seed** — implement the corresponding source-spec step, with tests and one commit.
5.3. **Archive capability delta** — implement the corresponding source-spec step, with tests and one commit.

## Execution placement

Steps run inline because they share the pricing model and quote aggregate refactor; splitting them between fresh executors would repeatedly re-derive tightly coupled context. Independent final review uses a separate read-only task. Checkpoints after five steps or phase boundaries.

Migration generation: `yarn mercato db generate` scans only local app modules; used installed MikroORM migrator in offline snapshot mode for packaged CPQ. Generated SQL adds only the adjustment table/indexes and pricing_revision. Snapshot serialization changes reflect the installed ORM version. No migration applied. CPQ tests: 642/642 pass; generation pass.
