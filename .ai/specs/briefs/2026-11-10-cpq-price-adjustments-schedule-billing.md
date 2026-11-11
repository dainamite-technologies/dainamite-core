# Bill CPQ price schedules as dated billing segments aligned to billing cycles

- Date: 2026-11-10
- Category: feature
- Priority signal: high — §7 Phase 3 (ships together with `time-windows`)
- Risk signal: medium — billing correctness at segment boundaries
- Routing: om-spec-writing "Bill CPQ price schedules as dated billing segments aligned to billing cycles — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-schedule-billing.md"
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — sections §1.4 (R14, R15, I-8, I-12), §3 WF2 (segments vs credits decision), §5 US-2.2, 2.3, 3.3 (schedules), §7 Phase 3

## Problem

A quoted promotion must be invoiced per its schedule without manual credits; billing bills recurring items only for full cycles (C9).

## Agreed direction

- One recurring billing item per item segment at the per-cycle rate; every boundary after activation moved to its billing-effective date (next cycle start); `sourceRef` `-s<n>`; no prorations (US-2.2 worked amounts).
- Cancel: delete future never-billed segments (the never-later rule already ships with `billing-rerate`) (US-2.3).
- Reconciliation understands segments (US-2.5).
- `modifiedItems` with schedules reuse the Phase-2 re-rate algorithm per segment.
- Rejected: per-cycle negative credits.

## Resolved unknowns

| Question | Answer |
|---|---|
| Multiple MRC charges | Item schedule = union of boundaries, Σ prices × line quantity |
| First partial cycle | Unchanged (U3) |
| Future segments on cancel | Deleted (billing items CRUD `DELETE`) |

## Non-goals

- Quote-side windows (sibling `time-windows`); usage billing; merge-renew (U14).

## Affected areas (if known)

- `packages/cpq-billing-connector/src/modules/cpq_billing_connector/` mapper, activated / amended / cancelled subscribers.
- Depends on `billing-rerate`, `time-windows`.
