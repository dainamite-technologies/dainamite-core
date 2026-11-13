---
"@dainamite/cpq": minor
---

Cost-plus charges, a cost catalog and quote margin (known costs).

- New tables `cpq_charge_cost_elements`, `cpq_quote_line_costs` and
  `cpq_quote_markup_overrides`; new columns `cpq_product_charges.markup_rule` /
  `markup_value` and `cpq_pricing_tables.purpose`. **Upgrade steps for existing
  tenants:** `yarn mercato db migrate`, then `yarn mercato cpq seed-cost-plus`
  (registers the `cpq.cost_plus` toggle, default off) and
  `yarn mercato auth sync-role-acls`; then switch the toggle on per tenant.
  Check `GET /api/cpq/cost-plus/usage` before switching it off: stored
  cost-plus charges lose their price on re-pricing.
- A charge can use pricing method `cost_plus` (markup percent, target margin
  percent or absolute) over catalog cost elements (`fixed`, `table`,
  `on_request`; price-basis or margin-only). Cost tables are pricing tables with
  `purpose = cost`. Quote lines get cost lines; managers enter, confirm and add
  costs and override the markup, under the same lock as negotiated prices.
- New features `cpq.costs.view` (admin, employee) and `cpq.costs.manage`
  (admin). Without `cpq.costs.view` no cost, supplier, markup or margin is
  returned anywhere; only cost status.
- New routes: `charge-cost-elements`, `cost-preview`, `cost-plus/usage`,
  `quotes/{quoteId}/costs`, `quotes/{quoteId}/costs/{costId}`,
  `quotes/{quoteId}/markup-overrides`. Status transitions accept an optional
  `expectedRevision` (`409 STALE_REVISION`).
- New event `cpq.quote.margin_changed` (non-broadcast);
  `cpq.quote.status_changed` gains `hasPendingCosts` and `hasEstimatedCosts`.
- New error codes, including **`422 COSTS_NOT_CONFIRMED`**: converting a quote
  with an unconfirmed or expired price-basis cost is now refused.
- calculate-price charges gain optional `indicative` and `priceOnRequest`.
- **Type change:** `ResolvedCharge.unitPrice`, `totalPrice`, `listUnitPrice` and
  `listTotalPrice` are now `number | null`, with an optional `fallbackPrice`.
  TypeScript consumers must handle `null`; runtime values of existing charges
  are unchanged.
