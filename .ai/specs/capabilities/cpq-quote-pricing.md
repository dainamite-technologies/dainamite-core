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
The system SHALL keep exactly one non-deleted catalog cost line per applicable active cost element, matched by cost key, on every configured quote line that is not one of these:
- an unreconfigured Amend mirror;
- a frozen mirror (`isFrozenMirrorLine`);
- a cost-managed standalone Renew mirror.

A reconfigured mirror line SHALL instantiate catalog lines, keeping a carried value whose `cost_key` matches unless the reconfiguration resets it (R1b). A cost-managed standalone Renew mirror SHALL be reconciled instead (see the capability `cpq-arc`, "Renew reconciles costs with today's catalog"). A line that becomes an ARC cancel line (an item removed on Amend / Renew) SHALL lose its cost lines (catalog and manual) and markup overrides at once, regardless of the toggle or the cost lock. On every saved recalculation the system SHALL resolve `fixed` and `table` values (a `table` or `fixed` value is `confirmed`, an `on_request` catalog estimate is `estimated`, otherwise `none`) and soft-delete cost lines whose element no longer applies, cancelling any open cost request on them (`element_deactivated` when the element is inactive, otherwise `reconfigured`). A value a pricing manager entered or confirmed (`value_origin = manual`), a supplier answered (`value_origin = supplier`) or the subscription carried (`value_origin = carried`) SHALL survive recalculation until a driving attribute changes. A reconfiguration that changes an attribute driving an `on_request` line SHALL reset its value to the catalog estimate (or `none`), keep the previous value in `note`, cancel any open request (`reconfigured`) and, for `requires_sourcing` elements, open a new one.

### Scenario: Add a costed product
- WHEN a rep adds a product whose `tail_mrc` charge has a `table` element and an `on_request` element with estimate 300
- THEN the line has two cost lines: one `confirmed` with the table value (origin `catalog`), and one `estimated` at 300

### Scenario: Reconfigure a driving attribute
- WHEN the line's `bandwidth` (a dimension of the tail element) changes from 1G to 10G
- THEN the `on_request` cost line goes back to its catalog estimate (or `none`), its previous value is kept in `note`, and an open request is `cancelled (reconfigured)` with exactly one `cost_request_cancelled` event (a new one opens when the element has `requires_sourcing`)

### Scenario: Unreconfigured Amend mirror
- WHEN an Amend quote mirrors a subscription item and nothing on the line changes
- THEN no catalog cost lines are created on the mirror line and no request opens

### Scenario: Frozen mirror
- WHEN a merge-Renew quote mirrors a cost-plus item (a frozen mirror) and nothing on the line changes
- THEN no catalog cost lines are created on the mirror line

### Scenario: Reconfigured Amend or Renew mirror
- WHEN the rep changes the bandwidth on an Amend or Renew mirror line whose charge has a `table` cost element
- THEN the line gets one `catalog` cost line per applicable element (App Spec R1a), and a cost-plus charge on it is priced from them

### Scenario: Reconfigured Amend mirror with a carried tail
- WHEN the rep changes the port speed (not a tail dimension) on an Amend line carrying a 240 tail
- THEN the `tail` line keeps 240, and any other applicable element is instantiated

### Scenario: Removed ARC item
- WHEN a rep removes a mirrored item with an estimated tail cost on a Renew quote
- THEN the line becomes a cancel line and its cost lines are soft-deleted

### Scenario: Table without a matching entry
- WHEN a table element's dimensions match no entry of the cost table, or the matching entry has no value in the element's cost column
- THEN the cost line is `none` with `TABLE_NO_MATCH` (never a confirmed 0) and the line is not ready

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costResolution.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

## Requirement: Cost-plus list price
The system SHALL price a cost-plus charge at list total = markup(Σ known price-basis costs per instance, each converted to the quote currency at its stored or freshly resolved `fx_rate`), where `markup_percent` m gives C × (1 + m/100), `target_margin_percent` gives C ÷ (1 − m/100) and `markup_absolute` gives C + a, rounded once to the currency precision (per-unit: unit = total ÷ quantity at 4 dp). Price rules and manual adjustments SHALL then apply unchanged; percent price rules on a cost-plus charge SHALL scale the exact per-instance total, so no unit × quantity drift appears. An absolute markup is in the charge currency (a markup override's in the quote currency). A charge with an unknown price-basis cost (`COST_PENDING`), with no applicable one (`NO_PRICE_BASIS_COST`), with an invalid markup (`MARKUP_INVALID`) or with an absolute markup in a currency other than the quote's (`CURRENCY_NO_RATE`, never a 1:1 add) SHALL have no price, and its line SHALL NOT be ready. A cost in a currency other than the quote currency SHALL be converted only with a rate from the `currencies` module; when none is available the cost SHALL be `none` + `CURRENCY_NO_RATE` (its entered amount and currency kept) and SHALL never be converted 1:1. `estimated` costs price the charge and make the quote indicative.

### Scenario: Markup percent
- WHEN price-basis costs are 300 and 100 per instance and the markup is `markup_percent` 25
- THEN `listTotalPrice` is 500.00, and with a 10% manual line discount the offer is 450.00

### Scenario: Unknown cost
- WHEN one price-basis cost line has `value_status = none`
- THEN the charge has no price, the line error is `COST_PENDING`, and a `ready` quote becomes `incomplete`

### Scenario: Foreign-currency cost converts at a dated rate
- WHEN a price-basis cost is 300 USD on a EUR quote, the markup is `markup_percent` 25, and `currencies` holds a USD→EUR rate of 0.92 dated 2026-11-11 (the saved recalculation runs on 2026-11-12)
- THEN the cost line keeps `unit_amount` 300 / `currency_code` USD, stores `fx_rate` 0.92000000, `fx_rate_date` 2026-11-11, its `fx_rate_source` and `fx_rate_derivation = direct`, and `listTotalPrice` is 345.00

### Scenario: No rate in the look-back window
- WHEN a price-basis cost is in USD on a EUR quote and no USD→EUR or EUR→USD rate exists within `cpq.cost_plus.fx_max_days_back` days
- THEN the cost line is `none` with `CURRENCY_NO_RATE`, its entered amount and currency are kept, and the line is not ready

### Scenario: Absolute markup in another currency
- WHEN a charge with `markup_absolute` 50 EUR is quoted in USD
- THEN the charge has no price and the line error is `CURRENCY_NO_RATE`

### Scenario: Percent rule on a per-unit cost-plus charge
- WHEN a `per_unit` cost-plus charge of 3 units at 100.00 each has a 10% price rule
- THEN its total is 270.00, not 269.99997

### Scenario: Quote without costs
- WHEN a quote has no cost-plus charges and no cost lines
- THEN `charges`, `pricingSummary` and `snapshotHash` are byte-identical to the values produced before this change

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/costPlusGolden.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/costPlusPrice.test.ts`, `costResolution.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Manual costs, cost confirmation and markup override
The system SHALL let a user with `cpq.quotes.manage` and `cpq.costs.manage`:
- add, edit and delete `manual` cost lines (cost key `manual:<8 hex>`; price-basis only on a cost-plus charge, otherwise margin-only; catalog lines cannot be deleted, `CATALOG_COST_NOT_DELETABLE`);
- enter or confirm the value of any cost line, including those of non-frozen ARC mirror lines and `carried` lines (overwriting a catalog or `carried` value needs a note, extending a validity or supplier term needs a new supplier quote reference or a note);
- keep a renegotiation-due carried cost unchanged (`keepCurrent`) with new validity and evidence;
- override or clear a cost-plus charge's markup on one quote line (note required; unknown charge `CHARGE_NOT_FOUND`);

manual costs and markup overrides are refused on every ARC mirror line, and every cost write on ARC cancel lines and on frozen Amend mirror lines other than to a `carried` cost (`422 LINE_NOT_ELIGIBLE`); all subject to the cost lock: price-basis cost lines and markup overrides can only change while the quote is `new`, `incomplete` or `ready` and no order exists (`409 COST_LOCKED` otherwise; terminal quotes refuse every cost write). A cost change on a frozen Amend mirror line counts as margin-only. With the toggle on, a cost-locked quote SHALL also refuse adding a line whose offering / product has an active cost-plus charge, and changing such a line's configuration or quantity (`409 COST_LOCKED`; term and dates stay editable). Margin-only changes, confirming an unchanged value and extending validity or supplier term are always allowed in non-terminal statuses. Cost writes accept `expectedRevision` (`409 STALE_REVISION`), bump `pricingRevision`, are commands that are not undoable, and write snapshots without amounts. Entering a value (amount or value status) on a cost line with an open request SHALL cancel that request (`manual_value`) and clear any pending proposal in the same write; a note or supplier-data edit that changes neither SHALL NOT. After a decline the alternative supplier's value is entered on the same cost line (R10a).

### Scenario: Enter a tail cost by hand
- WHEN a pricing manager sets the `on_request` tail cost line to 280 EUR, `confirmed`, with a supplier quote ref
- THEN the line prices from 280, and the cost line has `value_origin = manual`

### Scenario: Manual value while a request is open
- WHEN a pricing manager enters 290 EUR on a tail whose request seq 2 is open
- THEN seq 2 is `cancelled (manual_value)`, and a later answer to seq 2 returns `409 COST_REQUEST_SUPERSEDED`

### Scenario: Margin-only custom cost after submission
- WHEN a pricing manager adds a `margin_only` NRC cost of 1500 to a line of a quote in `in_approval`
- THEN the cost line is created, the price is unchanged, and `margin_changed` is emitted with `approvalInvalidated: true`

### Scenario: Price-basis change while locked
- WHEN a pricing manager changes a price-basis cost value, or a markup, on a quote in `with_customer`
- THEN the API returns `409 COST_LOCKED` and nothing changes

### Scenario: Reconfiguring a cost-plus line while locked
- WHEN a rep changes the port count of a per-unit cost-plus line on a quote in `with_customer`
- THEN the API returns `409 COST_LOCKED` and the line keeps its configuration and price

### Scenario: Carried cost on a frozen line while locked
- WHEN the same change is made to a carried price-basis cost on a frozen Amend mirror line
- THEN it is stored, the price is unchanged and `margin_changed` is emitted

### Scenario: Overwrite a carried value
- WHEN a pricing manager sets a carried tail from 270 to 240 without a note
- THEN the API returns `422 NOTE_REQUIRED`

### Scenario: Confirm a Renew mirror cost
- WHEN a pricing manager confirms the estimated tail cost of a Renew mirror line
- THEN the write is accepted, and once every price-basis cost is confirmed the quote converts

### Scenario: Manual per-unit cost follows the quantity
- WHEN the charge quantity of a line with a manual `per_unit` cost changes in a saved recalculation
- THEN the cost line's per-instance amount is refreshed from the new quantity; value, status, origin and note stay

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md

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
The system SHALL copy cost lines and markup overrides when a quote is cloned (new ids, remapped lines, an expired cost stays expired, catalog lines re-resolved on the clone's first recalculation, supplier answers kept with their validity; open requests and proposals are **not** copied: `sourcing_status = not_requested`, empty request id and history, and the clone's first saved recalculation opens none). It SHALL soft-delete a line's cost lines and overrides when the line is removed, regardless of the toggle, cancelling their open requests (`line_removed`) in the same write.

### Scenario: Clone
- WHEN a quote with a manual cost, a markup override and an open tail request is cloned
- THEN the clone prices identically, has its own cost line and override rows, and its tail cost line is `not_requested`

### Scenario: Line removal
- WHEN a line with an open tail request is removed
- THEN the cost line is soft-deleted and the request is `cancelled (line_removed)` in the same commit

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Source: .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md

## Requirement: Exchange-rate snapshot follows the cost lock
The system SHALL take a foreign-currency cost line's rate as of the current UTC date at a saved recalculation or cost write while the quote is mutable (`new` / `incomplete` / `ready`, no order), and store it with its actual date, source and derivation (`direct` or `inverse`). The rate is the direct pair's when any source has one (the first source of `cpq.cost_plus.fx_source_priority` that has a rate, else the only rate, else the lowest source name), and only otherwise `1 / rate` of the inverse pair at 8 decimals. While the cost lock applies, or once an order exists, the system SHALL reuse the stored snapshot. Lines carried from a subscription item and every ARC mirror line SHALL keep their carried snapshot in every context. Unsaved recalculations and previews SHALL compute in memory and store nothing. A new or re-valued foreign-currency cost written while the quote is locked (a margin-only cost) SHALL take the rate of the write day without moving the price, while a same-value confirmation keeps the stored snapshot. A foreign-currency value that had no rate SHALL become `estimated` (catalog `fixed` / `table` lines `confirmed`) when a rate arrives. `margin_hash` SHALL include the FX fields only when a rate is set, so a quote with no FX snapshot keeps a byte-identical hash.

### Scenario: Refresh while unlocked
- WHEN a `ready` quote with a 300 USD tail at 0.92 (2026-11-11) is recalculated and saved on 2026-11-13, and the newest rate is 0.93 (2026-11-13)
- THEN `fx_rate` becomes 0.93, the price moves, `pricing_changed` and `margin_changed` are emitted

### Scenario: Frozen while locked
- WHEN the same quote is `with_customer` and a newer rate exists
- THEN a saved recalculation leaves `fx_rate`, `fx_rate_date`, `charges` and `margin_hash` unchanged

### Scenario: Preview stores nothing
- WHEN a user runs an unsaved recalculation or the cost preview
- THEN the response uses today's rate and no cost line row changes

### Scenario: Carried mirror line keeps its rate
- WHEN an unlocked Amend or Renew quote has a mirror line whose carried USD cost holds `fx_rate` 0.90, and today's rate is 0.93
- THEN a saved recalculation leaves the line's `fx_rate`, `fx_rate_date`, `fx_rate_source` and `fx_rate_derivation` unchanged

### Scenario: Null-stable margin hash
- WHEN a quote whose cost lines are all in the quote currency is recalculated after this change ships
- THEN its `margin_hash` is byte-identical to the value before this change, and no `margin_changed` is emitted

### Scenario: Rate arrives after entry
- WHEN a manual 300 USD cost was entered while no rate existed (stored `none` + `CURRENCY_NO_RATE`) and a rate is maintained afterwards
- THEN the next saved recalculation of the unlocked quote resolves it and the line becomes `estimated` with the note "Rate applied after entry.", for a pricing manager to confirm

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costResolution.test.ts`, `quoteMargin.test.ts`, `fxRateResolver.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Cost table currency precedence
The system SHALL look up a `table` cost element in entries of the quote currency first. Only when no matching entry exists there SHALL it use entries in the element's `currency_code` (the fallback table currency) and convert them; with neither, the line SHALL be `none` + `CURRENCY_NO_RATE`.

### Scenario: USD-only cost table on a EUR quote
- WHEN the cross-connect cost table holds only USD entries, the element's `currency_code` is USD, and a USD→EUR rate exists
- THEN the cost line holds the USD entry value with `currency_code` USD and the stored rate

### Scenario: Quote-currency entry wins
- WHEN the table holds both a EUR and a USD entry for the same dimensions
- THEN the EUR entry is used and no FX columns are set

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costResolution.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Foreign-currency costs without the currencies module
The system SHALL treat every non-quote-currency cost as `none` + `CURRENCY_NO_RATE` when the `currencies` module is not installed (the rate resolver reports itself unavailable and is never called), and SHALL start without errors. CPQ SHALL NOT import from `currencies`; the exchange-rate service is resolved by its DI name only when registered.

### Scenario: Standalone CPQ
- WHEN CPQ runs in an app without `@open-mercato/core` `currencies` registered and a USD cost is added to a EUR quote
- THEN the cost line is `none` + `CURRENCY_NO_RATE` and no error is logged at startup

Frozen by: `packages/cpq/src/modules/cpq/__tests__/di.test.ts`, `services/costs/__tests__/fxRateResolver.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Missing exchange-rate pairs are reported
The system SHALL report in `GET /api/cpq/cost-plus/usage`, as `missingFxPairs`, every (cost currency, quote currency) pair on which a cost line of an open, unconverted quote is `CURRENCY_NO_RATE`, together with the number of affected quotes, most affected first. Converted and terminal quotes SHALL NOT count.

### Scenario: Operator checks missing rates
- WHEN two open EUR quotes have USD cost lines without a rate
- THEN the usage response contains `missingFxPairs: [{ from: 'USD', to: 'EUR', openQuotes: 2 }]`

Frozen by: `packages/cpq/src/modules/cpq/api/__tests__/quoteCostReadRoutes.test.ts`, `services/costs/__tests__/quoteCostService.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md

## Requirement: Index cost resolution and snapshot
The system SHALL resolve an `index` cost line, on a saved recalculation while the quote's cost lock does not apply and its `value_origin` is `catalog`, to `unit_amount = value in force on the recalculation date × factor + offset` in the index currency. It SHALL store `index_snapshot {indexId, currencyCode, effectiveDate, revision, value, factor, offset, asOfDate}`. It SHALL leave the stored value and snapshot unchanged on unsaved recalculations, on locked quotes and once an order exists. When no value is in force it SHALL set `value_status = none` with `INDEX_NO_VALUE`, and a price-basis line SHALL then not be ready. The snapshot, factor, offset and value are cost data, visible only with `cpq.costs.view`.

### Scenario: New value on an unlocked quote
- WHEN Brent 82.40 (2026-11-10) is added and a `ready` quote using Brent is saved on 2026-11-12
- THEN its index cost line snapshots 82.40 / 2026-11-10 / its revision, the cost-plus list price is recomputed, and `pricing_changed` and `margin_changed` are emitted

### Scenario: Sent quote is frozen
- WHEN the same value is added while another quote is `with_customer`
- THEN that quote's `index_snapshot`, cost values and `charges` stay byte-identical on any recalculation

### Scenario: No value on or before the date
- WHEN a quote line uses an index whose first value is dated after today
- THEN the cost line is `none` with `INDEX_NO_VALUE`, the cost-plus charge has error `COST_PENDING`, and the line is not ready

### Scenario: Preview does not store
- WHEN the quote is recalculated with `save: false`
- THEN the response prices from the value in force, and the stored snapshot is unchanged

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/indexCostResolution.test.ts`, `packages/cpq/src/modules/cpq/services/costs/__tests__/costResolution.test.ts`, `packages/cpq/src/modules/cpq/api/__tests__/quoteCostReadRoutes.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/costConfidentiality.test.ts`, `packages/cpq/src/modules/cpq/__integration__/TC-CPQ-COST-INDEX-002.spec.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md
