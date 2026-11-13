# Capability: cpq-cost-catalog

What a charge costs us, kept in the catalog: cost-plus charges, their cost elements and confidential cost tables. Quote-side use of these costs lives in `cpq-quote-pricing`.

## Requirement: Cost-plus charge
The system SHALL let a user with `cpq.products.manage` and `cpq.costs.view` set an NRC or MRC charge's pricing method to `cost_plus` (flat or per-unit), with a markup rule (`markup_percent`, `target_margin_percent` below 100, `markup_absolute`) and a value, when the tenant toggle `cpq.cost_plus` is on. The charge SHALL have at least one active price-basis cost element, and MAY carry a fixed price as a display-only fallback (indicative) price.

### Scenario: Make a charge cost-plus
- WHEN a pricing admin saves charge `tail_mrc` with `pricing_method = cost_plus`, `markup_percent` 25 and one active `price_basis` cost element
- THEN the charge is saved, and the cost preview for a sample configuration shows cost 400 and list price 500

### Scenario: No price-basis element
- WHEN the same charge is saved without an active price-basis element
- THEN the API returns `422 NO_PRICE_BASIS_ELEMENT` and nothing is stored

### Scenario: Toggle off
- WHEN the tenant toggle is off and a charge is saved with `pricing_method = cost_plus`
- THEN the API returns `422 COST_PLUS_DISABLED`

### Scenario: Toggle off is not neutral
- WHEN a tenant with cost-plus charges and open quotes switches the toggle off
- THEN re-pricing those charges yields no price (`COST_PLUS_DISABLED`), all cost endpoints return `404`, and `GET /api/cpq/cost-plus/usage` (`cpq.costs.view`, available with the toggle off) reports `costPlusCharges`, `openQuotes`, `openRequests` and `liveSubscriptions` to check beforehand

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Charge cost elements
The system SHALL store a charge's default costs as cost elements, each with an immutable code, a role (`price_basis` / `margin_only`), source (`fixed`, `table`, `on_request`; `index` is refused until a later feature), cost type and cost model, and SHALL reject combinations that App Spec §1.4.4 forbids. The code becomes the quote cost key, so it SHALL be unique across every charge priced together on one quote line (all charges of the offering, or of the product for a product-level charge), not only within one charge.

### Scenario: Price-basis on a fixed charge
- WHEN a `price_basis` element is added to a `fixed` charge
- THEN the API returns `422 PRICE_BASIS_REQUIRES_COST_PLUS`

### Scenario: Wrong table purpose
- WHEN a `table` element references a pricing table with `purpose = price`
- THEN the API returns `422 WRONG_TABLE_PURPOSE`

### Scenario: Last price-basis element
- WHEN the only active price-basis element of a cost-plus charge is deactivated or deleted
- THEN the API returns `422 NO_PRICE_BASIS_ELEMENT`

### Scenario: Code shared by sibling charges
- WHEN an element is created with a code that another charge of the same offering already uses
- THEN the API returns `422 DUPLICATE_CODE`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Cost tables are confidential
The system SHALL hide pricing tables with `purpose = cost`, and their entries, from users without `cpq.costs.view` on every list, read and write route. The system SHALL refuse to change `purpose` on a table referenced by any charge or cost element (`422 PURPOSE_LOCKED`).

### Scenario: Rep lists pricing tables
- WHEN a user with `cpq.pricing.view` but not `cpq.costs.view` lists pricing tables or reads a cost table's entries by id
- THEN cost tables are absent from the list, and the entries route returns `404`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Markup is confidential
The system SHALL omit `markup_rule` and `markup_value` from product-charge responses for users without `cpq.costs.view`, while `pricingMethod: 'cost_plus'` stays visible.

### Scenario: Catalog reader
- WHEN a user with `cpq.products.view` only reads a cost-plus charge
- THEN the response has `pricingMethod: 'cost_plus'` and no markup fields

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
