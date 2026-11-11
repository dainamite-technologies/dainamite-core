# Handoff — manual price adjustments

Branch: feat/cpq-manual-price-adjustments
PR: #85 (draft), stacked on PR #84
Current phase/step: Phase 5 — 5.2 demo seed implemented (uncommitted until root typecheck), then full gate + independent review
Last implementation commit: 832eca7

## Completed
Phase 1 steps1.1–1.7 plus foundation review fixes. Stored adjustments now price quotes/sales lines during recalculation, with separate summaries and deterministic hash. All listed quote writes/conversion lock the scoped quote root in a transaction and bump revision. Read-only recalculation does not mutate managed quote status or totals. Frozen snapshots stay unchanged on disk; legacy waterfall fields are derived for responses.
681 CPQ tests pass. Root tsc still running via exec session9527; /tmp/cpq-manual-root-types.log. Prior package typecheck passed.

## Next concrete action
Consume fresh review 59a30480 (exact9a07adb..db4808a), check root typecheck result, fix findings. Then implement command-backed adjustment service/API (2.1 onwards), followed by preview/reasons/ACL/clone/removal/conversion/price opt-in, events, UI and docs.

## Important implementation notes
Use explicit transaction EM for new adjustment mutations and recalculation; existing helper withQuotePricingWrite returns after DB commit. New command service should call a quoting-service method that recalculates on the supplied locked config/EM, avoiding a nested public recalculate call and a second revision bump. Reason dictionary and feature-toggle APIs were inspected but are not implemented yet. Framework DI featureTogglesService.getBoolConfig returns {ok,value}; unknown/misconfigured toggles fail closed. DictionaryEntry has no isActive field (entries are removed; Dictionary has isActive). Preserve stored inactive reasons when repricing/cloning.

## Environment limits
No migrations applied. DB concurrency/UI checks unverified; Docker access denied. New branch not published; Cezar Guard permission needed before publication. User's last permission explicitly covered PR84 push.

## 2026-11-10 Claude session (resume after usage limits)
- 3.1 events 5af6610; 4.1 waterfall UI 5f50680; 4.2+4.3 dialog/panel 70ac37a; 4.4 order/subscription waterfall cbc16ca; 5.1 docs adcb50f; 5.3 archive 832eca7. Pushed through 70ac37a.
- Reasons now served by GET price-adjustments (`reasons`), so reps need no dictionaries.view.
- Deviations: legacy quote first save suppresses pricing_changed even if prices changed (no stored pre-feature hash). Panel author shows a truncated user id (no user lookup). Order/subscription waterfall shows reason codes, not labels.
- Not done: Playwright flow (no DB; no new-sale quote fixture helper) — needs QA follow-up. Independent backend+UI review: two dispatches died on runner usage limits; re-dispatch before marking PR #85 ready.
