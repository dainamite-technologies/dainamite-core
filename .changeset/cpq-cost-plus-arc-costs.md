---
"@dainamite/cpq": minor
---

ARC costs for cost-plus pricing: Amend / Renew quotes carry, renegotiate and write back subscription costs.

- Migration `Migration20261115151709` adds `cpq_quote_line_costs.renegotiation_due`,
  widens the `origin` / `value_origin` CHECKs with `carried` and adds a partial index
  on `carried_from_item_cost_id`; run `yarn mercato db migrate`.
- Amend mirror lines (and standalone Renew mirrors, reconciled with the catalog)
  carry the item's open costs; activation updates the item costs in place (same
  ids). Cost-only Amends are margin-only and leave billing payloads byte-identical.
  **Standalone Renews are no longer price-frozen** for cost-plus items.
- Activation lock order is now order row, source quote, target subscriptions
  (sorted by id). `409 COST_SOURCE_CHANGED` at conversion / activation when carried
  costs no longer match the subscription (nothing is written).
- Renew flags carried costs whose supplier term ends before the new term
  (`renegotiation_due`); Keep current cost, Cancel exposure and order line cost
  re-confirmation.
- New routes: `POST /api/cpq/quotes/{quoteId}/items/{lineId}/refresh-from-subscription`,
  `PATCH /api/cpq/orders/{orderId}/costs/{orderLineCostId}`; `keepCurrent` on the
  quote cost PATCH. `GET /api/cpq/cost-plus/usage` gains `openArcQuotesWithCarriedCosts`;
  `QUOTE_CONVERTED` bodies gain `orderLineCostId`.
- Not shipped: Re-price from cost (blocked on `modifiedItems`).
