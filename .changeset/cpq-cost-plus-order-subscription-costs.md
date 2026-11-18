---
"@dainamite/cpq": minor
---

Order and subscription costs for cost-plus pricing (backend).

- New tables `cpq_order_line_costs` and `cpq_inventory_costs`
  (`Migration20261114101001`); run `yarn mercato db migrate`. Conversion copies
  quote costs to the order; activation creates one stable inventory cost per
  subscription item or asset and `cost_key`.
- **Activation is now one transaction**: a late failure rolls back the whole
  activation (subscription, items, assets, costs, change log, order status), and
  `activateOrder` refuses to run inside an outer transaction. New-sale assets are
  created inside `createSubscription`, so the `created` change-log snapshot now
  lists them.
- New event `cpq.subscription.cost_changed` (non-broadcast, no amounts; `cause`
  activation / amend / renew / cancel / merge, `kind` created / changed / ended /
  repointed). Existing subscription event payloads are unchanged.
- New routes `GET /api/cpq/orders/{id}/costs`,
  `GET /api/cpq/inventory/subscriptions/{id}/costs` and
  `GET /api/cpq/inventory/assets/{id}/costs` (status-only without
  `cpq.costs.view`). The change-log route strips `items[].costs` /
  `assets[].costs` from snapshots without `cpq.costs.view`.
  `GET /api/cpq/cost-plus/usage` now fills `liveSubscriptions`.
- ARC safety: Renew mirror lines of cost-plus items are frozen at the contracted
  price (quote-only markers `_arcCostPlusFrozen` / `_arcReconfigured`);
  Amend / Renew / Cancel / merge write inventory costs back (cancel ends, a
  reconfigured mirror updates in place, add creates, merge re-points; ids never
  change).
- New CLI `yarn mercato cpq scrub-change-log-costs [--tenant <id>] [--dry-run]`.
  Rollback order: scrub, then code, then down-migration.
