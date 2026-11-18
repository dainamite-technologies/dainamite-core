# Capability: cpq-cost-catalog

What a charge costs us, kept in the catalog: cost-plus charges, their cost elements and confidential cost tables. Quote-side use of these costs lives in `cpq-quote-pricing`.

## Requirement: Cost-plus charge
The system SHALL let a user with `cpq.products.manage` and `cpq.costs.view` set an NRC or MRC charge's pricing method to `cost_plus` (flat or per-unit), with a markup rule (`markup_percent`, `target_margin_percent` below 100, `markup_absolute`) and a value, when the tenant toggle `cpq.cost_plus` is on. The charge SHALL have at least one active price-basis cost element, and MAY carry a fixed price as a display-only fallback (indicative) price. Any product-charge write that asks for `cost_plus`, sets a markup, or touches a stored cost-plus charge (including switching it to another pricing method and deleting it) SHALL require `cpq.costs.view` (`403 COSTS_VIEW_REQUIRED`) before any validation runs. Activating a cost-plus charge SHALL check its price basis under the same charge-row lock that cost-element writes take.

### Scenario: Make a charge cost-plus
- WHEN a pricing admin saves charge `tail_mrc` with `pricing_method = cost_plus`, `markup_percent` 25 and one active `price_basis` cost element
- THEN the charge is saved, and the cost preview for a sample configuration shows cost 400 and list price 500

### Scenario: No markup oracle
- WHEN a user with `cpq.products.manage` but without `cpq.costs.view` sends `markupValue: 150` to a cost-plus charge whose stored rule is `target_margin_percent`
- THEN the API returns `403 COSTS_VIEW_REQUIRED`, never the `400` a costs viewer would get

### Scenario: Switching away needs cost access
- WHEN the same user switches a cost-plus charge to `fixed`
- THEN the API returns `403 COSTS_VIEW_REQUIRED`, and the markup and price-basis elements are untouched

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
The system SHALL store a charge's default costs as cost elements, each with an immutable code, a role (`price_basis` / `margin_only`), source (`fixed`, `table`, `index`, `on_request`), cost type and cost model, and SHALL reject combinations that App Spec §1.4.4 forbids. An `index` element SHALL reference an active index of the same tenant and organization, with `index_factor > 0` (default 1) and `index_offset ≥ 0` (default 0, in the index currency), no own amount or currency, and cost model `flat` or `per_unit`. The code becomes the quote cost key, so it SHALL be unique across every charge priced together on one quote line (all charges of the offering, or of the product for a product-level charge), not only within one charge.

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

### Scenario: Index element
- WHEN an element with `source = index`, Brent, factor 0.5 and offset 2 is saved
- THEN it is stored, and the cost preview at Brent 82.40 shows unit cost 43.20 USD

### Scenario: Index element without an index, or with a tiered model
- WHEN an `index` element omits `costIndexId`, references an inactive index, or uses `cost_model = tiered`
- THEN the API returns `422 INDEX_REQUIRED`, `INDEX_INACTIVE` or `MODEL_REQUIRES_TABLE`

### Scenario: Index fields on another source
- WHEN a `fixed` or `table` element is saved with `costIndexId`, `indexFactor` or `indexOffset`
- THEN the API returns `422 INDEX_FIELDS_NOT_ALLOWED`

Frozen by: `packages/cpq/src/modules/cpq/api/__tests__/chargeCostElementsRoute.test.ts`, `packages/cpq/src/modules/cpq/data/__tests__/costElements.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md

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

## Requirement: Cost preview shows conversion
The system SHALL return, for each previewed foreign-currency cost, the original amount and currency, the rate, its date and source, and the converted amount, for holders of `cpq.costs.view`. It SHALL store nothing. The preview SHALL also answer a rate hint for a cost currency alone (`fxFrom`), for the cost dialog.

### Scenario: Preview a USD element
- WHEN a pricing admin previews a charge whose fixed element is 300 USD for a EUR configuration, and a rate of 0.92 exists
- THEN the preview shows `unitAmount` 300 USD, `fxRate` 0.92, `fxRateDate`, `fxRateSource`, `convertedInstanceAmount` 276.00 EUR

Frozen by: `packages/cpq/src/modules/cpq/api/__tests__/quoteCostReadRoutes.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Cost indices with append-only values
The system SHALL let a user with `cpq.pricing.manage` and `cpq.costs.view` maintain cost indices (code unique per tenant and immutable, name, unit, currency, active flag) and append dated values (> 0). The server SHALL assign each value a revision equal to one more than the highest revision for the same index and effective date. Values SHALL never be updated or deleted. Reading indices and values SHALL need `cpq.pricing.view` and `cpq.costs.view`: index values are cost data.

### Scenario: Correction for an existing date
- WHEN Brent has value 80.00 for 2026-11-10 (revision 1) and the admin adds 82.40 for 2026-11-10
- THEN a second row with revision 2 is stored, and the value in force on 2026-11-10 is 82.40

### Scenario: Concurrent appends
- WHEN two requests append a value for the same index and date at the same time
- THEN both succeed with revisions n+1 and n+2, or one returns `409 CONCURRENT_INDEX_WRITE` and stores nothing; no two rows share a revision

### Scenario: Non-positive value
- WHEN a value of 0 or -5 is submitted
- THEN the API returns `422` and nothing is stored

### Scenario: Rep without write access
- WHEN a user holding `cpq.pricing.view` and `cpq.costs.view` but not `cpq.pricing.manage` opens the index pages
- THEN the list and detail render read-only (no create, add value, import or edit actions), and every write route returns `403`

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costIndexService.test.ts`, `packages/cpq/src/modules/cpq/api/cost-indices/__tests__/route.test.ts`, `packages/cpq/src/modules/cpq/commands/__tests__/cost-indices.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/costConfidentiality.test.ts`, `packages/cpq/src/modules/cpq/__integration__/TC-CPQ-COST-INDEX-001.spec.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md

## Requirement: Value in force
The system SHALL resolve an index's value for an as-of date as the highest-revision value at the latest effective date on or before that date. Values dated after the as-of date SHALL be ignored.

### Scenario: Future-dated value
- WHEN Brent has 82.40 on 2026-11-10 and 90.00 on 2026-12-01, and a quote is recalculated on 2026-11-12
- THEN the value in force is 82.40

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costIndexService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md

## Requirement: Bulk import of index values
The system SHALL accept up to 1000 index values per request, addressed by index code, and apply them atomically. Rows equal to the current highest revision for their date SHALL be reported `unchanged` and not appended. `dryRun` SHALL validate and report without writing.

### Scenario: Re-run of the same feed
- WHEN the same 30-row import is posted twice
- THEN the first call reports 30 `created` and the second 30 `unchanged`, and no revision is added

### Scenario: One invalid row
- WHEN one of 30 rows names an unknown index code
- THEN the API returns `422` with that row's error, and no row is stored

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costIndexService.test.ts`, `packages/cpq/src/modules/cpq/api/cost-indices/__tests__/route.test.ts`, `packages/cpq/src/modules/cpq/lib/__tests__/costIndexView.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md

## Requirement: Referenced indices cannot be removed
The system SHALL refuse to delete an index referenced by any non-deleted cost element, and to deactivate an index referenced by any active cost element (`422 INDEX_IN_USE`, listing the elements). It SHALL refuse to change an index's currency once it has values or references (`422 INDEX_CURRENCY_LOCKED`).

### Scenario: Deactivate an index in use
- WHEN the admin deactivates Brent while the active element `fuel_surcharge` uses it
- THEN the API returns `422 INDEX_IN_USE` naming `fuel_surcharge`, and Brent stays active

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costIndexService.test.ts`, `packages/cpq/src/modules/cpq/api/cost-indices/__tests__/route.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md
