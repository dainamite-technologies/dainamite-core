---
'@dainamite/billing': minor
---

Own billing period per line, dated line status and price phases (2026-11-26 specs).

- **Own billing period**: a recurring item can bill every N days / weeks / months / years counted from its start
  (`billingPeriodUnit` / `billingPeriodInterval`; null = follow the account cycle). In advance it is invoiced on the
  account bill date on or before each period start, in arrears on the first bill date after it ends; short periods on a
  longer account cycle are grouped into one invoice line (quantity × price per period).
- **Line status**: new `BillingItemStatusPeriod` (paused / suspended / grace, from–to, charge behaviour, reason) with
  undoable `billing.items.status_periods.*` commands, REST `/api/billing/items/status-periods` (+ `/bulk` for every line
  of an account). Paused days are not charged; a late pause credits the already-billed days ("Paused 10 Jan – 19 Jan").
  CPQ lines are read-only (the connector writes them with a system context).
- **Price phases**: new `BillingItemPhase` child records + `phasesEnabled` (free / fixed / % off / amount off; back to
  back from the start; ≤ 12). Lines split on the exact phase date; the phase name is printed on the line. Edits refuse to
  re-price invoiced days (`billing.item.phase_edit_billed`); change-price keeps remaining phases on their dates.
- Shared engine for the postpaid Bill Run and the prepaid period close; the `billed_to_date` watermark stays the only
  double-billing guard.
- AI tools: `billing.list_item_status_periods`, `billing.update_item_schedule`, `billing.set_item_status`,
  `billing.end_item_status`, `billing.set_account_lines_status`.
- Migration `Migration20261126000000_billing_item_period_status_phases` — run `yarn mercato db migrate` after upgrading.
