---
"@dainamite/cpq-billing-connector": minor
---

Line period, price phases and line status from CPQ (specs 2026-11-26 line period & status and price phases, Phase 3; contract C3).

- Recurring charges map their `billingPeriod` to the Billing Item's own period (every 1 month = follow the account, unchanged). `sourceRef` stays `cpq-<sub>-<item>-recurring` for monthly charges and appends `-<N><m|y>` for other periods — on activation, ARC `addedItems` and `changedItems`.
- `charges[].phases` become billing price phases (`month`, `fixed`, `phasesEnabled: true`) in the same create write.
- A charge billing cannot take (more than 12 phases, invalid phase or period, missing price) is refused and logged, never trimmed; the item's other charges still bill. An ARC re-rate with a refused charge keeps the item on its current price.
- ARC re-rate creates one Billing Item per billing period of a changed item and ends all its old recurring items.
- New persistent subscribers: `cpq.subscription_item.status_changed` (billing status periods; resume closes the open period at `fromDate − 1`) and `cpq.subscription.terminated` (end dates like cancel). Both idempotent on replay; devices attached to an affected item follow it.
- `BillingApiClient` gains status-period reads and writes (`billing.items.status_periods.*`, system context).
