# Pricing Engine Domain

## Objective

Calculate the price of a configured product offering at quoting runtime. The pricing engine is a **lookup + calculation** service — it does not own product structure, only resolves prices from pricing tables and applies charge models.

---

## Key Entities

### Pricing Table (CpqPricingTable)
- 2-dimensional (or multi-dimensional) matrices that store attribute values and prices.
- Pricing tables are linked to **charges** — a charge defines its price data source and calculation logic.
- A table defines **dimensions** (lookup axes) and **price columns** (output values).

| Property | Description |
|----------|-------------|
| `dimensions` | Array of dimension definitions: key, label, type (`attribute` or `tier`) |
| `priceColumns` | Array of price column definitions: key, label, chargeType |
| `currencyCode` | Currency for all prices in this table |
| `effectiveFrom/To` | Date range for versioned pricing |

- One pricing table can serve multiple charges (via different `priceColumnKey` references).
- A single table can hold NRC, MRC, and usage prices in separate columns — avoiding dimension duplication.

### Pricing Table Entry (CpqPricingTableEntry)
- Individual rows in a pricing table.
- Each entry holds dimension values for matching and a map of named prices.

| Property | Description |
|----------|-------------|
| `dimensionValues` | Key-value pairs matching dimensions (e.g. `{ "data_centre": "equinix-ld5", "port_size": "10G" }`) |
| `tierNumber` | For tiered pricing: tier ordinal |
| `rangeFrom / rangeTo` | For tiered: quantity range bounds (null rangeTo = infinity) |
| `prices` | Map of `{ priceColumnKey: amount }` (e.g. `{ "nrc": 490, "mrc": 450 }`) |

### Price Rule (CpqPricingRule)
- Structured rules that have access to elements of the quote context (customer info, quote info, configuration details).
- Applied **after** standard pricing table lookup to modify, discount, or override prices.
- Implemented as code (TypeScript classes) registered in DI.

### Promotion
- Either time-based (automatic) or promo code-based (user-entered) discount mechanism.
- Applied as a pricing rule variant or standalone entity (future scope).

---

## Requirements

### R-PRICE-1: Multi-Dimensional Lookup
The engine must resolve prices by matching product configuration values against pricing table dimensions. Support arbitrary number of dimensions.

### R-PRICE-2: Named Price Columns
A single pricing table must support multiple price columns (e.g. NRC + MRC in one table). Each charge references a specific column key.

### R-PRICE-3: Charge Model Algorithms
Support four charge models:
- **Flat**: `price = entry.prices[columnKey]`
- **Per Unit**: `price = entry.prices[columnKey] x quantity`
- **Tiered**: quantity split across tier ranges, each tier priced at its own rate, total = sum of all tier amounts
- **Volume**: total quantity determines the tier, all units priced at that tier's rate

### R-PRICE-4: Usage Charges (Informational)
Usage-based charges (e.g. overage) cannot be calculated at quote time. The engine must return the unit rate and a descriptive note. Quote displays this as informational with `quantity: null`.

### R-PRICE-5: Post-Calculation Rules
After standard lookup, pricing rules must be evaluated. Rules can apply discounts (% or absolute), surcharges, or full price overrides. All adjustments must be auditable.

### R-PRICE-6: Versioned Pricing
Pricing tables must support `effectiveFrom/To` date ranges. The engine resolves against the table version effective at quote creation time.

### R-PRICE-7: Currency Awareness
All prices carry a currency code. No implicit currency conversion. Multi-currency support via separate pricing tables or price columns per currency.

---

## Service API

| Operation | Description |
|-----------|-------------|
| `calculatePrice(productOfferingId, configuration)` | Resolve all charges for a product configuration. Returns per-charge breakdown |
| `applyPromotion(promoId or promoCode)` | Apply a promotion to a quote/configuration |
| `applyPriceRules(quoteContext)` | Evaluate pricing rules against resolved charges. Returns modified charges with adjustment audit trail |
