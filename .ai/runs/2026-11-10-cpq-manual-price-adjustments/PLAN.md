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
| 1 | 1.5 | Summary math | inline | done | 9a07adb |
| 1 | 1.5-review-fix | Fix foundation review findings | inline | done | 55f7cd8 |
| 1 | 1.6 | Quote transaction boundary | inline | done | be4cb81 |
| 1 | 1.7 | Integrate adjustment pricing | inline | done | db4808a |
| 1 | 1.7-review-fix | Isolate quote transaction identity maps | inline | done | bfeb322 |
| 2 | 2.1 | Undoable commands | inline | done | dda90af |
| 2 | 2.2 | Adjustment CRUD routes | inline | done | c6baba1 |
| 2 | 2.3 | Draft preview | inline | done | 0130d53 |
| 2 | 2.4 | ACL and reason dictionary | inline | done | 52f8921 |
| 2 | 2.5 | Clone and removal | inline | done | a991619 |
| 2 | 2.6-characterize | Characterize stored adjustment conversion | inline | done | 3d10ca6 |
| 2 | 2.6 | Conversion validation | inline | done | b5f4f39 |
| 2 | 2.7 | Calculate-price waterfall opt-in | inline | done | f40e2be |
| 3 | 3.1 | Quote pricing and status events | inline | done | 5af6610 |
| 4 | 4.1 | Waterfall and price columns | inline | done | 5f50680 |
| 4 | 4.2 | Adjustment dialog and preview | inline | done | 70ac37a (with 4.3) |
| 4 | 4.3 | Adjustment management panel | inline | done | 70ac37a (with 4.2) |
| 4 | 4.4 | Order and inventory waterfall | inline | done | cbc16ca (Playwright flow deferred: no DB here, no quote fixture helper) |
| 5 | 5.1 | Operator manual and migration notes | inline | done | adcb50f |
| 5 | 5.2 | Demo seed | inline | todo | — |
| 5 | 5.3 | Archive capability delta | inline | done | this commit |

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

1.5-review-fix. **Fix foundation review findings** — reversible generated rollback, deal eligibility hash, valid same-level fallback and regression tests. CPQ tests 672/672 pass.

Transaction boundary: explicit transaction EM flows through quote item writes, saved recalculation, clone, status and conversion. Scoped pessimistic row lock/refresh and revision increment share one helper. 677 CPQ tests pass. DB-backed two-writer tests remain unexercised because no database is available; do not claim concurrency verified until integration QA runs.

1.7-review-fix. **Isolate quote transaction identity maps** — fresh clear fork with context resolution disabled; transactional clear:true; no propagation into caller identity map. Real-ORM no-DB success/failure regression and683 CPQ tests pass. DB concurrency remains unverified.

Commands/service: authenticated actor/scope, explicit immutable-feature authorization (including undo), persisted audited before/after snapshots, stale undo refusal, active reason checks on create/reason change, tenant feature toggle gate, status/order lock, invalid/overlap/revision checks. 698 CPQ tests pass; package typecheck pass. Added required feature_toggles dependency and verified generated command loaders register all three commands. Root typecheck found obsolete test-only connect:false option; removed it (MikroORM v7 initializes lazily).

CRUD routes: view/list with bounded pagination; create/PATCH/delete run guarded commands and return undo metadata. Paths cannot be overwritten by a guard. Added scoped target validation and numeric(18,4) precision limits. 713 CPQ tests pass; package typecheck pass. Package build/generation in progress for new routes.

Preview service/route: prices a synthetic draft on an isolated EM, with no persist/flush/revision/events; supports immutable-target replacement and inactive existing reason preservation. 716 CPQ tests pass. Root typecheck in progress (post-preview).

ACL/defaults: admin and employee adjustment feature; visible editable tenant reason dictionary with seven defaults; idempotent global boolean rollout toggle with tenant overrides. Existing labels, inactive dictionaries and disabled/deleted toggles are preserved. 718 CPQ tests pass. Root typecheck identified missing input in three command undo test calls; fixed fixtures; recheck running.

Clone/removal: cloned adjustments get new ids/remapped line ids and retain inactive reasons; missing targets stay invalid with fresh orphan ids. Complete nested bundle removal soft-deletes adjustments before recalculation. New quotes with descriptive ARC markers remain adjustable. Added full clone-flow regressions (including marker stripping) and helper subtree tests. Revision flush boundary now precedes dependent ORM queries, with preflight terminal-recalc validation before any flush. 724 CPQ tests pass. Dictionary timestamp type requirement fixed; package typecheck re-running.

2.6-characterize. **Characterize stored adjustment conversion** — baseline confirms valid and invalid stored offers both convert today, copying charge snapshots unchanged and stripping quote-only pricing markers. 34 order-service tests pass before guard change.

Conversion guard: inspects stored charge/line/quote adjustment errors without repricing and refuses422 ADJUSTMENT_INVALID with line/code before any order is created. Valid offer snapshots still copy unchanged and quote-only markers stay out of order lines. 728 CPQ tests pass before final route-error assertion; focused order/route test running.

Calculator opt-in: includeWaterfall exposes list/standard values only explicitly; default primary/child payloads retain legacy fields plus rule origin; manual inputs are never forwarded. Added valid framework OpenAPI docs. 733 CPQ tests/43 suites pass, focused conversion route/service51 tests pass.
