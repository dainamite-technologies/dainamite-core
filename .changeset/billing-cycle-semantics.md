---
'@dainamite/billing': minor
'@dainamite/cpq-billing-connector': minor
---

Bill runs catch up on every due cycle, bill recurring items in advance or in arrears, and prorate partial periods (billing Spec A).

**`@dainamite/billing`**

- **Every run catches up.** Manual or scheduled, in real, test or dry mode, a run bills every due bill date up to `asOfDate`, with one draft per bill date (capped at 60 per account). Test and dry runs simulate every cycle in memory without changing the account. **Breaking:** the `catchUp` trigger flag and the `catch_up` run column/response field are removed. A `catchUp` sent by an old client is ignored.
- **Charge timing per item.** Recurring items carry `chargeTiming` (`in_advance` by default, or `in_arrears`). **Behaviour change:** recurring items are now billed in advance by default, so `next_bill_date` marks the start of the period billed.
- **Proration per item.** `prorate` defaults to `true`. A partial period (the item starts or ends mid-cycle) is charged by calendar days instead of being skipped. An in-advance item that ends after it was billed gets a negative credit line for the unused days. With `prorate: false`, partial periods are skipped and reported.
- **Run outcomes** carry `cycles` (bill date, service period, status, lines, net, invoice). `warnings.skipped_items` lists items that were not billed and why. The run summary adds `cycles_processed`. The run detail page shows a Cycles table and a Skipped items table.
- **Draft invoices** carry `metadata.bill_date`, the de-duplication key, together with `test_run`. Test drafts and real drafts never block each other. Lines carry `service_period_start` / `service_period_end`, plus `proration` and `credit_for` where they apply.
- **Item form** gets Charge timing and Prorate partial periods fields. The items list gets a Timing column.
- **Migration** `Migration20261114100000_billing_cycle_semantics`. Run `yarn mercato db migrate`. See `MIGRATION.md`; reseeding is recommended.

**`@dainamite/cpq-billing-connector`**

- **Proration moves to billing.** `cpq.subscription.amended` no longer posts `one_time` proration items, because the billing engine prorates. Release together with billing: an older connector would double-charge.
- **First bill date.** New billing accounts start billing on the activation date (they used to start one month later), so the first period is billed in advance.
- Removes `lib/prorationHelper` and the runtime import of billing's `cycleContaining`.
