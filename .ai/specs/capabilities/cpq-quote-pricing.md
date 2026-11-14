# Capability: cpq-quote-pricing

How quote charges are priced: list price from the engine (a fixed amount, a pricing-table lookup, or supplier cost plus a markup), standard price after price rules, and the offer price after negotiated (manual) adjustments; plus the cost lines and margin of a quote.

## Requirement: Manual price adjustment on a charge
The system SHALL let a user with `cpq.quotes.manage` and `cpq.quotes.adjust_price` set a new unit price, an amount off, or a percentage discount on one charge of an eligible quote line, and SHALL price that charge at the adjusted value while recording list, standard and offer price.

### Scenario: Override a setup fee
- WHEN a rep sets `price_override` 80 with reason `competitive_match` on charge `setup_fee` whose standard price is 100
- THEN the charge's offer `unitPrice` is 80, `standardUnitPrice` 100, an `adjustments[]` entry with `origin: 'manual'` and `delta: -20` exists, and `pricingRevision` increases by 1

### Scenario: Override above standard
- WHEN a rep sets `price_override` 120 on a charge whose standard price is 100
- THEN the API returns `422 ABOVE_STANDARD` and nothing is stored

### Scenario: ARC mirror line
- WHEN a rep adjusts a mirror line of an Amend or Renew quote
- THEN the API returns `422 LINE_NOT_ELIGIBLE`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Percentage discount on a line
The system SHALL apply a line-level `discount_percent` to every charge of the line (optionally only `nrc` or `mrc`) and of its bundle child lines that has no more specific valid manual adjustment.

### Scenario: Line discount with a charge override
- WHEN a line has a 15% line discount and a charge-level override on `setup_fee`
- THEN `setup_fee` uses the override and every other charge is 15% below standard

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Price waterfall on every charge
The system SHALL expose on every resolved quote charge its list, standard and offer price and the ordered rule and manual adjustments between them; charges saved before this change SHALL derive list and standard prices when read. A cost-plus charge whose list price cannot be computed (an unknown or missing price-basis cost) SHALL expose null `unitPrice`, `totalPrice`, list, standard and offer prices (`ResolvedCharge` prices are `number | null`), a `pricingMethod: 'cost_plus'` marker and an error code instead, and MAY carry a display-only `fallbackPrice` (the charge's fixed price) that is never stored as list price nor counted in totals.

### Scenario: Quote without adjustments
- WHEN a quote has no manual adjustments
- THEN offer equals standard and `unitPrice`, `totalPrice`, line and quote totals equal the values produced before this change

### Scenario: Unpriced cost-plus charge
- WHEN a cost-plus charge has a price-basis cost with `value_status = none`
- THEN its `listUnitPrice`, `standardUnitPrice` and `unitPrice` are null, its error is `COST_PENDING`, and `fallbackPrice` shows the charge's indicative price if it has one

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqPricingService.test.ts`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Invalid manual adjustments are surfaced, not applied
The system SHALL keep a manual adjustment whose target charge no longer resolves (or resolves ambiguously), whose override exceeds the current standard price, or whose currency differs from the quote, SHALL NOT apply it, SHALL fall back to the next valid adjustment or the standard price, and SHALL mark the line `incomplete` (and the quote `incomplete` when it is in an auto-managed status).

### Scenario: Configuration removes the adjusted charge
- WHEN a line's configuration changes so `setup_fee` no longer applies
- THEN the adjustment remains with error `ADJUSTMENT_TARGET_MISSING`, the line is `incomplete`, and a `ready` quote becomes `incomplete`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Adjustment lock
The system SHALL reject creating or changing manual adjustments unless the quote status is `new`, `incomplete` or `ready` and no order exists for the quote, and SHALL allow deleting an invalid adjustment in any non-terminal status.

### Scenario: Edit after submission
- WHEN a rep changes an adjustment on a quote in `in_approval`
- THEN the API returns `409 ADJUSTMENT_LOCKED` and nothing changes

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Adjustment preview
The system SHALL price a draft adjustment against the current quote without persisting anything or emitting events.

### Scenario: Preview
- WHEN a rep previews a 10% line discount
- THEN the response contains the re-priced quote and no adjustment row, revision change or event exists afterwards

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Adjustments follow quote copies and line removal
The system SHALL copy all manual adjustments when a quote is cloned (new ids, remapped lines, invalid ones stay invalid) and SHALL soft-delete a line's adjustments when the line is removed.

### Scenario: Clone
- WHEN a quote with a charge override and a line discount is cloned
- THEN the clone shows the same offer prices and has its own two adjustment rows

### Scenario: Line removal
- WHEN a line with an adjustment is removed
- THEN its adjustment is soft-deleted in the same transaction

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Rule and manual discount totals
The system SHALL report `ruleDiscountTotal` and `manualDiscountTotal` (both including the line quantity), list / standard totals, deal values, signed discount depth and a snapshot hash in `pricingSummary`, and SHALL leave `discountTotal` unchanged.

### Scenario: Manual discount counted
- WHEN a line of quantity 2 has a charge with standard total 100 and offer total 80
- THEN `manualDiscountTotal` includes 40 and `discountTotal` equals its value before this change

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Quote cost lines from catalog cost elements
The system SHALL keep exactly one non-deleted catalog cost line per applicable active cost element on every configured quote line that the engine prices — new lines, Renew mirror lines, reconfigured Amend mirror lines and Cancel-quote lines; never frozen Amend mirror lines — matched by cost key. A line that becomes an ARC cancel line (an item removed on Amend / Renew) SHALL lose its cost lines (catalog and manual) and markup overrides at once, regardless of the toggle or the cost lock. On every saved recalculation it SHALL resolve `fixed` and `table` values (a `table` or `fixed` value is `confirmed`, an `on_request` catalog estimate is `estimated`, otherwise `none`) and soft-delete cost lines whose element no longer applies. A value a pricing manager entered or confirmed (`value_origin = manual`) SHALL survive recalculation until a driving attribute changes.

### Scenario: Add a costed product
- WHEN a rep adds a product whose `tail_mrc` charge has a `table` element and an `on_request` element with estimate 300
- THEN the line has two cost lines: one `confirmed` with the table value (origin `catalog`), and one `estimated` at 300

### Scenario: Reconfigure a driving attribute
- WHEN the line's `bandwidth` (a dimension of the tail element) changes from 1G to 10G
- THEN the `on_request` cost line goes back to its catalog estimate (or `none`), and its previous value is kept in `note`

### Scenario: Unreconfigured Amend mirror
- WHEN an Amend quote mirrors a subscription item and nothing on the line changes
- THEN no catalog cost lines are created on the mirror line

### Scenario: Removed ARC item
- WHEN a rep removes a mirrored item with an estimated tail cost on a Renew quote
- THEN the line becomes a cancel line and its cost lines are soft-deleted

### Scenario: Table without a matching entry
- WHEN a table element's dimensions match no entry of the cost table, or the matching entry has no value in the element's cost column
- THEN the cost line is `none` with `TABLE_NO_MATCH` (never a confirmed 0) and the line is not ready

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Cost-plus list price
The system SHALL price a cost-plus charge at list total = markup(Σ known price-basis costs per instance, converted to the quote currency), where `markup_percent` m gives C × (1 + m/100), `target_margin_percent` gives C ÷ (1 − m/100) and `markup_absolute` gives C + a, rounded once to the currency precision (per-unit: unit = total ÷ quantity at 4 dp). Price rules and manual adjustments SHALL then apply unchanged; percent price rules on a cost-plus charge SHALL scale the exact per-instance total, so no unit × quantity drift appears. An absolute markup is in the charge currency (a markup override's in the quote currency). A charge with an unknown price-basis cost (`COST_PENDING`), with no applicable one (`NO_PRICE_BASIS_COST`), with an invalid markup (`MARKUP_INVALID`) or with an absolute markup in a currency other than the quote's (`CURRENCY_NO_RATE`, never a 1:1 add) SHALL have no price, and its line SHALL NOT be ready. `estimated` costs price the charge and make the quote indicative.

### Scenario: Markup percent
- WHEN price-basis costs are 300 and 100 per instance and the markup is `markup_percent` 25
- THEN `listTotalPrice` is 500.00, and with a 10% manual line discount the offer is 450.00

### Scenario: Unknown cost
- WHEN one price-basis cost line has `value_status = none`
- THEN the charge has no price, the line error is `COST_PENDING`, and a `ready` quote becomes `incomplete`

### Scenario: Foreign-currency cost before FX ships
- WHEN a price-basis cost is in USD on a EUR quote
- THEN the cost line is `none` with `CURRENCY_NO_RATE`, and the line is not ready

### Scenario: Absolute markup in another currency
- WHEN a charge with `markup_absolute` 50 EUR is quoted in USD
- THEN the charge has no price and the line error is `CURRENCY_NO_RATE`

### Scenario: Percent rule on a per-unit cost-plus charge
- WHEN a `per_unit` cost-plus charge of 3 units at 100.00 each has a 10% price rule
- THEN its total is 270.00, not 269.99997

### Scenario: Quote without costs
- WHEN a quote has no cost-plus charges and no cost lines
- THEN `charges`, `pricingSummary` and `snapshotHash` are byte-identical to the values produced before this change

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/costPlusGolden.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Manual costs, cost confirmation and markup override
The system SHALL let a user with `cpq.quotes.manage` and `cpq.costs.manage`:
- add, edit and delete `manual` cost lines (cost key `manual:<8 hex>`; price-basis only on a cost-plus charge, otherwise margin-only; catalog lines cannot be deleted, `CATALOG_COST_NOT_DELETABLE`);
- enter or confirm the value of any cost line, including those of non-frozen ARC mirror lines (overwriting a catalog value needs a note, extending a validity or supplier term needs a new supplier quote reference or a note);
- override or clear a cost-plus charge's markup on one quote line (note required; unknown charge `CHARGE_NOT_FOUND`);

manual costs and markup overrides are refused on every ARC mirror line, and every cost write on ARC cancel lines and frozen Amend mirror lines (`422 LINE_NOT_ELIGIBLE`); all subject to the cost lock: price-basis cost lines and markup overrides can only change while the quote is `new`, `incomplete` or `ready` and no order exists (`409 COST_LOCKED` otherwise; terminal quotes refuse every cost write). With the toggle on, a cost-locked quote SHALL also refuse adding a line whose offering / product has an active cost-plus charge, and changing such a line's configuration or quantity (`409 COST_LOCKED`; term and dates stay editable). Margin-only changes, confirming an unchanged value and extending validity or supplier term are always allowed in non-terminal statuses. Cost writes accept `expectedRevision` (`409 STALE_REVISION`), bump `pricingRevision`, are commands that are not undoable, and write snapshots without amounts.

### Scenario: Enter a tail cost by hand
- WHEN a pricing manager sets the `on_request` tail cost line to 280 EUR, `confirmed`, with a supplier quote ref
- THEN the line prices from 280, and the cost line has `value_origin = manual`

### Scenario: Margin-only custom cost after submission
- WHEN a pricing manager adds a `margin_only` NRC cost of 1500 to a line of a quote in `in_approval`
- THEN the cost line is created, the price is unchanged, and `margin_changed` is emitted with `approvalInvalidated: true`

### Scenario: Price-basis change while locked
- WHEN a pricing manager changes a price-basis cost value, or a markup, on a quote in `with_customer`
- THEN the API returns `409 COST_LOCKED` and nothing changes

### Scenario: Reconfiguring a cost-plus line while locked
- WHEN a rep changes the port count of a per-unit cost-plus line on a quote in `with_customer`
- THEN the API returns `409 COST_LOCKED` and the line keeps its configuration and price

### Scenario: Confirm a Renew mirror cost
- WHEN a pricing manager confirms the estimated tail cost of a Renew mirror line
- THEN the write is accepted, and once every price-basis cost is confirmed the quote converts

### Scenario: Manual per-unit cost follows the quantity
- WHEN the charge quantity of a line with a manual `per_unit` cost changes in a saved recalculation
- THEN the cost line's per-instance amount is refreshed from the new quantity; value, status, origin and note stay

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Quote margin
The system SHALL compute margin for holders of `cpq.costs.view`:
- per charge, line, bundle roll-up and quote: NRC / MRC cost, offer, margin, margin %, markup %, contract margin over the deal-value horizon (NRC once + MRC × term months, default 12; usage and non-deal lines excluded) — percentages are 0–100 numbers, `null` when undefined;
- cost coverage and the flags `hasPendingCosts`, `hasEstimatedCosts`, `hasExpiredCosts` over every cost line (margin-only included);
- `margin_hash` over cost amounts, currency, FX, role, markups, offers and each line's term (months, 12 when unset; statuses excluded).

The system SHALL NOT store margin.

### Scenario: Partial coverage
- WHEN two equal-value lines exist and only one has cost lines
- THEN cost coverage is 50%, and the uncovered line counts as cost 0

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Cost data is confidential
The system SHALL NOT expose cost values, suppliers, markups or margin through `charges`, `pricingSummary`, the quote, line, order and calculate-price responses, broadcast events, action-log snapshots, custom-entity registrations or search to users without `cpq.costs.view`; such users see only cost status (pending / estimated / expired).

### Scenario: Leak sweep
- WHEN a user without `cpq.costs.view` reads every quote, order, line and calculate-price route, the action log and the broadcast events of a quote whose tail cost is 7777.77
- THEN no payload contains the value 7777.77, or a key named `markup*`, `cost*Amount` or `margin*`

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/costConfidentiality.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md

## Requirement: Costs follow quote copies and line removal
The system SHALL copy cost lines and markup overrides when a quote is cloned (new ids, remapped lines, an expired cost stays expired, catalog lines re-resolved on the clone's first recalculation). It SHALL soft-delete a line's cost lines and overrides when the line is removed, regardless of the toggle.

### Scenario: Clone
- WHEN a quote with a manual cost and a markup override is cloned
- THEN the clone prices identically and has its own cost line and override rows

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
