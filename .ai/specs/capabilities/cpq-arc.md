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
