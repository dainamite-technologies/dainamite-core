# Supplier costs through Amend / Renew / Cancel, with renegotiation and price lock

- Date: 2026-11-11
- Category: feature
- Priority signal: medium — §7 Phase 3; completes WF6 and replaces the Phase 1 safety freeze
- Risk signal: high — live subscriptions, concurrent ARC quotes, new item-cost hash guard (no existing code to reuse: architect #1), forward compatibility with Phase-1 Renews
- Routing: om-spec-writing "Supplier costs through Amend / Renew / Cancel, with renegotiation and price lock — brief: .ai/specs/briefs/2026-11-11-cpq-cost-plus-arc-costs.md"
- App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md — sections §1.3 (price lock, renegotiation due, keep current cost), §1.4 (R1c, R11 Q-D13 exemption, R13, I-3, I-5, I-10–I-12), §3 (WF6), §5 (US-5.2, US-6.1–6.4), §7 Phase 3, §8
- Depends on: the order / subscription costs feature and the supplier sourcing feature

## Problem

Renewals and amendments do not know what the supplier charges, and supplier renegotiations are not recorded. WF6 ROI: 100% of renewals of costed items show the previous supplier cost and term; 100% of supplier price changes are recorded with an effective date in the month they take effect.

## Agreed direction

- Commits #29–#34 and #27:
  - An item-cost state hash helper with activation refusal `409 COST_SOURCE_CHANGED`. The sibling's future carry-over can reuse it.
  - Amend mirrors carry item costs as `carried` lines. Renew mirrors reconcile with today's catalog (R1c).
  - Price lock on frozen Amend lines: cost changes move margin only. An explicit **Re-price from cost** un-freezes the line, and the new price flows through the existing `modifiedItems` path.
  - Renew: MRC costs whose validity or supplier term ends before the new term become `estimated` (renegotiation due). They need a request or **Keep current cost** with evidence before conversion.
  - Cancel shows supplier early-exit exposure.
  - ARC activation updates the subscription item costs **in place** (ids never change), records before → after in the existing `CpqSubscriptionChangeLog` snapshots of each ARC order, and re-points costs on merge. A cost-only `modify` has a zero billing diff. Events `item_cost_changed` carry the cause.
  - A cost-only Amend is internal: operator `ready → accepted` (Q-D12).
  - `ArcLineDiff` shows costs and margin; the Phase 1 banner is removed; forward compatibility with Phase-1 Renews is kept.
  - Post-conversion re-confirmation before activation (Q-D13) on `CpqOrderLineCost`: margin only, sharing the lock with activation.
- **Ladder:** `arcPriceFreeze` / `_arcRepriced`, ARC mirror and activation write-back (rung 1, grounded C8); the rest new code.
- **Rejected:** automatic price pass-through on cost change (Q-D6); supplier early-termination charge recording (Q-D10); a lightweight non-ARC item-cost command (Q-D12).

## Resolved unknowns

| Question | Answer |
|----------|--------|
| Customer price on supplier renegotiation | Locked; opt-in Re-price from cost (Q-D6) |
| Mid-term supplier change | Cost-only Amend (Q-D12) |
| Early-termination charges | Exposure shown only (Q-D10) |
| Index re-evaluation on Renew | At the recalculation date (Phase 4 adds the index source) |
| Acceptance criteria | §7 Phase 3 domain criteria (R13 / R1c, I-11, I-12 with a parallel-Amend test, I-10, I-9 zero diff, Renew, forward compatibility, Q-D13) |

## Non-goals

- Supplier termination execution; merge-renew cost propagation; index revaluation of live items (Q-D9).

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/services/cpqQuotingService.ts` (mirror), `services/arcPriceFreeze.ts`, `services/cpqOrderService.ts`, `services/cpqInventoryService.ts`, `components/ArcLineDiff.tsx`, `backend/cpq/quotes/[id]` (ARC banners / actions), `events.ts`.
