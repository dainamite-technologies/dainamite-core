# Capability: cpq-quote-pricing

How quote charges are priced: list price from the engine, standard price after price rules, and the offer price after negotiated (manual) adjustments.

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
The system SHALL expose on every resolved quote charge its list, standard and offer price and the ordered rule and manual adjustments between them; charges saved before this change SHALL derive list and standard prices when read.

### Scenario: Quote without adjustments
- WHEN a quote has no manual adjustments
- THEN offer equals standard and `unitPrice`, `totalPrice`, line and quote totals equal the values produced before this change

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

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
