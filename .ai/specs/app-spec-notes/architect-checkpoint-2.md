# Architect checkpoint #2 — story-to-platform mapping (§5, §6)

Execution: fresh-context subagent (general-purpose), 2026-11-10. Verdict: **re-map needed** → re-mapped in the App Spec ("checkpoint #2 re-map").

| Finding | Tag | Resolution |
|---|---|---|
| `billing.items.update` accepts `rateJson`; negative one-time allowed; billing in arrears → "update rate + signed correction" is simpler for amend-today | MISSED-CAPABILITY (minor) | Recorded as rejected alternative in §4.5: it cannot express future-dated renew or schedule segments; one re-rate mechanism (end-date + new item) for all cases. |
| Dictionary seeding proven only as `isSystem:true, managerVisibility:'hidden'` (`billing/setup.ts`) | WRONG-EVIDENCE | US-1.9 relabelled docs-only for admin editing; CPQ dictionary seeded **visible**; U7 reopened as docs-only. |
| Connector modified items: two prorations (old rate before, new rate after), only open **recurring** items re-rated (NRC never re-billed), payload needs `changeLogId`, price-change detection by before/after diff | UNDERESTIMATED (2 → 4) | R14 rewritten; `modifiedItems` recurring-only, diff-based, with `changeLogId`; 4 connector commits. Existing removal path under-bills days before the change → generic old-rate proration on mid-cycle end-dating (U13 ⚠). |
| Never-later rule must ship with the first end-dated items; renew legitimately extends fixed-term items | UNDERESTIMATED / phasing | Rule ships with re-rates (Phase 2 after the phase split); renewed payload gains `oldTermEnd`; renew extends only items whose end date equals it. |
| U9 coupling — untouched mirror lines re-rated once `modifiedItems` reaches billing | UNDERESTIMATED | Frozen mirror lines on Amend + diff-based `modifiedItems`. |
| Merge-renew clones items under new ids; merged subscriber only re-points | UNDERESTIMATED | Logged U14 (out of scope); reconciliation reports the drift. |
| Carry-over vs tiered / volume | OK with rule fix | Carry-over re-creates the original type. |
| Guard wiring has zero call sites; touched routes trigger the `openApi` DoD | UNDERESTIMATED (1 → 2) | 2 commits incl. `openApi` on touched routes; U10 narrowed to untouched routes. |
| P2 payload commit spans two packages | Wrong package | Split (+1). |
| Row lock + mandatory `expectedRevision` | OVERENGINEERED (minor) | `expectedRevision` optional (UI sends it for stale detection); row lock is the guarantee. |
| Renew `newTermStart` = `currentTermEnd` (off by one), operator-editable (not cycle-aligned), can be past; inventory shows the new price early | design caveats | Re-rate effective date `E = max(newTermStart, oldTermEnd + 1)`; same re-rate algorithm as amend (prorations + billed-cycle difference); "current price" from dated schedule segments (Phase 3); pre-existing early display logged U15. |
| Total 31 not credible (~35–36) | UNDERESTIMATED | Re-estimated: 39 across 4 phases. |
