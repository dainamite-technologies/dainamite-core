# Capability: cpq-quote-pricing

How quote charges are priced: list price from the engine, standard price after price rules, and the offer price after negotiated (manual) adjustments.

## Requirement: Manual price adjustment on a charge
The system SHALL let a user with `cpq.quotes.manage` and `cpq.quotes.adjust_price` set a price, an amount off, or a percentage discount on one charge of an eligible quote line, and SHALL price that charge at the adjusted value while recording list, standard and offer price. A set price SHALL be the new unit price on flat / per-unit charges and the new charge total on volume / tiered charges. Any value ≥ 0 SHALL be allowed, including above the standard price.

### Scenario: Override a setup fee
- WHEN a rep sets `price_override` 80 with reason `competitive_match` on charge `setup_fee` whose standard price is 100
- THEN the charge's offer `unitPrice` is 80, `standardUnitPrice` 100, an `adjustments[]` entry with `origin: 'manual'` and `delta: -20` exists, and `pricingRevision` increases by 1

### Scenario: Override above standard
- WHEN a rep sets `price_override` 120 on a charge whose standard price is 100
- THEN the adjustment is stored, the offer `unitPrice` is 120 with `delta: +20`, discount depth is negative (shown `+20%`) and the UI shows an "Above standard" badge; `ABOVE_STANDARD` is no longer raised

### Scenario: Set charge total on a tiered charge
- WHEN a rep sets `price_override` 150 on a tiered charge of quantity 4
- THEN the charge's `totalPrice` is 150 and its `unitPrice` the average 37.5

### Scenario: ARC mirror line
- WHEN a rep adjusts a mirror line of an Amend or Renew quote
- THEN the API returns `422 LINE_NOT_ELIGIBLE`

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md, .ai/specs/2026-11-26-cpq-manual-pricing-flexibility.md

## Requirement: Percentage discount on a line
The system SHALL apply a line-level `discount_percent` to every charge of the line (optionally only `nrc` or `mrc`) and of its bundle child lines that has no more specific valid manual adjustment.

### Scenario: Line discount with a charge override
- WHEN a line has a 15% line discount and a charge-level override on `setup_fee`
- THEN `setup_fee` uses the override and every other charge is 15% below standard

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Line Set price and Amount off
The system SHALL accept a line-level `price_override` or `discount_absolute` only with `chargeTypeFilter` `mrc` (recurring) or `nrc` (one-time) (`CHARGE_TYPE_REQUIRED` otherwise), and SHALL spread the line's new total for that charge type (all line quantities; on a bundle parent, the parent and its components) over the charges it wins, in proportion to their standard totals. The cent remainder SHALL go to the largest charge; when every charge is at 0 the whole amount SHALL go to the first charge. A more specific adjustment (charge level, or a component's own line adjustment) SHALL keep its price, and a line Set price SHALL then be spread over the remaining charges so the total still equals the typed price (floored at 0 when the fixed charges already exceed it). Any value is allowed, also above standard.

### Scenario: Line Set price
- WHEN a line has recurring charges with standard totals 60, 30 and 10 and a rep sets the line's recurring price to 50
- THEN the charges are priced 30, 15 and 5 and the one-time charges are unchanged

### Scenario: Charge override inside a line Set price
- WHEN the same line also has a charge override of 10 on the first charge
- THEN the first charge is 10 and the other two share 40 (30 and 10), so the line's recurring total is 50

### Scenario: Bundle total
- WHEN a rep sets the recurring price of a bundle parent to 100
- THEN the parent's and components' recurring charges together total 100

Source: .ai/specs/2026-11-26-cpq-manual-pricing-flexibility.md

## Requirement: Price waterfall on every charge
The system SHALL expose on every resolved quote charge its list, standard and offer price and the ordered rule and manual adjustments between them; charges saved before this change SHALL derive list and standard prices when read.

### Scenario: Quote without adjustments
- WHEN a quote has no manual adjustments
- THEN offer equals standard and `unitPrice`, `totalPrice`, line and quote totals equal the values produced before this change

Source: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md

## Requirement: Invalid manual adjustments are surfaced, not applied
The system SHALL keep a manual adjustment whose target charge no longer resolves (or resolves ambiguously), whose type or value is not allowed for the charge, or whose currency differs from the quote, SHALL NOT apply it, SHALL fall back to the next valid adjustment or the standard price, and SHALL mark the line `incomplete` (and the quote `incomplete` when it is in an auto-managed status).

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

## Requirement: Price phases on recurring prices
The system SHALL accept a month range (`fromMonth` ≥ 1, `toMonth` ≥ `fromMonth` or null = to the end) on a manual adjustment of a recurring price (an MRC charge, or a line with `chargeTypeFilter: mrc`; `PHASE_RECURRING_ONLY` otherwise), SHALL refuse a range past the line's term (`PHASE_PAST_TERM`) and two adjustments on one target that share a month (`ADJUSTMENT_OVERLAP`), and SHALL price every month segment with the waterfall in force in it: list → the price rules in force that month = standard → the manual adjustment in force that month = offer. A phased charge SHALL carry `schedule` (contiguous segments from month 1, the last open, each with standard and offer price and source `rule` | `manual` | `list`); the charge's own price and the MRC totals SHALL be the regular price (last segment). The deal value SHALL sum each month of the term at its segment price, and the snapshot hash and `hasTimeBasedAdjustments` SHALL reflect the schedule so pricing signals fire.

### Scenario: Ramp
- WHEN a rep sets `price_override` 80 for months 1–12 and 90 for months 13–24 on an MRC charge listed at 100 on a 24-month line
- THEN the schedule is 1–12 = 80, 13–24 = 90, 25+ = 100 (regular), the charge's `totalPrice` is 100 and the deal value is 12×80 + 12×90

### Scenario: Rule phase and manual phase in the same month
- WHEN a price rule gives 50% off months 1–3 (standard 50) and a rep sets price 30 for month 1
- THEN month 1 is 30 (source manual, standard 50), months 2–3 are 50 (source rule), month 4+ is 100

### Scenario: ARC mirror line
- WHEN a rep adds a phase on a line that mirrors an existing subscription item
- THEN the adjustment is refused with `LINE_NOT_ELIGIBLE`, and re-priced mirror lines carry no schedule (D8)

Source: .ai/specs/2026-11-26-billing-price-phases-ramp-deals.md

## Requirement: Price rule phases and campaign dates
The system SHALL accept on a price rule an optional month range (`fromMonth` / `toMonth`, recurring charges only, `PHASE_RECURRING_ONLY` for an `nrc` / `usage` filter) and optional campaign dates (`validFrom` / `validUntil`, inclusive). A rule SHALL apply only in its months, and only when the quote is priced inside its campaign dates; a quote line already priced with the rule (its stored snapshot names the rule) SHALL keep it when re-priced after the campaign ended.

### Scenario: Quote priced before the campaign ended, re-saved after
- WHEN a line was priced on 20 Dec with a rule valid until 31 Dec and the quote is re-saved on 1 Feb
- THEN the line keeps the rule's phase; a line added on 1 Feb does not get it

Source: .ai/specs/2026-11-26-billing-price-phases-ramp-deals.md

## Requirement: Phases on the activation and added-item payloads
The system SHALL keep the schedule on the order line and subscription item and SHALL send it on the recurring charge of the activation event and of ARC `addedItems` (contract C2): per billing period, the item's MRC charges merged into one schedule (union of boundaries, prices summed, quantity applied), each phase `{ name, months, priceType: 'fixed', value }` with `value` per that billing period, and `unitPrice` the regular price after the last phase.

### Scenario: Two charges merged
- WHEN an item has Internet 100 (free month 1) and TV 50 (25 for months 1–3)
- THEN the recurring charge has `unitPrice` 150 and `phases` [{ months 1, value 25 }, { months 2, value 125 }]

Source: .ai/specs/2026-11-26-billing-price-phases-ramp-deals.md

## Requirement: One target's price in one write
The system SHALL treat the manual adjustments of a quote line as one set per **target** (whole line · recurring / one-time / all charges, or one charge) and SHALL replace every row of a target in one undoable write (`PUT /api/cpq/quotes/{quoteId}/price-adjustments/target`, command `cpq.quote_price_adjustment.replace_target`): `phases[]` back to back from month 1 (at most 12, `regular` = a gap with no row, recurring targets only), then `then` (the price from the month after them to the end; without phases, the One price `[1, null]`). Every row SHALL pass the per-row POST rules. Rows that do not change SHALL keep their id, author and `created_at`; a row over the same months SHALL be updated in place (its author becomes the actor); the rest SHALL be created or soft-deleted. The write SHALL take the quote lock, check `expectedRevision`, reprice once and emit the pricing signals once. Overlap with another target SHALL be refused on save (`422 ADJUSTMENT_OVERLAP` with the other row's `adjustmentId`) and reported, not thrown, by the preview (`POST …/target/preview`, no write, no event). Undo SHALL answer 409 when a row the save wrote changed since, and SHALL overlap-check the restored rows. No schema change: a target's steps are read back from its rows (`stepsFromRows`), gaps as Regular price steps.

### Scenario: Free trial then 50 % off, saved in one go
- WHEN a rep saves `phases: [{ months 1, price_override 0, "Free trial" }, { months 3, discount_percent 50, "50% off" }]`, `then: null` on the line's recurring target
- THEN two rows `[1,1]` and `[2,4]` exist, the quote's `pricingRevision` rises by 1, and one undo removes both

### Scenario: All charges against recurring phases
- WHEN the line's recurring target has phases and a rep previews `chargeTypeFilter: null`, 10 % off
- THEN the preview's `errors` hold `ADJUSTMENT_OVERLAP` with `conflictsWith` a phase row, and the PUT answers 422

### Scenario: Re-save keeps the author
- WHEN a rep re-saves a set with one changed step
- THEN the unchanged steps keep their id, `createdByUserId` and dates; the changed step keeps its id and shows the rep as author

Source: .ai/specs/2026-11-27-cpq-billing-phases-ux-feedback.md

## Requirement: Adjustment authors and the order's adjustments
The system SHALL return `createdByName` and `createdByEmail` on every item of `GET /api/cpq/quotes/{quoteId}/price-adjustments`, from one batched, tenant-scoped read of `auth` users by id (no ORM relation), and SHALL return the source quote's active adjustments, with the same author fields and `reasonLabel`, as `order.priceAdjustments` on `GET /api/cpq/orders/{orderId}` (guarded by `cpq.orders.view` only; empty without a source quote). The AI tool `cpq.list_price_adjustments` SHALL read the list; price-adjustment writes SHALL stay out of the AI tools.

### Scenario: Unknown author
- WHEN an adjustment's author no longer resolves in the tenant
- THEN `createdByName` and `createdByEmail` are null and the UI shows the short user id (full id in the tooltip)

Source: .ai/specs/2026-11-27-cpq-billing-phases-ux-feedback.md
