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
- Step 10: computeQuoteMargin returns percent numbers (marginPercent/markupPercent/costCoverage in 0-100, null when undefined); contract horizon = NRC once + MRC x (termMonths ?? 12), non-deal lines and usage excluded; marginHash covers cost amounts/currency/fx/role, markups and offers only.

## 2026-11-13T09:41:30Z — review fix after Steps 9–10
- Finding (major, spec contract on money): App Spec R2 says a cost-plus `per_unit` charge introduces "no unit × qty drift", but `discount_percent` / `surcharge_percent` price rules recompute `total = adjustedUnit × qty` from the 4 dp unit (e.g. 3 units of 100.00 at −10 % → 89.99991 instead of 90.00). Manual adjustments and absolute rules already work from totals.
- Fix (Step 9-review-fix, inline): for cost-plus charges only, percent price rules scale the exact per-instance total; every other charge keeps today's arithmetic, so the golden fixture is untouched.
- Noted for Step 23 (MIGRATION.md / changeset): `ResolvedCharge.unitPrice` / `listUnitPrice` became `number | null` (unpriced cost-plus charges) — a type-level change for package consumers; margin percentages are 0–100 numbers, null when undefined.

## 2026-11-13T09:44:39Z — checkpoint 3 (Phase B closed)
- Steps B.9, B.10, 9-review-fix (8801297..a371ea3): typecheck ✅, build ✅, full `yarn test` 108 suites / 1622 tests ✅; golden fixture unchanged. UI pass skipped (no UI touched; no runnable app env).

## 2026-11-13 — Steps 11-13 scope decisions
- Manual cost key scheme: `manual:` + 8 hex chars. Catalog element codes cannot contain `:` (validator regex), so no collision is possible and no extra element check was needed.
- Cost lock (Step 12): `isQuoteCostLocked` (status outside new/incomplete/ready, or an order) plus terminal statuses refuse every cost write with `409 COST_LOCKED`; locked quotes accept only price-neutral writes (margin-only, estimated -> confirmed with an unchanged value, supplier validity/term edits) and are NOT re-priced (re-pricing would re-read the catalog). Unlocked quotes run the saved recalculation after every cost / markup write.
- Resolver change (Step 12, costResolution): a value a pricing manager entered or confirmed (`value_origin = manual`) now survives recalculation for fixed/table elements too (previously only on_request), reset only when a driver changes (R1b); its per-instance amount follows the quantity. Without it an overwritten catalog value would be undone by the very next recalculation.
- Known limitation: a `manual` per_unit cost line's `instance_amount` is not refreshed when the charge quantity changes later (the resolver never touches origin = manual rows); re-save the line to refresh.
- Every cost write bumps `pricingRevision` (withQuotePricingWrite), including margin-only ones; `QuotePricingCause` gained `'cost'`.
- Command logs: `replayable: false` (the bus would otherwise store the raw input incl. amounts as the redo payload) and snapshots hold ids / statuses / roles / cost_key only.
- Route paths follow the spec; `CHARGE_NOT_FOUND` is also used by the markup override for an unknown charge code.

## 2026-11-13T13:08:00Z — review of Steps 11–13
- Note: the first C1 executor died on a provider rate limit before changing anything (clean tree, HEAD unchanged); re-dispatched at the same tier — not a quality rescue.
- Finding (major): a manual `per_unit` cost line kept the `instance_amount` computed at entry, because the resolver never touches `origin = manual` rows. Changing the quantity (a saved recalculation) then re-priced a cost-plus charge from a stale cost.
- Fix (Step 12-review-fix, inline): on unlocked recalculations (save and preview), the resolver refreshes only the per-instance amount of manual `per_unit` rows from the charge quantity; value, status, origin and note are untouched. Line-level `per_unit` manual costs were already refused (`QUANTITY_ATTRIBUTE_REQUIRED`).
- Accepted from the executor's report: entered/confirmed values on catalog lines survive recalculation until a driving attribute changes (otherwise an overwrite is undone by the next save); `QuotePricingCause` gains `'cost'`; `CHARGE_NOT_FOUND` for an unknown charge code on a markup override; manual cost keys `manual:<8 hex>` (element codes cannot contain `:`); cost commands `replayable: false` so the command log never stores amounts.
- Minor (deferred to the final review): every cost write bumps `pricingRevision` (existing `withQuotePricingWrite` convention), so a margin-only edit will make a rep's status change return `409 STALE_REVISION` once Step 15 lands, although R11 only requires that for price-affecting writes.

## 2026-11-13T13:09:37Z — checkpoint 4
- Steps C.11–C.13 + 12-review-fix (c7e8e7d..5e21994): generate ✅, typecheck ✅, build ✅, full `yarn test` 115 suites / 1684 tests ✅. UI pass skipped (no UI touched; no runnable app env).

## 2026-11-13T13:30:04Z — review of Steps 14–17
- Finding (major, R8 signal gap — flagged by the executor): the margin tracker skipped any write on a quote with no cost lines before it, so a saved recalculation that created the quote's first cost lines (a costed line added, or the toggle switched on) never emitted `margin_changed`.
- Fix (Step 14-review-fix, inline): when nothing existed before, `after` repeats the same indexed existence query; if cost lines now exist the margin is reported with `previousMarginHash: null`. Quotes without costs still compute no margin (one existence query per side).
- Accepted: `margin_changed` (non-broadcast) carries quote-level aggregates (`contractMargin`, `marginPercent`, `costCoverage`) as the feature spec Delta lists; conversion guard reviewed (price-basis on live lines, expiry, toggle-independent, before the order number); Step 17 sweep found no leak; `ce.ts` needs no exclusion (label-only registrations).
- Deferred (feature 2 scope): conversion and ARC detach-target writes run without the tracker — conversion locks the quote's costs (copied to order costs by the order/subscription costs feature).

## 2026-11-13T13:33:54Z — checkpoint 5 (Phase C closed)
- Steps C.14–C.17 + 14-review-fix (4bc3274..0c7c25d): generate ✅, typecheck ✅, build ✅, full `yarn test` 116 suites / 1713 tests ✅. UI pass skipped (no UI touched; no runnable app env).
- Decision: the revision bump on margin-only cost writes (noted at checkpoint 4) stays — App Spec R11 expects concurrent margin-only edits to collide on the revision (that is why the supplier-answer API takes no revision).
- Step 18: the specification page has no charge editor (its bulk charge form is dead code, never rendered), so the cost-plus editor lives on the offering page only. CPQ ships no locale files; strings use `t(key, fallback)` like the rest of the module, so there is no `en` file to extend. The API exposes no "referenced" flag on pricing tables, so the purpose selector becomes read-only after the first `422 PURPOSE_LOCKED`.
- Step 19: resolved quote charges carry no fallback price, so the "≈ {fallback}" label renders when an optional `fallbackPrice` is present on the charge and otherwise shows "Price on request" (API gap: expose the charge's `fixedPrice` as `fallbackPrice` on cost-plus charges if the ≈ label is wanted on quotes). Row actions (Add / Edit / Confirm / Override) arrive in step 20.

## 2026-11-13T17:44:17Z — review of Steps 18–19
- Note: the Phase D executor hit a provider rate limit after landing Steps 18 and 19 (both pushed, tree clean); Step 20 re-dispatched on its own.
- Finding (major, R5 / §UI): the quote page could only show "Price on request" for an unpriced cost-plus charge, because resolved charges never carried the charge's fallback indicative price (the "≈ {fallback}" label had no data).
- Fix (Step 19-review-fix, inline): unpriced cost-plus charges carry `fallbackPrice` (from the charge's `fixedPrice`) for display only; `unitPrice` / `totalPrice` stay null, so totals and readiness are unchanged.
- Accepted: the cost-plus editor lives on the offering page only (the specification page renders no charge editor); CPQ ships no locale files, strings use `t(key, fallback)` like the rest of the module; the pricing-table purpose selector turns read-only after the API's `422 PURPOSE_LOCKED` (no "referenced" flag in the API).

## 2026-11-13T17:51:24Z — checkpoint 6 (Phase D closed)
- Steps D.18–D.20 + 19-review-fix (f6e0157..b42681c): generate ✅, typecheck ✅, build ✅, full `yarn test` 122 suites / 1775 tests ✅. UI touched but browser verification skipped: the app cannot run here (no Postgres, Docker socket denied) and no browser provider is configured.

## 2026-11-13T17:51:24Z — safety checkpoint: paused for user review
- This resume landed 22 consecutive Steps (A.4 → D.20, including 5 review fixes). Per the executor-dispatch safety stop (~20 Steps), dispatch halts here for a user review. Status stays in-progress; the PR stays a draft.
- Resume with `om-auto-continue-pr-loop 93` → first remaining Step: E.21 (calculate-price).

## 2026-11-13T17:52:10Z — safety checkpoint cleared
- The user instructed: continue autonomously until the whole task (all six cost-plus feature specs) is complete, without further confirmation. Resuming at E.21.

## 2026-11-13 — Step 23 (scope decisions)
- Margin-approval workflow recipe: the repo seeds no workflow definitions anywhere (only the wizard-rename migration touches the table), so the recipe is documented in `manuals/cpq-cost-plus-pricing.md` (route + stored-hash mutation guard example) and NOT seeded; nothing to disable.
- Demo identities: `admin@gix.com` (pricing manager, holds `cpq.costs.*` by default), `employee@gix.com` (rep, view only) and a new `pricing@gix.com` with a `pricing_manager` role whose features come from `demo_gix` `setup.defaultRoleFeatures` (applied by `ensureCustomRoleAcls`). `cpq.cost_plus` is switched on for the GIX tenant through a per-tenant `FeatureToggleOverride` (never overwrites an existing override); the global default stays off.
- The demo seed is split: catalog (toggle override, cross-connect cost table, IP Transit offering + cost-plus charge + 3 elements) runs in `seedGixDefaults`; the four demo quotes (pending / estimated / confirmed / expired, keyed by `quoteContext.scenario`) run in `seedGixExamples` on Acme. Catalog rows are written through entities (like the other GIX seeds), quotes and cost confirmation through the public services.
- Playwright smoke `.ai/qa/tests/TC-CPQ-001-cost-plus-smoke.spec.ts` was written and type-checked, but NOT run (no Postgres / Docker / browser). It is API-driven against the seeded GIX tenant.

## 2026-11-13T18:12:04Z — review of Steps 21–24
- Finding (minor, demo): the seeded `pricing@gix.com` user held only the CPQ-only `pricing_manager` role, which lacks the standard backend features (dashboard etc.) the `employee` role carries. Fix (23-review-fix): the user holds `employee` + `pricing_manager`.
- Accepted: calculate-price strips `fallbackPrice` (the public contract says "no price" for price-on-request charges); no workflow definitions are seeded anywhere in the repo, so the margin-approval recipe is documented in the manual instead of seeded; the Playwright smoke `TC-CPQ-001-cost-plus-smoke.spec.ts` is written and type-checked but not executed (no Postgres / Docker / browser).

## 2026-11-13T18:14:38Z — final gate (local) + review pass started
- Local final gate at e4db511: `yarn generate` ✅, `yarn typecheck` ✅, CPQ build ✅, `yarn test` 123 suites / 1795 tests ✅. Integration suite: not runnable here (no Postgres / Docker / browser) — CI's "Integration tests" job runs it (incl. the new TC-CPQ-001 smoke). Style-compliance pass: skipped — the repo has no ESLint config or design-system lint (`yarn lint` = `next lint` without config).
- om-auto-review-pr 93 --autofix: two read-only reviewer subagents in parallel (cap 2) — (1) triage of the 29 inherited claude[bot] inline comments + summary asks and an API security re-check, (2) a fresh om-code-review of the branch. Fixes follow serially as X-review-fix Steps.

## 2026-11-13T22:41:35Z — CI integration failure (blocker) → 24-review-fix
- CI run 43480307531 at e4db511: unit tests ✅, integration tests ❌ — only the new `TC-CPQ-001-cost-plus-smoke` failed: it looked up a seeded "Acme" company that CI's tenant does not have (the GIX catalog itself was present). All other integration specs passed.
- Fix: the smoke test creates its own company with `createCompanyFixture` (the pattern every CPQ integration spec uses). CI re-runs it; it cannot run locally.
- The first review attempt (two reviewer subagents) was lost to a session restart before writing findings; re-dispatched.
