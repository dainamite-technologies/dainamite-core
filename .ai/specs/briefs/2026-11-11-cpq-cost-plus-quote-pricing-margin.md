# Cost-plus charges, cost catalog and quote margin in CPQ (known costs)

- Date: 2026-11-11
- Category: feature
- Priority signal: high — §7 Phase 1, primary business goal (cases 2 and the manual path of case 1)
- Risk signal: medium — pricing engine refactor (regression risk I-8), new confidential data paths (I-4), new public calculate-price branch
- Routing: om-spec-writing "Cost-plus charges, cost catalog and quote margin in CPQ (known costs) — brief: .ai/specs/briefs/2026-11-11-cpq-cost-plus-quote-pricing-margin.md"
- Spec written: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md (includes commit #17, the conversion guard — App Spec changelog 2026-11-12)
- App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md — source of truth; sections §0, §1.3, §1.4 (R1–R11, R14–R16, I-1–I-6, I-8), §2, §3 (WF1, WF2, WF4), §3.5, §4, §5 (US-1.1–1.3, 1.5, 1.6, 2.1–2.3, 2.5, 3.5, 4.1–4.4, 0.1, 0.2), §6, §7 Phase 1, §10

## Problem

Cost-plus offers (supplier tails, fixed supplier rate tables) are priced off-system: a spreadsheet computes cost + markup and the rep types a manual override. CPQ knows no cost and nobody sees margin (C5). WF2 ROI: ≥ 95% of won quotes with table-costed cost-plus charges carry no `price_override`; WF4 ROI: ≥ 90% of accepted cost-plus quotes have cost coverage ≥ 80%, margin approvals configured with 0 CPQ code.

## Agreed direction

- **Cost is an input, margin an output** (§1.4.1): a new list-price source `cost_plus` = markup(Σ price-basis costs); price rules, manual adjustments, totals, events, order, billing unchanged downstream.
- Commits #1–#17 and #21 of `app-spec-notes/cost-plus-commits-WF.md` (#18–#20a are the sibling feature "costs to order and subscription"; #17 moved here on 2026-11-12):
  - toggle `cpq.cost_plus` (default off, per-tenant) + `cpq.costs.view` / `cpq.costs.manage`;
  - `CpqProductCharge` gains `cost_plus`, `markup_rule`, `markup_value` (markup redacted without `cpq.costs.view`);
  - `CpqPricingTable.purpose` (`price` | `cost`) with server-side guard on table and entry routes;
  - `CpqChargeCostElement` (sources fixed / table / on_request; index arrives in Phase 4; roles price_basis / margin_only; `cost_model` flat / per_unit / tiered / volume);
  - engine: table lookup refactored off `CpqProductCharge` (`cpqPricingService.ts:248-322`); `CpqQuoteLineCost` with instantiation R1 (R1b value reset only; R1c skip on unreconfigured mirrors); `NO_PRICE_BASIS_COST`, `COST_PENDING`;
  - margin computed (`computeQuoteMargin()`, not stored), `margin_hash` (values only), `cpq.quote.margin_changed` (non-broadcast, `approvalInvalidated`);
  - write API: manual costs, edit / confirm (Phase 1 path for on-request tails), markup override, R10a, cost lock + exemptions + evidence (R11), status transitions with `expectedRevision`;
  - confidential commands (audit / undo payloads without amounts); entities outside `ce.ts` / search;
  - quote page: status badges, Costs sub-panel, Margin card, dialogs; cost preview endpoint; usage endpoint;
  - calculate-price: list price / `indicative` / `priceOnRequest`, never cost (R15);
  - clone R16; toggle-off behaviour R14;
  - demo seed (GIX cost table, IP Transit with partner tail, quotes in Phase 1 cost states, approval recipe disabled) + manual.
- **Ladder:** toggles / RBAC (rung 2); waterfall, `withQuotePricingWrite`, pricing tables, applicability grammar (rung 1); events, `runCpqMutationGuards` (rung 3); Workflows approval recipe (rung 4); the rest new code.
- **Rejected:** Open Mercato catalog price kinds as cost store (§1.4.9); stored margin table; costs in `charges` / `pricingSummary`; markup via manual adjustments; per-element markups (Q-D7).

## Resolved unknowns

| Question | Answer (from the App Spec) |
|----------|----------------------------|
| Who sees costs | `cpq.costs.view` only (default admin); reps see cost status only (Q-D1) |
| Estimated costs | Price the charge; quote indicative, may be sent; conversion blocked (Q-D2, R6, R7) |
| Accepted quote, confirmed cost differs | Reopen and apply supplier answer → back to `ready`, re-accept (Q-D3) |
| Markup granularity | One rule per cost-plus charge (Q-D7) |
| Package switch | Feature toggle `cpq.cost_plus`, default off, per-tenant override (Q-D8; override UI grounded-elsewhere) |
| Entity fields | §1.4.3, §1.4.4, §1.4.6 tables |
| Rounding | Per-instance list total rounded once to currency precision (Q-D14, R2) |
| Foreign currency | Not in this feature: non-quote-currency cost → `CURRENCY_NO_RATE` until the FX feature |
| Approvals | Project Workflows + project mutation guard comparing `margin_hash`; recipe in the manual — **docs-only** (U2) |
| Acceptance criteria | §7 Phase 1 business + domain criteria (I-8 golden, R2 property, I-4 leak sweep, I-5, R14, R4 tables, R1b value, I-6) |

## Non-goals

- Supplier sourcing requests, queue, notifications (sourcing feature); FX (FX feature); index costs and expiry (index feature); ARC carry-over (ARC feature); order / subscription costs (sibling Phase 1 feature).
- Billing of costs; procurement execution; supplier portal; usage cost-plus; accounting.

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/`: `data/entities.ts`, `data/validators.ts`, `migrations/`, `services/cpqPricingService.ts`, `services/cpqQuotingService.ts`, `services/priceAdjustments/quotePricingWrite.ts`, `commands/`, `api/product-charges`, `api/pricing-tables`, `api/pricing-table-entries`, `api/quotes/[quoteId]/costs/**` (new), `api/cost-preview` (new), calculate-price route, `events.ts`, `acl.ts`, `setup.ts`, `lib/` defaults seeder, `backend/cpq/quotes/[id]`, `backend/cpq/offerings/[id]`, `backend/cpq/specifications/[id]`, `backend/cpq/pricing/[id]`.
- `src/modules/demo_gix/` seed; `src/modules/demo_puffin/` calculator check; `manuals/cpq-cost-plus-pricing.md`; `packages/cpq/MIGRATION.md`.
- No upstream (`platform`) dependencies.
