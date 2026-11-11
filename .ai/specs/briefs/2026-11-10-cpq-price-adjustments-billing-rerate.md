# Re-rate billing items for changed CPQ subscription items, bill per cycle correctly, and reconcile CPQ with billing

- Date: 2026-11-10
- Category: feature
- Priority signal: high — §7 Phase 2
- Risk signal: medium — changes when price changes are billed (whole cycles) and the per-cycle rate of new items (U12 / U13 decided by the user, 2026-11-10)
- Routing: om-spec-writing "Re-rate billing items for changed CPQ subscription items, bill per cycle correctly, and reconcile CPQ with billing — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-billing-rerate.md"
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — sections §0 (C8–C10, C13, C14), §1.4 (R14, R15, I-8, I-12, I-13), §3 WF2 / WF3, §5 US-2.5, 3.2, 3.3, §7 Phase 2, §10 U12 / U13 / U14

## Problem

The connector maps only added and removed items (C13), passes the monthly MRC as the per-cycle rate whatever the account cycle (C8), end-dates without old-rate prorations (C9), re-opens ended items on renew / cancel (C10), and loses events silently (C14). Billing therefore drifts from CPQ.

## Agreed direction

- **Re-rate algorithm** (R14): for `modifiedItems` with nominal date E (renew: E = max(`newTermStart`, `oldTermEnd` + 1)) — B = billing-effective date (first unbilled cycle start ≥ E); end-date open recurring items at B − 1 (never later; future never-billed items deleted), create new items from B (`sourceRef` `…-<type>-<changeLogId>-s<n>`); no prorations, no difference items; NRC never re-billed.
- **End-date rules:** renew extends only items ending at `oldTermEnd`; amend and **cancel** never move an end date later (I-12).
- **Per-cycle rate:** monthly × months per cycle for new and re-rated items; existing items keep their rate, reported `legacy-rate` (U12 decided).
- **U13 decided:** price changes billed per whole cycle from the billing-effective date; added / removed items and cancel keep today's behaviour.
- **Reconciliation** (US-2.5): CLI report CPQ items vs billing items by `sourceRef` / rate; `--replay`; "no billing account" throws for retry.
- Rejected: update `rateJson` in place + correction (cannot express future-dated renew or segments); negative per-cycle credits.

## Resolved unknowns

| Question | Answer |
|---|---|
| Effective date for renew | E = max(`newTermStart`, `oldTermEnd` + 1) |
| Backdated E | new price from the first unbilled cycle; billed cycles untouched |
| Idempotency | `sourceRef` grammar R15 |
| U12 / U13 | decided by the user: easiest correct behaviour (whole cycles, new items per cycle) |

## Non-goals

- Schedule segments (Phase 3 `schedule-billing` feature); merge-renew (U14); first partial cycle after activation (U3).

## Affected areas (if known)

- `packages/cpq-billing-connector/src/modules/cpq_billing_connector/`: `lib/chargeMapper.ts`, `lib/prorationHelper.ts`, `lib/billingApiClient.ts`, subscribers (amended, renewed, cancelled), new CLI.
- Depends on `arc-continuity` (payload fields); `@dainamite/billing` unchanged.
