# Capability: cpq-arc

How operators amend, renew and cancel live CPQ subscriptions through quotes, and what happens to the prices of the items involved.

## Requirement: Amend mirror line pricing
The system SHALL keep an engine-priced mirror line on an Amend quote at the source subscription item's stored charges until a pricing input of that line changes, and SHALL then re-price it at the current standard price.

### Scenario: Untouched line
- WHEN an Amend quote adds a port and the existing port's catalog price rose from 100 to 120 since activation
- THEN the existing port's line keeps 100, and activation leaves its subscription item price at 100

### Scenario: Reconfigured line
- WHEN the rep changes the existing port's speed on the Amend quote
- THEN the line is re-priced at the current standard price and the banner is shown

### Scenario: Unchanged resubmission
- WHEN the UI saves the line with the same configuration and quantity
- THEN the line stays frozen

Source: .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md

## Requirement: Costs on ARC lines
The system SHALL let a pricing manager enter and confirm the cost values of non-frozen mirror lines (Renew mirrors re-priced at today's standard, reconfigured Amend mirrors), so their price-basis costs can be confirmed before conversion. It SHALL refuse manual costs and markup overrides on mirror lines, and every cost write on frozen Amend mirror lines and ARC cancel lines (`422 LINE_NOT_ELIGIBLE`). Removing an item on an Amend / Renew quote SHALL delete its line's cost lines, and ARC cancel lines SHALL never block conversion.

### Scenario: Renew mirror line with an estimated cost
- WHEN a Renew quote mirrors an item whose offering has an on-request tail cost (estimated 300)
- THEN a pricing manager can confirm it, and the quote converts once every price-basis cost is confirmed

### Scenario: Removed item
- WHEN the rep removes that item instead
- THEN its cost lines are deleted and conversion is not blocked by them

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`, `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
