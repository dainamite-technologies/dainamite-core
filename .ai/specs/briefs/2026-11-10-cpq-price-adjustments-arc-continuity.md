# Keep contracted prices through Amend and propagate re-priced items on Amend / Renew

- Date: 2026-11-10
- Category: feature
- Priority signal: high — §7 Phase 2; removes the Phase-1 ARC workaround
- Risk signal: medium — MODIFIED ARC behaviour (frozen mirror lines) and event payload contract
- Routing: om-spec-writing "Keep contracted prices through Amend and propagate re-priced items on Amend / Renew — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-arc-continuity.md"
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — sections §0 (C12, C13, C15), §1.3, §1.4 (R1, R8, R9, R14, I-13, events), §3 WF3, §5 US-3.1 / 3.2, §7 Phase 2

## Problem

Amend quotes re-price every engine-priced mirror line at today's standard (C12) and never send `modify` changes to billing (C13): negotiated prices are lost in CPQ inventory and any price change on a live item drifts from billing. WF3 ROI: every price change on a live subscription reaches billing; no contracted price silently changed.

## Agreed direction

- Frozen Amend mirror lines already ship with `manual-adjustments` (Phase 1); this feature adds carry-over when a frozen line is re-priced, and makes ARC mirror lines (Amend and Renew) adjustable.
- **Carry-over** on re-priced Amend lines: re-create the source item's manual adjustments with original type / value / reason at charge level, `carried_from_subscription_item_id`, `carried_from_item_hash`; rep-created adjustments beat carried-over ones (R1); source changed → `SOURCE_CHANGED`, conversion / activation refused.
- **Renew** re-prices at standard; `ArcLineDiff` already shows the previous price (0 commits); US-3.2 diff shows previous / standard / delta.
- **`modifiedItems`** in amended / renewed payloads: changed lines only (diff), recurring only, plus `changeLogId` and renewed `oldTermEnd`; emitted only for ARC quotes built with the frozen-line scheme (U17) — older in-flight orders keep today's behaviour.
- Rejected: pinning carried prices as overrides (breaks tiered / volume); re-pricing untouched lines.

## Resolved unknowns

| Question | Answer |
|---|---|
| Which mirror lines are frozen | Engine-priced Amend mirror lines until changed; free-form lines always (R9). |
| Carry-over form | Original adjustment, charge level, same reason (U8 decided). |
| Precedence | Rep-created > carried-over; then specificity (R1). |
| Staleness | Source item hash → `SOURCE_CHANGED` (R8). |
| Payload | §1.4.7 amended / renewed extensions. |
| Acceptance | §7 Phase 2 criteria. |

## Non-goals

- Absolute-window (promo) carry-over — Phase 3 feature.
- The connector side of re-rating — sibling feature `billing-rerate`.
- Merge-renew propagation (U14).

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/services/cpqQuotingService.ts` (`mirrorTargetSubscriptionItems`), `services/cpqOrderService.ts` (`emitAmendedEvent`, `emitRenewedEvent`, activation guard), `services/cpqInventoryService.ts`, `events.ts`, quote UI badges; `manuals/xd-250-arc-flow.md`, `specs/implementation/xd-250-arc-spec.md` (Delta).
- Depends on the `manual-adjustments` feature.
