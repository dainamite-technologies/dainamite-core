# Architect checkpoint #1 — workflow-to-platform mapping (§3, §4, §4.5)

Execution: fresh-context subagent (general-purpose), 2026-11-10. Inputs: App Spec, capability catalog + cited sources. Verdict: **re-map needed** → re-mapped (App Spec changelog "challenger fixes").

| # | Finding | Tag | Resolution |
|---|---|---|---|
| 1 | Amend / renew payloads carry only `addedItems` + removed ids; `modify` (all renew mirror lines) never reaches billing (`cpqOrderService.ts:1227-1301`, `cpq-subscription-amended.ts:74-77`) | UNDERESTIMATED / WRONG-EVIDENCE | `modifiedItems` added to amended / renewed payloads; connector end-dates old items and re-creates them (WF3, Phase 1 flat: +3 commits). WF3 rationale rewritten (drift CPQ ↔ billing). |
| 2 | Status route has no mutation guard (`api/quotes/[quoteId]/status/route.ts:11-26`); no CPQ quote route exports `openApi` | UNDERESTIMATED | +1 commit WF4: wire `validateCrudMutationGuard` / after-success on status, items, recalculate and the new routes; recalculate `save:true` requires `cpq.quotes.manage`. Missing `openApi` on existing routes logged U10 (new routes export it). |
| 3 | Billing already models discounts as negative `one_time` items (`xd-249:194-196`, `billing/validators.ts:91-95`); C8 evidence inverted | MISSED-CAPABILITY / WRONG-EVIDENCE | C8 corrected. Explicit decision in §4.5: **dated recurring segments** chosen over per-cycle credits (credits need one item per cycle, voiding on cancel / amend, and positive "credits" for non-monotonic schedules; segments keep invoice line = actual price). |
| 4 | Cancel subscriber end-dates every item → extends already-ended promo segments; amend removal does the same (`cpq-subscription-cancelled.ts:54-63`, `cpq-subscription-amended.ts:156-167`) | WRONG-EVIDENCE | One connector rule "never move an existing `bill_end_date` later" across renew / cancel / amend (1 commit, Phase 2). |
| 5 | Dictionaries + RBAC proven in repo (`billing/setup.ts:74-107`, `cpq/acl.ts`, `cpq/setup.ts:20`) | MISSED-CAPABILITY | U7 closed; rows relabelled grounded; no const-list fallback. |
| 6 | Renew before/after diff already exists (`ArcLineDiff`, `quotes/[id]/page.tsx:1313-1329`; `arcSource.mrcAmount` = item `mrcAmount` = offer) | OVERENGINEERED | 0 commits; "Carried over" badge folded into the panel commit. |
| 7 | 10 new line / quote columns not needed by any UI / filter; list derivable from `adjustments[0].unitPriceBefore` | OVERENGINEERED | Values live in jsonb only (`charges`, `pricingSummary`) + read-time helper for legacy charges. Only `pricing_revision` (concurrency token) added to the quote configuration. C2 reworded. |
| 8 | `cpq.price_adjustment.*` events have no consumer | OVERENGINEERED | Dropped; 2 new events (`cpq.quote.pricing_changed`, `cpq.quote.status_changed`). `status_changed` kept — `transitionStatus` writes via EM, no sales event fires. |
| 9 | New table vs jsonb (optional) | OVERENGINEERED (judgment) | Table kept: per-adjustment REST id (PATCH / DELETE), author audit fields, quote-level adjustments have no line to hang jsonb on, overlap checks across levels. |
| 10 | `recalculate({save:false})` previews only saved state; UI on a 1,722-line page under-estimated | UNDERESTIMATED | +1 commit preview endpoint taking a draft adjustment; UI 3 commits. |
| 11 | Rejection of sales `AdjustmentKind` sound | OK | — |
| 12 | Catalog row says mirror lines skip the engine — wrong | WRONG-EVIDENCE | Catalog fixed. |
