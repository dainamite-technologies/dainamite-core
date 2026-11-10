# Time-based price windows (promotions and ramps) on CPQ quotes, orders and subscriptions

- Date: 2026-11-10
- Category: feature
- Priority signal: high — §7 Phase 3
- Risk signal: medium — schedule semantics on `ResolvedCharge`, new subscription-item column, payload contract
- Routing: om-spec-writing "Time-based price windows (promotions and ramps) on CPQ quotes, orders and subscriptions — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-time-windows.md"
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — sections §1.3 (price window, schedule, price month, provisional anchor), §1.4 (R4, R5, R10, I-5, I-7), §3 WF1 / WF2, §5 US-1.3, 2.4, 3.1 (windows), §7 Phase 3

## Problem

Promotions ("first 3 months at 50%") and ramps cannot be quoted; billing operators post manual credits every promo month. WF2 ROI: 0 manual billing corrections for promotional deals.

## Agreed direction

- Windows ship behind feature toggle `cpq.price_windows` (U16), enabled only with a schedule-capable connector.
- Relative windows `[fromMonth, toMonth]` on MRC adjustments (charge, or line with MRC filter); one window kind per charge; term cap; schedule segments with regular price after the last window; item schedule merges all MRC charges (US-1.3).
- `price_start_date` on subscription items; schedule dates materialised at activation / ARC apply; payload item schedules for activation and added items; subscription shows current / regular price and promo end (US-2.4).
- Absolute-window carry-over on Amend, clipped at activation (US-3.1).

## Resolved unknowns

| Question | Answer |
|---|---|
| Window unit | Price months from the price start date, calendar arithmetic with EOM clamping |
| NRC windows | Not allowed (R4) |
| Quote-time absolute windows | Provisional anchor = today (R10) |
| Fields | `from_month`, `to_month`, `window_kind`, `from_date`, `to_date` already defined in §1.4.3 |

## Non-goals

- Billing segment creation (sibling `schedule-billing` feature); calendar-date rule promotions (C16); usage windows.

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/`: pricing / quoting / order / inventory services, entities + migration (`price_start_date`), validators, quote dialog, subscription pages, `events.ts` payloads, demo promo seed.
- Depends on `manual-adjustments`, `arc-continuity`.
