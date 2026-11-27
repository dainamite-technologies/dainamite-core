---
"@dainamite/cpq": minor
---

Billing period per recurring charge and subscription status actions (spec 2026-11-26 line period & status, D5 + D6).

- Product charges get `billingPeriodUnit` (`month` | `year`) and `billingPeriodInterval` (default every 1 month; migration `Migration20261126100000_cpq_charge_billing_period`). The price is per that period; the offering charge editor and catalog show it ("480,000 / year"). Only MRC charges can have a non-monthly period (V-CHG-2).
- Resolved charges carry `billingPeriod` (absent = monthly); quote, order and subscription item charges inherit it. MRC totals and deal value use the monthly equivalent; charge tables show the price per period and the monthly equivalent.
- `cpq.subscription.activated` and ARC `addedItems` / `changedItems` emit one recurring charge per distinct period, priced per period, with `billingPeriod` (omitted for every 1 month).
- New statuses `paused` and `grace` for subscriptions and items (XD-215 state machine updated). New `POST /api/cpq/inventory/subscriptions/actions` pauses, suspends, puts in grace, resumes or terminates a whole subscription or one item, with dates, charge behaviour and reason (migration `Migration20261126110000_cpq_inventory_status_periods`).
- New events `cpq.subscription_item.status_changed` and `cpq.subscription.terminated`, emitted after commit. The legacy status route now runs these moves as actions, so suspend / terminate from the inventory reach billing.
- New AI tool `cpq.change_subscription_status` (approval card), allowlisted on the quoting assistant. Inventory detail page gets status action dialogs.
