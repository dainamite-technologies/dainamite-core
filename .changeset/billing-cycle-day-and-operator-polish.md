---
'@dainamite/billing': minor
---

Bill cycle day, every-N cycles and operator polish.

- **Breaking — bill cycle.** `billCycleAnchor` / `bill_cycle_anchor` is replaced by `billCycleDay` / `bill_cycle_day` (`1`–`31` for monthly / annually, `mon`–`sun` for weekly, `null` for daily) plus `billCycleInterval` / `bill_cycle_interval` (every N units, default 1). Units are now `daily | weekly | monthly | annually`; `quarterly` is gone (use `monthly` × 3). No alias is kept. Migration `Migration20261121000000_billing_cycle_day` renames the column and converts quarterly rows.
- **Billing uses the bill cycle day.** `nextBillDate` is optional on create (defaults to the first cycle day on or after today). Bill Runs and prepaid period close re-pin every advance to the day, so a 31st no longer drifts to the 28th. Changing the cycle on a live account moves the next bill date to the next occurrence of the new day; that run bills one short alignment period and prorates in-advance charges. The arrears period now starts the day after `last_bill_date`.
- **Every N days.** For example, `billCycle: 'daily', billCycleInterval: 30`.
- **Invoice lines** show their service period under the description on the admin invoice page (it was shown only on prorated and credit lines).
- **Payment back navigation.** A payment opened from an account returns to that account's Payments tab.
- **Billing Accounts list.** A Billing pill ("Billed through …", "Due since …", "Not billed yet") replaces the Last bill column. The Cycle column reads "Monthly on day 15" or "Every 30 days".
