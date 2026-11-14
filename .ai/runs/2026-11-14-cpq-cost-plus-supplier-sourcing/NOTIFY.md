# Notify — 2026-11-14-cpq-cost-plus-supplier-sourcing

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-14T19:13:56Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md (App Spec cost-plus, feature 3 of 6), stacked on PR #94.
- Decision: one implementation PR for the whole spec (its internal PR A / PR B split folded in), like features 1–2.
- Decision: no DB / browser available — migrations generated DB-less; Playwright specs written here and run by CI (manual dispatch).

## 2026-11-14T19:28:13Z — 4-review-fix
- Margin-only costs are lock-exempt in the sourcing rules (App Spec R11 cost lock: "Exempt: margin-only costs"): on a locked quote a different-value answer is applied (not a proposal that would block conversion with COST_ANSWER_PENDING), and a decline follows the unlocked R10a rule. `classifyAnswer` / `declineEffect` take the cost role; a missing role is treated as price-basis. Steps 7–9 must pass `role`.

## 2026-11-14T20:00:00Z — step 5 (B1)
- Decision: `note` on `POST …/request` is validated (≤ 500) but not persisted: the spec gives it no column and the sourcing events / history carry no free text. Reversible (a `request_note` column or an event field can be added without changing the route).
- Seam for step 12: `services/costs/sourcingSignals.ts` (`SourcingSignal`, `SourcingSignalPublisher`). Every producer pushes amount-free signals during its transaction; `CpqCostSourcingService` (dep `publisher`) and `DefaultCpqQuotingService` (dep `sourcingPublisher`) hand them to the publisher in `withQuotePricingWrite({ afterCommit })`. Step 12 only has to implement the publisher and wire it in `di.ts`; nothing is emitted today.

## 2026-11-14T20:20:00Z — step 6 (B1)
- Decision: a clone's first saved recalculation auto-opens requests like any saved recalculation (Q12; the clone route threads the cloning user as requester, Q5). The clone's cost lines still start `not_requested` (SOURCING_RESET); the open request appears only after that recalculation. Reversible by not passing the sourcing context from `cloneQuoteInTransaction`.
- Decision: R1b cancels on any driver change of an `on_request` / entered cost (also when the value was already `none`), not only when the reset note is written, so a request never survives a reconfiguration it was not made for.

## 2026-11-14T19:47:01Z — 6-review-fix
- A clone's first saved recalculation no longer auto-opens requests (spec "Clone": the cloned tail is `not_requested`, R16; open requests are never copied). New `autoOpen` option on cost resolution (default true); the clone path passes `false`. A later saved recalculation of the clone may still auto-open per Q12.
