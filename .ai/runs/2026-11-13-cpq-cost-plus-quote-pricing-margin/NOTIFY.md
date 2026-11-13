# Notify — 2026-11-13-cpq-cost-plus-quote-pricing-margin

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-13T08:08:49Z — run started
- Brief: Implement .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md (App Spec cost-plus, feature 1 of 6).
- External skill URLs: none
- Decision: one stacked implementation PR per feature spec (6 total), in dependency order; this is PR 1.
- Decision: no DB/browser available — migrations generated DB-less from the snapshot; Playwright specs written, not executed.

## 2026-11-13T08:47:16Z — om-auto-continue-pr-loop resume
- Resumed by: @maciejsimm (fresh provider session after the previous one hit a usage limit mid-Step 4)
- Resume point: A.4 (source: Tasks table; Steps 1–3 done and pushed at e64e095)
- PR head SHA: e64e095
- Recovered: an unpushed local autosave (820328a) held near-complete Step 4 work; soft-reset into the working tree and handed to the Step 4 executor to finish (no remote history touched).
- Decision: claim protocol — three-signal check clean (no assignee, no in-progress label, no claim comment, no om-locks ref). Atomic lock + claim comment skipped: labels are disabled in this run's local config (the claim reference makes disabled labels block acquisition) and the PR is owned by this cezar task's own branch; a lock ref left by a session cut off mid-run would block other actors for 24 h.
- Delegation: Step 4 (group:A remainder) → executor subagent, standard tier.

## 2026-11-13T08:53:50Z — checkpoint 1
- Steps A.1–A.4 (5a30eca..bb6e1d8): build ✅, typecheck ✅, full `yarn test` 102 suites / 1481 tests ✅. UI pass skipped (no UI touched; no runnable app env).
- Decision: Tasks-table `Commit` cells hold the real code-commit SHAs, filled at each checkpoint; Step 4's executor had written its unreachable pre-amend SHA (cf45d4a), corrected to bb6e1d8.

## 2026-11-13 — step 5 (layering decision)
- Golden test stays at `packages/cpq/.../services/__tests__/costPlusGolden.test.ts` and builds fixtures from a copied, reduced representation of the demo_gix/demo_puffin seed definitions (CPQ must not import `src/modules/*`); synthetic offerings cover volume and multi-currency, which the seeds do not use. Fixture: `__tests__/__fixtures__/costPlusGolden.json` (regenerate deliberately with `UPDATE_COST_PLUS_GOLDEN=1`).

## 2026-11-13 — step 8 (scope decisions)
- Cost lock = no `CpqOrderConfiguration` for the quote AND status in `ADJUSTMENT_MUTABLE_STATUSES` (moved to `data/price-adjustments.ts`, re-exported from adjustmentService); R1c skip = `isFrozenAmendMirrorLine` or `isArcCancelledLine`. R1b needs the previous driver values, so step 8 adds nullable `driver_hash` to `cpq_quote_line_costs` (second generated migration; step 7 was already pushed).

## 2026-11-13T09:23:09Z — review fix after Step 8
- Finding (major): an element `code` becomes the quote `cost_key` (unique per line, I-1), but codes were only unique per charge; two charges of one offering sharing a code made Step 8's resolver keep the first and silently drop the other's cost (R1a violated, cost/margin understated).
- Fix (Step 8-review-fix, inline): `DUPLICATE_CODE` now checks every charge priced together on a line (same offering; all of the product's charges for a product-level charge). The resolver's first-wins stays as the deterministic fallback for a concurrent-create race (only the target charge is locked). Scope widening of the App Spec's "unique per charge" is the minimal reading that satisfies I-1 while keeping "code = cost key".
- Accepted from Step 8's report: `driver_hash` on `cpq_quote_line_costs` (second generated migration) to detect R1b driver changes; cost lock = status ∉ {new, incomplete, ready} or an order exists (App Spec glossary "Cost lock").

## 2026-11-13T09:26:52Z — checkpoint 2
- Steps B.5–B.8 + 8-review-fix (064dd52..faefbb0): generate ✅, build ✅, typecheck ✅, full `yarn test` 106 suites / 1531 tests ✅; golden fixture unchanged across the refactor; mutation probe confirms the characterization bites. UI pass skipped (no UI touched; no runnable app env).
- Step 9: markup_value is a percent number (25 = 25%); list total rounded once to Intl currency precision, per_unit unit = round4(total/qty); previews/saves/locked quotes all hand cost values in memory via resolveCostPlusInputs (resolution runs before pricing; preview persists nothing, locked reads stored lines); unpriced charges carry unitPrice/totalPrice null (ResolvedCharge widened) and push COST_PENDING / NO_PRICE_BASIS_COST / COST_PLUS_DISABLED / MARKUP_INVALID into line validationErrors.
