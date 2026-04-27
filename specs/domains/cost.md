# Cost Domain

## Objective

Maintain product cost definitions, coordinate on-demand cost calculation/retrieval, and provide a way to calculate quote-level margin. Costs are the **internal price** of delivering a product — separate from the selling price managed by the Pricing Engine.

---

## Key Entities

### Cost Definition
- Defines a set of cost components for a particular product.
- One cost definition might be related to many products.
- Cost components might be included **conditionally** based on product configuration (similar to charge applicability conditions).

| Property | Description |
|----------|-------------|
| `productId` | FK to catalog product (nullable — can be shared/global) |
| `code` | Unique identifier |
| `name` | Display label |
| `costComponents` | Array of cost component definitions |
| `applicabilityCondition` | When this cost definition applies (nullable = always) |

### Cost Table
- A 2-dimensional structure (similar to a pricing table) used to define cost values.
- Dimensions map to product attributes, values are cost amounts.
- Reuses the same dimensional lookup pattern as pricing tables.

| Property | Description |
|----------|-------------|
| `dimensions` | Lookup axes (same structure as pricing table dimensions) |
| `costColumns` | Output cost values (e.g. `{ key: "cogs", label: "Cost of Goods" }`) |
| `currencyCode` | Currency for cost values |

### Cost Item
- A **runtime instance** of a cost definition, created under a quote item.
- Represents the calculated cost for a specific configured product on a specific quote.
- Enables margin calculation: `margin = sellingPrice - costPrice`.

| Property | Description |
|----------|-------------|
| `quoteItemId` | FK to quote line |
| `costDefinitionId` | FK to cost definition |
| `costBreakdown` | JSONB with per-component cost amounts |
| `totalCost` | Aggregated cost for this item |
| `currencyCode` | Currency |

---

## Requirements

### R-COST-1: Separate from Pricing
Cost data must be completely separate from pricing data. Costs represent internal delivery costs; prices represent what the customer pays. Different access controls apply.

### R-COST-2: Conditional Cost Components
Cost definitions must support applicability conditions — some cost components only apply under certain product configurations (e.g. cross-connect cost only when a specific data centre is selected).

### R-COST-3: On-Demand Calculation
Cost items are created on demand — typically when a quote is finalized or when margin analysis is requested. Not calculated during live wizard preview.

### R-COST-4: Margin Calculation
The system must calculate margin at quote-item level and quote-aggregate level:
- Per-item margin: `(sellingPrice - costPrice) / sellingPrice`
- Quote margin: aggregate across all items, grouped by charge type

### R-COST-5: Cost Table Reuse
Cost tables must follow the same dimensional lookup pattern as pricing tables to avoid duplication of infrastructure.

---

## Service API

| Operation | Description |
|-----------|-------------|
| `createCostItems(quoteId)` | Calculate and persist cost items for all items on a quote |
| `getQuoteMargin(quoteId)` | Return margin analysis: per-item and aggregate, by charge type |
