# Phase 4 — role reversal (DDD writes domain criteria, PM challenges) + phasing challenger

Execution: fresh-context subagent (general-purpose) wrote the domain criteria and challenged §7, 2026-11-10. The PM (author) challenged the criteria; outcomes recorded in App Spec §7.

## Phasing findings and resolutions

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Cancel never-later rule shipped in Phase 3, but Phase 2 already creates items ended at E − 1 → cancel re-opens the old-rate item | CRITICAL | Cancel never-later moved to Phase 2 (+1); Phase 3 keeps only "delete future never-billed segments". |
| 2 | Phase-1 workaround corrupts inventory: amend mirror lines re-priced at standard and written to CPQ inventory while billing keeps the old rate; Phase 2 frozen lines would then freeze the wrong price | CRITICAL | Frozen mirror lines moved to **Phase 1**; manual adjustments on **Renew** mirror lines blocked until Phase 2 (`LINE_NOT_ELIGIBLE`), since a renewal price reaches inventory but not billing before Phase 2. |
| 3 | In-flight ARC orders at Phase-2 deploy (no frozen markers) would enter `modifiedItems` and be re-rated to standard | CRITICAL | `modifiedItems` emitted only for ARC quotes created after Phase 1 (lines carry the `_arcPriceFrozen` marker scheme); older orders keep today's behaviour (no `modifiedItems`). |
| 4 | U12 fix leaves existing quarterly / annual items at the monthly rate → mixed rates, reconciliation floods | WARNING | PM decision: **grandfather** — existing items keep their rate until their next re-rate; reconciliation reports them in a separate `legacy-rate` category. Only the U12 / U13 commits are gated on ⚠ confirmation. |
| 5 | U13 scope disagrees (cancels?) | WARNING | Decided: U13 covers re-rates and amend removals; cancel's final-period behaviour stays as defined in xd-249 (out of scope). |
| 6 | Phase-3 version skew (new CPQ + old connector bills regular price during promos); reconciliation must understand segments | WARNING | Windows gated by a feature toggle (`feature_toggles` module, `cpq.price_windows`) enabled only with a schedule-capable connector; reconciliation segment support added to Phase 3 (+1). |
| 7 | Phase 4: a rep's quote-level 10% would beat a carried-over 20% charge-level adjustment | WARNING | R1 refined: rep-created charge / line adjustments beat carried-over ones; carried-over adjustments beat rep-created **quote-level** ones. |
| 8 | Legacy quote's first hash (null → value) fires `pricing_changed` | WARNING | First computation on a legacy quote sets the baseline silently unless offers change. |

## PM challenges to the DDD criteria

- **Accepted:** all integrity, idempotency, event-completeness and concurrency criteria (they protect money and approvals).
- **Changed:** Phase-2 U12 criterion → "new and re-rated items use the per-cycle rate; grandfathered items are reported as `legacy-rate`, not drift" (no backfill).
- **Deferred:** none cut — weekly cycles kept in the property test (cheap, billing supports them).
- Estimate after the fixes: 19 / 10 / 12 / 2 = 43 (resolution and integration commits may split further).
