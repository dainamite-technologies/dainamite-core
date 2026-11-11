---
"@dainamite/cpq": minor
---

Negotiated prices on quotes (manual price adjustments) with a price waterfall.

- New table `cpq_quote_price_adjustments` and column
  `cpq_quote_configurations.pricing_revision` (migration
  `Migration20261110213052`). **Upgrade steps for existing tenants (required):**
  `yarn mercato db migrate`, then `yarn mercato cpq seed-price-adjustments`
  (rollout toggle + reason dictionary) and `yarn mercato auth sync-role-acls`
  (`cpq.quotes.adjust_price` grant). Without them writes return `403` and the
  UI hides the actions. New tenants get all three at initialization.
- Reps with `cpq.quotes.manage` + `cpq.quotes.adjust_price` can override a
  charge's unit price, take an amount off a charge or give a percentage on a
  charge or line (`/api/cpq/quotes/{quoteId}/price-adjustments`, plus a
  no-write `preview`). Adjustments are permanent, never exceed the standard
  price, never compound, and lock once the quote leaves New / Incomplete /
  Ready. Rollout toggle `cpq.manual_price_adjustments` (seeded on) and reason
  dictionary `cpq.price_adjustment_reason`.
- Charges gain additive `listUnitPrice`, `listTotalPrice`, `standardUnitPrice`,
  `standardTotalPrice` and `adjustmentErrors`; adjustment entries gain
  `origin: 'rule' | 'manual'`. `pricingSummary` gains list / standard totals,
  rule and manual discount totals, deal value, discount depth and
  `snapshotHash`; `QuoteResult` gains `pricingRevision`. `discountTotal` is
  unchanged.
- New events `cpq.quote.pricing_changed` and `cpq.quote.status_changed`
  (after commit, with the pricing snapshot) for project approval workflows.
- Order conversion copies stored prices and returns `422 ADJUSTMENT_INVALID`
  when a stored adjustment is invalid. `POST /api/cpq/quotes/price` accepts
  `includeWaterfall` and never applies negotiated prices.
- Quote, order and subscription pages show List / Offer prices and the
  waterfall; the quote page adds the adjustment dialog and panel.
