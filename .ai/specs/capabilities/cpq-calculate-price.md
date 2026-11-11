# Capability: cpq-calculate-price

The public calculate-price API (`POST /api/cpq/quotes/price`) used by calculators and wizards.

## Requirement: Optional waterfall fields in the calculate-price API
The calculate-price API SHALL return `listUnitPrice`, `listTotalPrice`, `standardUnitPrice` and `standardTotalPrice` only when the request sets `includeWaterfall: true`, SHALL tag rule adjustments `origin: 'rule'`, and SHALL never apply manual adjustments.

### Scenario: Default request
- WHEN a caller posts to `/api/cpq/quotes/price` without `includeWaterfall`
- THEN the response has today's fields plus `origin` on adjustments

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
