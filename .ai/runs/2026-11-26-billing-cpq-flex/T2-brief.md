# T2 brief — billing line period, line status, price phases (packages/billing)

Implement the BILLING side of:
- `.ai/specs/2026-11-26-billing-line-period-and-status.md` Phase 1 + Phase 2
- `.ai/specs/2026-11-26-billing-price-phases-ramp-deals.md` Phase 1

## Line period (L Phase 1)
- `billing_period_unit` / `billing_period_interval` on BillingItem (null = follow account).
- D3: the item grid starts at the line start, no stub. In advance → invoiced on the bill date on/before the period start (a line created after it is picked up by the next run). In arrears → first bill date after the period ends.
- Short periods on a long account cycle → ONE invoice line per item with span and count ("Mobile weekly pack · 4 weeks (1–28 Dec) × 15,000").
- End date inside a period prorates it; credit for days billed in advance as today.

## Line status (L Phase 2)
- `BillingItemStatusPeriod` (paused | suspended | grace, from/to, charge_behavior, reason). paused = no charge for paused days (prorated); suspended = charge unless no_charge; grace = flag only.
- A pause recorded after the days were billed in advance → credit line with reason ("Paused 10–19 Jan").
- No overlaps; resume = set the end of the open period. Bulk pause/suspend every line of an account.
- Items tab: status pill next to the billing-state pill ("Paused until 15 Jan"). Read-only in UI/REST for items with a subscriptionId (D6); the connector writes them via commands with auth:null.
- Usage lines are not affected by status.

## Price phases (P Phase 1)
- `BillingItemPhase` child records + `phases_enabled` flag. Free / Fixed / % off / Amount off; back to back from bill_start_date; durations days/weeks/months/years or "until date"; cap 12; recurring only.
- Lines split at phase boundaries on the exact date, prorated by days; prorate=false → the phase in force on the first day of the period prices the whole period.
- Phase name in the line description ("Internet 200 Mb — Promo 50% · 1–31 Jan") and line metadata; a free phase prints a 0.00 line.
- Edits change only periods not yet invoiced (refuse with a credit-memo hint). change-price keeps remaining phases on their original dates. Ending drops later phases. Prepaid period close uses the same engine. Items tab: "Free trial until 13 Dec".

## Engine
All three change `lib/servicePeriods.ts` `computeRecurringLines` (postpaid Bill Run + prepaid close). Design ONE coherent model (item grid vs account grid, phases, status periods). The `billed_to_date` watermark stays the only double-billing guard.

## Tests (required)
Every worked example: P §4.2 A/B/C; L §4.2 mobile annual; L §4.3 pause. Plus month ends, leap year, prorate off, catch-up, weekly line on a monthly account, in arrears, end mid-period, test/dry runs.

## Deliverables
Entities + hand-written migration, validators, undoable commands, API create/update/bulk/change-price + status-period routes with openApi per contract C1 in PLAN.md, billing AI tools, item form UI (period selector, phases switch + editor, status actions), i18n en/es/de/pl, billing manual under manuals/ and capability docs if present, changeset (minor).

You may dispatch up to 2 sub-tasks of your own for clearly disjoint parts (e.g. UI after the API is committed), but you own the result.
