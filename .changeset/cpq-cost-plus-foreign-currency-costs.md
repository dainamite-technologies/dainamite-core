---
"@dainamite/cpq": minor
---

Foreign-currency costs for cost-plus pricing.

- Migrations `Migration20261115100403` (`cpq_quote_line_costs`) and
  `Migration20261115102552` (`cpq_order_line_costs`, `cpq_inventory_costs`) add
  nullable `fx_rate_source` / `fx_rate_derivation`; run `yarn mercato db migrate`.
- A cost in a currency other than the quote's is converted with a dated rate from
  the `currencies` module (`exchangeRateService.getRate`, `autoFetch: false`;
  optional peer: without it foreign costs stay `CURRENCY_NO_RATE`). The rate, date,
  source and derivation are stored on saved recalculations of unlocked quotes,
  frozen with the cost lock, never refreshed on carried / ARC mirror lines, and
  copied verbatim to order and inventory costs. No rate means `CURRENCY_NO_RATE`,
  never 1:1. Quotes without foreign costs are byte-identical (price and margin hash).
- New feature toggles `cpq.cost_plus.fx_max_days_back` (default 7) and
  `cpq.cost_plus.fx_source_priority` (default `[]`).
- Additive API: FX fields and `errorDetail` on cost projections (`cpq.costs.view`
  only), `fxFrom` / `fxHint` on `POST /api/cpq/cost-preview`, `missingFxPairs` on
  `GET /api/cpq/cost-plus/usage`.
- `POST /api/cpq/quotes/price` now prices foreign-cost charges at today's rate
  (previously `priceOnRequest`); public calculator prices move with each daily rate.
- Known limit: the built-in NBP / Raiffeisen providers do not feed `getRate`
  (upstream issue UP-FX-1, to be filed); maintain rates manually at UTC midnight.
