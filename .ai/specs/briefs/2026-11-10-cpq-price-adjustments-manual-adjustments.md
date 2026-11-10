# Manual price adjustments on CPQ quotes (permanent) with a price waterfall and approval signals

- Date: 2026-11-10
- Category: feature
- Priority signal: high — §7 Phase 1, primary business goal
- Risk signal: medium — new entity + public event contracts; first mutation-guard call sites in CPQ (docs-only); pricing engine touched (regression risk I-9)
- Routing: om-spec-writing "Manual price adjustments on CPQ quotes (permanent) with a price waterfall and approval signals — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-manual-adjustments.md"
- Spec written: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md (depends on .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md)
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — source of truth for this feature; sections §0, §1.3, §1.4, §2, §3 (WF1, WF2 Phase-1 path, WF4), §3.5, §4, §5 (US-1.1, 1.2, 1.5–1.9, 2.1, 4.1–4.3, 0.1, 0.2), §6, §7 Phase 1, §10

## Problem

Sales reps cannot change a price on a CPQ quote (C5): the engine's output (list price after price rules) is final, so negotiated prices are handled off-system and the quote, order, subscription and invoice disagree with the deal. Price rules already behave like engine-granted discounts, but the pre-rule price is not stored and there is no notion of a sales-granted adjustment. Projects also have no signal to hang approvals on (no quote events, no guard calls — C15). WF1's ROI: ≥ 95% of won quotes with a non-standard price priced in CPQ; WF4's: approvals configured per project with zero CPQ code.

## Agreed direction

- **One waterfall, two origins** (§1.4.1): list → price rules (`origin: rule`, unchanged) → standard → at most one manual adjustment per charge (`origin: manual`) → offer. Manual adjustments are inputs in a new table `CpqQuotePriceAdjustment`; the waterfall on `ResolvedCharge` is recomputed output (additive jsonb fields).
- **Stories in scope (Phase 1, permanent windows only):**
  - US-1.1 set unit price / amount off on one charge; US-1.2 % on a charge or line (MRC / NRC filter, bundle cascade) — happy / alternate / failure paths in §5 incl. the common failure block (409 stale revision, lock, 403, navigate away).
  - US-1.5 waterfall display (legacy charges via read helper); US-1.6 preview endpoint (no save, no event); US-1.7 invalid adjustments (missing / ambiguous target, above standard, currency, term) flagged, skipped with fallback, deletable while locked, conversion refused on stored snapshot; US-1.8 clone / line removal; US-1.9 visible reason dictionary.
  - US-2.1 order / subscription carry the waterfall; billing already receives offer totals (rung 1, C8).
  - US-4.1 deal value + signed discount depth; US-4.2 adjustment lock (`new` / `incomplete` / `ready`, no order); US-4.3 events `cpq.quote.pricing_changed` (hash-deduped) and `cpq.quote.status_changed` (manual + auto) + approval-workflow recipe.
  - Transaction boundary: one `em.transactional` with a pessimistic lock on the quote configuration for every price-affecting write incl. conversion; events after commit.
  - `discountTotal` unchanged; new `ruleDiscountTotal` / `manualDiscountTotal`; calculate-price waterfall fields opt-in (`includeWaterfall`); writes behind feature toggle `cpq.manual_price_adjustments`.
  - US-0.1 role defaults, US-0.2 demo seed.
  - ARC mirror lines (Amend and Renew) accept no manual adjustments until `arc-continuity` (`LINE_NOT_ELIGIBLE`); new `add` lines on ARC quotes are adjustable. Frozen Amend lines, recalculation hardening and guards on existing routes moved to the sibling `quote-pricing-integrity` feature (review split).
  - Legacy quotes: the first snapshot hash is a silent baseline (no `pricing_changed`) unless offers change.
- **Capability ladder:** engine (rung 1) extended; RBAC + dictionaries (rung 2); events + mutation guards (rung 3); approvals = Workflows (rung 4, project config); everything else new code (rung 5).
- **Rejected:** sales `AdjustmentKind` adjustments (no charge / month dimension, two sources of truth); compounding manual adjustments; manual markups; manual adjustments on usage charges; new line / quote columns other than `pricing_revision`; `cpq.price_adjustment.*` CRUD events (no consumer).

## Resolved unknowns

| Question | Answer (from the App Spec) |
|----------|----------------------------|
| What is "list price"? | Before price rules; three prices stored: list / standard / offer (Q2 ASSUMED). |
| Levels in this feature | `charge` and `line`; `quote` level is a later feature (Phase 4). |
| Stacking | Most specific wins: charge > own line > ancestor line; never compounded (R1). |
| Adjustment types | `discount_percent` (all levels), `discount_absolute` (charge, per-instance total), `price_override` (charge, unit price, flat / per_unit only); same formulas as price rules (C3, R2). |
| Entity fields | §1.4.3 table (`level`, `quote_line_id`, `charge_code`, `charge_type_filter`, `adjustment_type`, `value` numeric(18,4), `currency_code`, `window_kind` = `relative` with `from_month` 1 / `to_month` null in this phase, `reason_code`, `reason_note`, author ids, standard columns). Carry-over / absolute-window fields are added by later features. |
| Concurrency | `CpqQuoteConfiguration` is the aggregate root; every price-affecting write locks it and bumps `pricing_revision`; optional `expectedRevision` → 409. |
| Lock | Writes only in `new` / `incomplete` / `ready` and while no order exists; deleting invalid adjustments allowed in non-terminal statuses; `save:true` recalculation refused in terminal statuses (R7). |
| Permission | `cpq.quotes.manage` + new `cpq.quotes.adjust_price` (default admin, employee); saved recalculation needs `cpq.quotes.manage`. |
| Reasons | Per-tenant visible dictionary `cpq.price_adjustment_reason`; note required for `other`. **docs-only:** tenant-admin editing of the dictionary (U7) — verify. |
| Depth / deal value | Signed fraction `1 − after/before`, null when before = 0; horizon `termMonths` else 12 (§1.3). |
| Events | `cpq.quote.pricing_changed`, `cpq.quote.status_changed` — payloads §1.4.7; after commit; stored snapshot authoritative. **docs-only:** Workflows trigger `filterConditions` and mutation-guard API (U1) — verify against the installed framework. |
| Sales line | `unitPriceNet` keeps carrying the offer; sales discount fields stay 0 (D6). **docs-only:** whether sales recomputes from `discountAmount` (U2). |
| Acceptance criteria | §7 Phase 1 business criteria + DDD domain criteria. |

## Non-goals

- Approval routing / thresholds / approver UI; freezing line edits during approval (U5).
- Time-based windows, schedules and billing segments (later features); quote-wide discounts (later feature).
- ARC carry-over and billing re-rate (later features).
- Usage-charge adjustments; manual markups; customer-facing documents.

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/`: `services/cpqPricingService.ts`, `services/cpqQuotingService.ts`, `services/types.ts`, `services/cpqOrderService.ts` (conversion guard), `data/entities.ts`, `data/validators.ts`, `migrations/`, `api/quotes/[quoteId]/price-adjustments/**`, `api/quotes/[quoteId]/{status,items,recalculate}/route.ts`, order convert route, `events.ts`, `acl.ts`, `setup.ts`, `backend/cpq/quotes/[id]/page.tsx`, `backend/cpq/orders/[id]`, inventory pages, `widgets/injection/order-cpq-tab`.
- `src/modules/demo_gix/`, `src/modules/demo_puffin/` seeds; `manuals/`; `packages/cpq/MIGRATION.md`.
- No upstream (`platform`) dependencies.
