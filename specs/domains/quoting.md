# Quoting Domain

## Objective

Produce a structurally correct quote — with product offerings selected by the customer, configurations validated by business rules, and prices correctly calculated by the pricing engine.

---

## Key Entities

### Customer
- Customer record from the existing customers module.
- The quoting journey begins with customer selection.
- Customer context (existing inventory, segment, location) feeds into rules and eligibility.

### Deal
- Sales opportunity record from the existing sales module.
- A quote may optionally be linked to a deal for pipeline tracking.

### Quote (SalesQuote + CpqQuoteConfiguration)
- Uses the **standard** `SalesQuote` entity for the document structure.
- CPQ-specific data stored in a companion `CpqQuoteConfiguration` entity:

| Property | Description |
|----------|-------------|
| `quoteType` | `new_primary`, `add_child`, `new_primary_with_children` |
| `selectedParentInventoryItemId` | For add_child: existing parent from inventory |
| `primaryItemConfiguration` | Attribute values for the primary item |
| `childItemConfigurations` | Array of child item configs |
| `validationResult` | Last validation run result |
| `ruleViolations` | Business rule evaluation results |
| `pricingSummary` | Calculated pricing breakdown grouped by charge type |

### Quote Item (SalesQuoteLine)
- Individual line item on the quote.
- In CPQ: **each charge produces its own quote line** (NRC line, MRC line, usage line) so charges are independently visible on the quote document.
- The `configuration` JSONB on each line stores the CPQ charge breakdown.

| Line Kind | Description |
|-----------|-------------|
| `charge_nrc` | One-time charge line |
| `charge_mrc` | Recurring charge line |
| `charge_usage` | Usage/informational charge line |

---

## Requirements

### R-QUOTE-1: Standard Entity Integration
Quotes must use the standard `SalesQuote` / `SalesQuoteLine` entities. CPQ extends via companion entities and JSONB fields, not by replacing sales objects.

### R-QUOTE-2: One Line Per Charge
Each resolved charge must produce a separate quote line. This ensures NRC, MRC, and usage charges are independently visible without UI modifications to the standard quote view.

### R-QUOTE-3: Full Validation Before Persist
Before a quote is persisted, all product configurations must pass attribute validation, business rule evaluation, and pricing resolution. Invalid quotes must not be saved.

### R-QUOTE-4: Quote-Level Aggregation
The quote must aggregate totals by charge type:
- **NRC Total**: Sum of all one-time charges across all items
- **MRC Total**: Sum of all recurring charges
- **Usage Charges**: Listed with per-unit rates (informational)

### R-QUOTE-5: Price Preview (No Persist)
The system must support real-time price calculation without persisting — used for live preview during the quoting wizard as the user configures items.

### R-QUOTE-6: Quote Cloning
Quotes must be clonable for revision workflows (duplicate a quote, modify, re-price).

### R-QUOTE-7: Quote-to-Order Conversion
When a quote is converted to an order, the system must trigger downstream processes (inventory provisioning) via events, not direct coupling.

---

## Service API

| Operation | Description |
|-----------|-------------|
| `createQuote(customerId, dealId?)` | Initialize a new CPQ quote |
| `addQuoteItem(quoteId, productOfferingId, configuration)` | Add a configured product to the quote. Validates, prices, creates lines |
| `updateQuoteItem(quoteId, itemId, configuration)` | Update an existing item's configuration. Re-validates, re-prices |
| `removeQuoteItem(quoteId, itemId)` | Remove an item and its charge lines from the quote |
| `cloneQuote(quoteId)` | Duplicate a quote for revision |
| `calculatePreview(items[])` | Price calculation without persistence — for live wizard preview |
