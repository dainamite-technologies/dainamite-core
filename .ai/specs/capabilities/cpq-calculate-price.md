# Capability: cpq-calculate-price

The public calculate-price API (`POST /api/cpq/quotes/price`) used by calculators and wizards.

## Requirement: Optional waterfall fields in the calculate-price API
The calculate-price API SHALL return `listUnitPrice`, `listTotalPrice`, `standardUnitPrice` and `standardTotalPrice` only when the request sets `includeWaterfall: true`, SHALL tag rule adjustments `origin: 'rule'`, and SHALL never apply manual adjustments.

### Scenario: Default request
- WHEN a caller posts to `/api/cpq/quotes/price` without `includeWaterfall`
- THEN the response has today's fields plus `origin` on adjustments

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Cost-plus charges in the calculate-price API
The system SHALL return a cost-plus charge's list price when all its applicable price-basis costs resolve without a quote (catalog costs resolved in memory, nothing persisted). It SHALL mark the charge `indicative: true` when any of them is an on-request estimate, and return `priceOnRequest: true` with `unitPrice` and `totalPrice` null, excluded from the totals, when it cannot be priced (pending cost, no price basis) or when the tenant toggle is off. It SHALL never return a cost, supplier or markup, and SHALL leave the Puffin public proxy's response unchanged.

### Scenario: On-request without estimate
- WHEN the Puffin calculator prices an offering whose cost-plus charge has an `on_request` element without an estimate
- THEN the charge has `priceOnRequest: true` and `unitPrice: null`, and the totals exclude it

### Scenario: Estimated cost
- WHEN a cost-plus charge is priced from an `on_request` estimate of 100 at 25% markup
- THEN the charge has `unitPrice` 125 and `indicative: true`, and no cost or markup field appears

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
