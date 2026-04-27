# Product Domain

## Objective

Define the product specification and its configuration dimensions. A product in CPQ terms is a **sellable item** with typed attributes, commercial charges, and business rules — all expressed as data.

---

## Key Entities

### Product Group
- Hierarchical grouping for structural organization of the product catalog.
- Used for navigation, filtering, and applying group-level rules or pricing.

### Product Specification (CpqProductConfig)
- A unified definition of what can be sold.
- Contains both **design-time** properties (structure, relationships, rule bindings) and **run-time** properties (attribute values filled during quoting).
- Extends the standard catalog `Product` — does not replace it.

| Property | Description |
|----------|-------------|
| `productType` | `standalone`, `parent`, `child`, `bundle` |
| `allowedParentProducts` | Which products this can attach to (if child) |
| `allowedChildProducts` | Which products can attach to this (if parent) |
| `rules` | References to business rule classes that apply to this product |
| `maxQuantity` | Max instances per quote/order (null = unlimited) |

### Product Offering
- Represents a unique sellable item with its commercial definition.
- A product offering might be a **bundled offering** that contains multiple products underneath.
- One product specification can have multiple offerings (e.g. different tiers, editions).

### Attribute (CpqProductAttribute)
- A configurable aspect of a product — either design-time (admin-defined) or run-time (user-selected during quoting).
- Attributes might have static values (enum options) or dynamic values derived from other entities, pricing tables, or rules.

| Type | Value | Use Case |
|------|-------|----------|
| `text` | string | Free-form input (e.g. circuit reference) |
| `number` | number | Quantities, bandwidth, capacity |
| `boolean` | boolean | Feature toggles |
| `select` | string | Single choice from options (e.g. port size) |
| `multi-select` | string[] | Multiple choices |
| `reference` | UUID | Reference to another entity (e.g. data centre, region) |

**Attribute dependencies**: An attribute can depend on another attribute's value for option filtering (e.g. cloud region depends on cloud provider). Expressed via constraints and configuration rules.

**Attribute groups**: Attributes can be grouped for UI organization (e.g. "Connection Details", "Billing Options").

### Charge (CpqProductCharge)
- A commercial element of a product offering.
- One product can have **multiple charges** of different types.

| Charge Type | Code | Description |
|------------|------|-------------|
| Non-Recurring | `nrc` | One-time charge (setup, activation) |
| Monthly Recurring | `mrc` | Periodic charge with billing cycle |
| Usage | `usage` | Metered/consumption-based charge |

| Charge Model | Code | Description |
|-------------|------|-------------|
| Flat | `flat` | Fixed price regardless of quantity |
| Per Unit | `per_unit` | Unit price x quantity |
| Tiered | `tiered` | Different rate per tier bracket (each tier priced separately) |
| Volume | `volume` | Single rate determined by total quantity tier, applied to all units |

- Each charge references a **pricing table** and **price column** for price resolution.
- Charges can have **applicability conditions** — expressions over attribute values that determine if the charge applies to a given configuration.
- Charges can have a `fixedPrice` for simple cases not requiring a pricing table.

---

## Requirements

### R-PROD-1: Product-Agnostic Structure
Product definitions must be fully data-driven. No product-specific logic in code. All domain knowledge expressed through attributes, charges, rules, and pricing tables.

### R-PROD-2: Multi-Charge Model
A single product must support multiple independent charges (NRC + MRC + usage). Each charge resolves its price independently.

### R-PROD-3: Typed Attributes
Attributes must have explicit types with type-specific validation and UI rendering. Reference attributes must link to any Open Mercato entity.

### R-PROD-4: Attribute Dependencies
Attributes must support dependency chains where one attribute's options are constrained by another's value.

### R-PROD-5: Product Relationships
Products must declare parent/child, requires, and excludes relationships. Enforced by business rules at quoting time.

### R-PROD-6: Conditional Charges
Charges must support applicability conditions that evaluate attribute values to determine if the charge applies.

---

## Service API

| Operation | Description |
|-----------|-------------|
| `getProductGroups()` | Fetch product group hierarchy |
| `getProducts(params)` | List products with filtering/search |
| `getProduct(id)` | Full product schema with attributes and charges |
| `getProductOfferings()` | List product offerings |
| `getProductOffering(id)` | Single offering with resolved structure |
| `getConstrainedAttributes(productId, currentConfig, context)` | Get attribute options constrained by current selections and rules |
