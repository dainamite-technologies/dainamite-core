# Staff-engineer review — `2026-11-10-cpq-manual-price-adjustments.md` (first draft)

Execution: fresh-context subagent given only the spec path (+ repo rules and cited code), 2026-11-10. Verdict: **revise** → revised.

| Finding | Severity | Resolution |
|---|---|---|
| Amend price changes never reach billing (amend events carry only added / removed items) | Critical | Decision (a): ARC mirror lines (Amend and Renew) not adjustable until `arc-continuity`; `add` lines adjustable. App Spec R9 rollout rules updated. |
| Bundle: recalc hardening + Amend freeze are standalone fixes of existing defects | High | Split: new spec `2026-11-10-cpq-quote-pricing-integrity.md` (recalculate permission / terminal refusal, frozen Amend lines, guards + `openApi` on existing routes) ships first. |
| Transaction / locking model under-specified; CPQ has no `transactional` today; conversion takes no lock | High | Explicit boundary (`em.transactional` + `LockMode.PESSIMISTIC_WRITE`, incl. conversion, post-commit events) as its own step with a DB-backed concurrency test; App Spec +1 commit (44). |
| Event contract not in the spec; hash inputs undefined | High | Typed payloads, canonical hash inputs (reason fields excluded), `clientBroadcast`, additive versioning; enforcement only via project guard stated. |
| Calculate-price waterfall leaks to anonymous Puffin visitors | Medium | Opt-in `includeWaterfall`; pre-existing `adjustments[]` leak logged U19. |
| Rollback under-specified | Medium | Toggle `cpq.manual_price_adjustments` gates writes (prices kept); code-rollback procedure documented. |
| Delta gaps (characterization order, incomplete derivation, clone, removal, guards, unfreeze rule) | Medium | Scenarios added; unfreeze rule defined in the integrity spec; characterization before refactors. |
| `discountTotal` sums inconsistent figures | Medium | `discountTotal` unchanged; new totals both include line quantity. |
| Wrong calculate-price path | Low | `/api/cpq/quotes/price`; manual correction in Phase E. |
| `hasFeature` in handler not grounded | Low | Recalculate route uses route-level `requireFeatures: ['cpq.quotes.manage']` (UI always saves). |
