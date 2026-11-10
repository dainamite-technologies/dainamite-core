# Handoff — manual price adjustments

Branch: feat/cpq-manual-price-adjustments
PR: not opened; stacked on PR #84 (5f2b419)
Current phase/step: Phase 2, step 2.1 (not started)
Last implementation commit: db4808a

## Completed
Phase 1 steps1.1–1.7 plus foundation review fixes. Stored adjustments now price quotes/sales lines during recalculation, with separate summaries and deterministic hash. All listed quote writes/conversion lock the scoped quote root in a transaction and bump revision. Read-only recalculation does not mutate managed quote status or totals. Frozen snapshots stay unchanged on disk; legacy waterfall fields are derived for responses.
681 CPQ tests pass. Root tsc still running via exec session9527; /tmp/cpq-manual-root-types.log. Prior package typecheck passed.

## Next concrete action
Consume fresh review 59a30480 (exact9a07adb..db4808a), check root typecheck result, fix findings. Then implement command-backed adjustment service/API (2.1 onwards), followed by preview/reasons/ACL/clone/removal/conversion/price opt-in, events, UI and docs.

## Important implementation notes
Use explicit transaction EM for new adjustment mutations and recalculation; existing helper withQuotePricingWrite returns after DB commit. New command service should call a quoting-service method that recalculates on the supplied locked config/EM, avoiding a nested public recalculate call and a second revision bump. Reason dictionary and feature-toggle APIs were inspected but are not implemented yet. Framework DI featureTogglesService.getBoolConfig returns {ok,value}; unknown/misconfigured toggles fail closed. DictionaryEntry has no isActive field (entries are removed; Dictionary has isActive). Preserve stored inactive reasons when repricing/cloning.

## Environment limits
No migrations applied. DB concurrency/UI checks unverified; Docker access denied. New branch not published; Cezar Guard permission needed before publication. User's last permission explicitly covered PR84 push.
