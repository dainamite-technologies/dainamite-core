# CPQ Module — Implementation Specification

This document describes the implementation plan for a **generic CPQ (Configure, Price, Quote) module** built on the Open Mercato framework. The module provides a reusable engine for configurable products, multi-charge pricing, and guided quoting — applicable to any product catalog. The GIX Internet Exchange use case serves as the reference implementation and seed data.

The design follows the framework's open-close principle: all functionality is added as a new `@app` module without modifying existing `@open-mercato/*` packages.

> **Reference**: Requirements and GIX use case are defined in `specs/cpq-requirements.md`.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Registration](#2-module-registration)
3. [Data Model — Entities](#3-data-model--entities)
4. [Seed Data & Setup](#4-seed-data--setup)
5. [Business Logic — Services](#5-business-logic--services)
6. [API Routes](#6-api-routes)
7. [Backend Pages — Admin Panel](#7-backend-pages--admin-panel)
8. [Injection Widgets — Customer Inventory Tab](#8-injection-widgets--customer-inventory-tab)
9. [Quoting Journey — Wizard Flow](#9-quoting-journey--wizard-flow)
10. [Pricing Engine Override](#10-pricing-engine-override)
11. [i18n — Translations](#11-i18n--translations)
12. [Database Migrations](#12-database-migrations)
13. [Implementation Steps — Ordered Checklist](#13-implementation-steps--ordered-checklist)

---

## 1. Architecture Overview

### Module Identity

| Property | Value |
|----------|-------|
| Module ID | `cpq` |
| Source | `@app` (custom module in `src/modules/cpq/`) |
| Dependencies | `catalog`, `sales`, `customers`, `dictionaries` |

### Design Philosophy

The CPQ module is **product-agnostic**. It does not hard-code knowledge of specific products like "Access Port" or "Cloud Connect." Instead, it provides generic building blocks:

- **Configurable attributes** — any product can declare typed attributes (enum, number, text, boolean) with dependency rules between them.
- **Charge definitions** — a product declares one or more charges (NRC, MRC, usage), each resolved via a pricing table lookup.
- **Pricing tables** — multi-dimensional lookup tables with named price columns; one table can hold multiple price points per entry.
- **Business rules** — validation constraints defined as data, not code, where possible.
- **Quoting wizard** — a generic step-based flow that reads product attributes and charges dynamically.

The GIX Internet Exchange products (Access Port, Internet Peering, Mobile Peering, Cloud Connect) are implemented purely as **seed data** — product records, attribute definitions, charge definitions, and pricing table entries.

### High-Level Design

```
src/modules/cpq/
├── index.ts                          # Module metadata & feature exports
├── acl.ts                            # Feature flag definitions
├── ce.ts                             # Custom entity specs (for entity registry)
├── setup.ts                          # Seed data (products, data centres, pricing)
├── di.ts                             # DI registrations (pricing, validation, inventory)
├── data/
│   ├── entities.ts                   # MikroORM entity definitions
│   └── validators.ts                 # Zod schemas for API validation
├── services/
│   ├── cpqPricingService.ts          # Generic pricing engine (flat, tiered, per-unit)
│   ├── cpqValidationService.ts       # Business rule validation
│   └── cpqInventoryService.ts        # Inventory query helpers
├── api/
│   ├── data-centres/
│   │   └── route.ts                  # CRUD for data centres
│   ├── pricing-tables/
│   │   └── route.ts                  # CRUD for pricing table headers
│   ├── pricing-table-entries/
│   │   └── route.ts                  # CRUD for pricing table rows
│   ├── product-attributes/
│   │   └── route.ts                  # CRUD for product attribute definitions
│   ├── product-charges/
│   │   └── route.ts                  # CRUD for product charge definitions
│   ├── inventory/
│   │   ├── route.ts                  # CRUD for inventory items
│   │   └── customer-items/
│   │       └── route.ts             # Customer inventory lookup
│   └── cpq-quotes/
│       ├── configure/
│       │   └── route.ts             # Quote configuration (persist + price)
│       └── price/
│           └── route.ts             # Price calculation (preview, no persist)
├── backend/
│   ├── cpq/
│   │   ├── data-centres/
│   │   │   ├── page.tsx              # Data centres list
│   │   │   ├── page.meta.ts
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Data centre detail
│   │   ├── products/
│   │   │   ├── page.tsx              # CPQ product config (attributes + charges)
│   │   │   ├── page.meta.ts
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Product attribute & charge editor
│   │   ├── pricing/
│   │   │   ├── page.tsx              # Pricing tables list
│   │   │   ├── page.meta.ts
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Pricing table detail + entry grid
│   │   ├── inventory/
│   │   │   ├── page.tsx              # Global inventory list
│   │   │   ├── page.meta.ts
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Inventory item detail
│   │   └── quotes/
│   │       ├── new/
│   │       │   └── page.tsx          # CPQ quoting wizard
│   │       └── page.meta.ts
└── widgets/
    ├── injection/
    │   └── customer-inventory/
    │       ├── widget.ts             # Injection widget definition
    │       └── widget.client.tsx     # Client component for inventory tab
    └── injection-table.ts            # Maps widget to customer detail spot
```

### Design Principles

- **Open-Close**: New module extends system capability; no changes to `@open-mercato/*` source files. Only `src/modules.ts` (add one entry) and `src/i18n/*.json` (add translation keys) are touched outside the module directory.
- **Product-Agnostic**: All product-specific knowledge (attributes, charges, pricing, validation rules) is expressed as data. Adding a new product requires only database records, not code changes.
- **Multi-Charge**: A single product can generate multiple charge lines (NRC, MRC, usage), each independently priced via its own pricing table lookup.
- **Standard Entities**: Quotes and orders use the standard `SalesQuote`/`SalesOrder` entities. CPQ-specific configuration is stored in the `configuration` JSONB field on `SalesQuoteLine` and in dedicated CPQ entities.
- **Injection Pattern**: Customer inventory tab is added via an injection widget, following the same pattern as `catalog.injection.product-seo` and `workflows.injection.order-approval`.
- **DI Override**: All CPQ services are registered in DI and can be overridden by downstream consumers.

---

## 2. Module Registration

### 2.1 Add to `src/modules.ts`

Add a single entry to the `enabledModules` array:

```typescript
{ id: 'cpq', from: '@app' }
```

This tells the code generator to scan `src/modules/cpq/` for entities, routes, DI registrars, widgets, and setup hooks.

### 2.2 Module Index — `src/modules/cpq/index.ts`

```typescript
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'cpq',
  title: 'Configure, Price, Quote',
  version: '0.1.0',
  description:
    'Generic CPQ engine — configurable product attributes, multi-charge pricing tables, and guided quoting flows.',
  author: 'App',
  license: 'Proprietary',
  requires: ['catalog', 'sales', 'customers', 'dictionaries'],
  ejectable: false,
}

export { features } from './acl'
```

### 2.3 Feature Flags — `src/modules/cpq/acl.ts`

```typescript
export const features = [
  { id: 'cpq.quotes.view', title: 'View CPQ Quotes', module: 'cpq' },
  { id: 'cpq.quotes.manage', title: 'Manage CPQ Quotes', module: 'cpq' },
  { id: 'cpq.inventory.view', title: 'View Inventory', module: 'cpq' },
  { id: 'cpq.inventory.manage', title: 'Manage Inventory', module: 'cpq' },
  { id: 'cpq.pricing.view', title: 'View Pricing Tables', module: 'cpq' },
  { id: 'cpq.pricing.manage', title: 'Manage Pricing Tables', module: 'cpq' },
  { id: 'cpq.products.view', title: 'View CPQ Product Config', module: 'cpq' },
  { id: 'cpq.products.manage', title: 'Manage CPQ Product Config', module: 'cpq' },
  { id: 'cpq.datacentres.view', title: 'View Data Centres', module: 'cpq' },
  { id: 'cpq.datacentres.manage', title: 'Manage Data Centres', module: 'cpq' },
]
```

---

## 3. Data Model — Entities

All entities follow the framework's standard pattern: UUID primary key, `organizationId`/`tenantId` scope, `createdAt`/`updatedAt`/`deletedAt` timestamps, and proper indexes.

### 3.1 `CpqDataCentre`

Represents a physical location relevant to product configuration. While named "Data Centre" for the GIX use case, this is a generic **site/location** entity usable by any domain.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `organizationId` | `uuid` | Multi-tenancy |
| `tenantId` | `uuid` | Multi-tenancy |
| `code` | `text` | Unique short code (e.g. `equinix-ld5`) |
| `name` | `text` | Display name (e.g. `Equinix LD5`) |
| `city` | `text` | City name (e.g. `London`) |
| `country` | `text` | Country name |
| `address` | `text` | Full street address |
| `capabilities` | `jsonb` | Arbitrary capability data (e.g. supported port sizes) |
| `isActive` | `boolean` | Default `true` |
| `metadata` | `jsonb` | Arbitrary extra data |
| `createdAt` | `timestamptz` | Auto |
| `updatedAt` | `timestamptz` | Auto |
| `deletedAt` | `timestamptz` | Soft delete |

**Table name**: `cpq_data_centres`
**Unique constraint**: `(organizationId, tenantId, code)`
**Index**: `(organizationId, tenantId)`

> For GIX: `capabilities` stores `{ "supportedPortSizes": ["1G", "10G", "100G"] }`.

### 3.2 `CpqProductAttribute`

Defines configurable attributes for a product. Attributes are the parameters a user fills in during the quoting wizard (e.g. "Port Size", "Bandwidth", "Cloud Provider"). Any product can have any number of attributes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `organizationId` | `uuid` | |
| `tenantId` | `uuid` | |
| `productId` | `uuid` FK | References `catalog_products.id` |
| `code` | `text` | Machine-readable key (e.g. `port_size`, `bandwidth_mb`) |
| `name` | `text` | Human-readable label |
| `attributeType` | `text` | `enum`, `number`, `text`, `boolean` |
| `options` | `jsonb` | For `enum`: array of `{ value, label }`. Nullable for other types |
| `constraints` | `jsonb` | Validation rules: `{ min?, max?, step?, required?, dependsOn?, dynamicOptionsSource? }` |
| `sortOrder` | `integer` | Display ordering |
| `isRequired` | `boolean` | Default `true` |
| `isActive` | `boolean` | Default `true` |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | |
| `deletedAt` | `timestamptz` | |

**Table name**: `cpq_product_attributes`
**Unique constraint**: `(organizationId, tenantId, productId, code)`
**Index**: `(organizationId, tenantId, productId)`

#### Attribute Dependencies via `constraints.dependsOn`

Attributes can depend on other attributes for option filtering or dynamic validation:

```json
{
  "dependsOn": {
    "attributeCode": "cloud_provider",
    "effect": "filter_options"
  },
  "dynamicOptionsSource": {
    "type": "pricing_table",
    "tableCode": "gix_cloud_connect_pricing",
    "dimensionKey": "cloud_region",
    "filterByDimension": { "cloud_provider": "$cloud_provider" }
  }
}
```

This allows the Cloud Region dropdown to dynamically populate based on the selected Cloud Provider, reading available values from the pricing table.

### 3.3 `CpqProductCharge`

Defines a charge that a product generates. One product can have multiple charges of different types. This is the core of the multi-charge model.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `organizationId` | `uuid` | |
| `tenantId` | `uuid` | |
| `productId` | `uuid` FK | References `catalog_products.id` |
| `code` | `text` | Machine-readable key (e.g. `setup_fee`, `monthly_port_fee`) |
| `name` | `text` | Human-readable label (e.g. "Setup Fee", "Monthly Port Fee") |
| `chargeType` | `text` | `nrc` (non-recurring), `mrc` (monthly recurring), `usage` |
| `pricingMethod` | `text` | `flat`, `tiered`, `per_unit` — how the price is calculated |
| `pricingTableId` | `uuid` FK | References `cpq_pricing_tables.id`. Nullable (for manually priced charges) |
| `priceColumnKey` | `text` | Key in the pricing table entry's `prices` map to read (e.g. `nrc`, `mrc`, `flat_per_mb`) |
| `quantityAttributeCode` | `text` | For `per_unit`/`tiered`: which product attribute provides the quantity (e.g. `bandwidth_mb`). Nullable for `flat` |
| `applicabilityCondition` | `jsonb` | Condition under which this charge applies. Nullable = always applies. Example: `{ "attribute": "pricing_model", "operator": "eq", "value": "flat" }` |
| `sortOrder` | `integer` | Display ordering within the product |
| `isActive` | `boolean` | Default `true` |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | |
| `deletedAt` | `timestamptz` | |

**Table name**: `cpq_product_charges`
**Unique constraint**: `(organizationId, tenantId, productId, code)`
**Index**: `(organizationId, tenantId, productId)`

#### How charge resolution works

Given a product configuration (attribute values), the pricing engine:
1. Loads all active charges for the product.
2. Filters charges by `applicabilityCondition` (e.g., skip "Committed Bandwidth Fee" if `pricing_model != burstable`).
3. For each applicable charge:
   - Looks up the linked `CpqPricingTable`.
   - Matches the configuration's attribute values against the table's dimensions to find the right `CpqPricingTableEntry`.
   - Reads `entry.prices[charge.priceColumnKey]` for the unit price.
   - Applies the `pricingMethod`:
     - `flat` → price = `unitPrice`
     - `per_unit` → price = `unitPrice × quantity` (where quantity comes from the attribute named by `quantityAttributeCode`)
     - `tiered` → price = sum of tier slabs applied to `quantity`
4. Returns a list of `{ chargeCode, chargeType, chargeName, unitPrice, quantity, totalPrice }`.

### 3.4 `CpqPricingTable`

Holds a named pricing table with its structure definition. A pricing table is a generic multi-dimensional lookup container.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `organizationId` | `uuid` | |
| `tenantId` | `uuid` | |
| `code` | `text` | Unique code (e.g. `gix_access_port_pricing`) |
| `name` | `text` | Display name |
| `description` | `text` | Nullable |
| `productId` | `uuid` FK | References `catalog_products.id`. Nullable (can be shared/global) |
| `dimensions` | `jsonb` | Array of dimension definitions: `[{ key, label, type }]` |
| `priceColumns` | `jsonb` | Array of price column definitions: `[{ key, label, chargeType }]` |
| `pricingModel` | `text` | `flat`, `tiered`, `per_unit` — determines entry structure |
| `currencyCode` | `text` | Default `USD` |
| `isActive` | `boolean` | Default `true` |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | |
| `deletedAt` | `timestamptz` | |

**Table name**: `cpq_pricing_tables`
**Unique constraint**: `(organizationId, tenantId, code)`

#### `priceColumns` Examples

For GIX Access Port:
```json
[
  { "key": "nrc", "label": "Setup Price (NRC)", "chargeType": "nrc" },
  { "key": "mrc", "label": "Monthly Recurring (MRC)", "chargeType": "mrc" }
]
```

For GIX Cloud Connect:
```json
[
  { "key": "flat_per_mb", "label": "Flat Price per MB", "chargeType": "mrc" },
  { "key": "commit_per_mb", "label": "Commit Price per MB", "chargeType": "mrc" },
  { "key": "overage_per_mb", "label": "Overage Price per MB", "chargeType": "usage" }
]
```

### 3.5 `CpqPricingTableEntry`

Individual rows in a pricing table. Each entry holds dimension values for matching and a map of named prices.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `organizationId` | `uuid` | |
| `tenantId` | `uuid` | |
| `pricingTableId` | `uuid` FK | References `cpq_pricing_tables.id` |
| `dimensionValues` | `jsonb` | Key-value pairs matching dimensions: `{ "data_centre": "equinix-ld5", "port_size": "10G" }` |
| `tierNumber` | `integer` | For tiered pricing: tier ordinal. Nullable for flat/per_unit |
| `rangeFrom` | `numeric` | For tiered: lower bound (inclusive). Nullable |
| `rangeTo` | `numeric` | For tiered: upper bound (inclusive), `null` = infinity |
| `prices` | `jsonb` | Map of `{ <priceColumnKey>: <amount> }`. E.g. `{ "nrc": 490.00, "mrc": 450.00 }` |
| `isActive` | `boolean` | Default `true` |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | |
| `deletedAt` | `timestamptz` | |

**Table name**: `cpq_pricing_table_entries`
**Index**: `(organizationId, tenantId, pricingTableId)`
**Index**: `(pricingTableId, dimensionValues)` using GIN

#### Entry Examples

GIX Access Port entry:
```json
{
  "dimensionValues": { "data_centre": "equinix-ld5", "port_size": "10G" },
  "tierNumber": null,
  "rangeFrom": null,
  "rangeTo": null,
  "prices": { "nrc": 490.00, "mrc": 450.00 }
}
```

GIX Internet Peering tier entry:
```json
{
  "dimensionValues": {},
  "tierNumber": 2,
  "rangeFrom": 101,
  "rangeTo": 250,
  "prices": { "per_mb": 0.47 }
}
```

GIX Cloud Connect entry:
```json
{
  "dimensionValues": { "data_centre_location": "London", "cloud_provider": "AWS", "cloud_region": "eu-west-2" },
  "tierNumber": null,
  "rangeFrom": null,
  "rangeTo": null,
  "prices": { "flat_per_mb": 0.52, "commit_per_mb": 0.46, "overage_per_mb": 0.69 }
}
```

### 3.6 `CpqInventoryItem`

Represents a purchased/active product or service for a customer. Stores configuration generically as JSONB.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `organizationId` | `uuid` | |
| `tenantId` | `uuid` | |
| `customerId` | `uuid` FK | References customer entity |
| `productId` | `uuid` FK | References `catalog_products.id` |
| `parentInventoryItemId` | `uuid` FK | Self-referencing; for child items linked to a parent. Nullable |
| `status` | `text` | `active`, `suspended`, `terminated`, `pending` |
| `configuration` | `jsonb` | Full attribute values snapshot (see below) |
| `charges` | `jsonb` | Snapshot of resolved charges at time of purchase (see below) |
| `dataCentreId` | `uuid` FK | References `cpq_data_centres.id`. Nullable |
| `currencyCode` | `text` | |
| `activatedAt` | `timestamptz` | When the item went live |
| `terminatedAt` | `timestamptz` | When the item was terminated; nullable |
| `sourceQuoteId` | `uuid` FK | References `sales_quotes.id`; nullable |
| `sourceOrderId` | `uuid` FK | References `sales_orders.id`; nullable |
| `metadata` | `jsonb` | Arbitrary extra data |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | |
| `deletedAt` | `timestamptz` | |

**Table name**: `cpq_inventory_items`
**Index**: `(organizationId, tenantId, customerId)`
**Index**: `(organizationId, tenantId, parentInventoryItemId)`
**Index**: `(customerId, status)`
**Index**: `(configuration)` using GIN — for querying by attribute values

#### `configuration` JSONB Examples

GIX Access Port:
```json
{
  "data_centre": "equinix-ld5",
  "port_size": "10G"
}
```

GIX Cloud Connect (burstable):
```json
{
  "bandwidth_mb": 100,
  "cloud_provider": "AWS",
  "cloud_region": "eu-west-2",
  "pricing_model": "burstable"
}
```

#### `charges` JSONB Structure

Snapshot of all charges calculated at time of purchase:
```json
[
  {
    "chargeCode": "setup_fee",
    "chargeName": "Setup Fee",
    "chargeType": "nrc",
    "unitPrice": 490.00,
    "quantity": 1,
    "totalPrice": 490.00
  },
  {
    "chargeCode": "monthly_port_fee",
    "chargeName": "Monthly Port Fee",
    "chargeType": "mrc",
    "unitPrice": 450.00,
    "quantity": 1,
    "totalPrice": 450.00
  }
]
```

### 3.7 `CpqQuoteConfiguration`

Stores the full CPQ configuration for a quote, linking the standard `SalesQuote` to CPQ-specific data.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `organizationId` | `uuid` | |
| `tenantId` | `uuid` | |
| `quoteId` | `uuid` FK | References `sales_quotes.id` (unique) |
| `customerId` | `uuid` FK | References customer entity |
| `quoteType` | `text` | `new_primary`, `add_child`, `new_primary_with_children` |
| `selectedParentInventoryItemId` | `uuid` FK | For `add_child`: existing parent item from inventory. Nullable |
| `primaryItemConfiguration` | `jsonb` | For new primary item: attribute values |
| `childItemConfigurations` | `jsonb` | Array of child item configs attached to this quote |
| `validationResult` | `jsonb` | Last validation run result |
| `pricingSummary` | `jsonb` | Calculated pricing breakdown grouped by charge type |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | |
| `deletedAt` | `timestamptz` | |

**Table name**: `cpq_quote_configurations`
**Unique constraint**: `(organizationId, tenantId, quoteId)`

#### `childItemConfigurations` JSONB Structure

```json
[
  {
    "lineId": "<sales-quote-line-id>",
    "productId": "<catalog-product-uuid>",
    "configuration": {
      "bandwidth_mb": 200
    },
    "charges": [
      {
        "chargeCode": "bandwidth_fee",
        "chargeType": "mrc",
        "pricingBreakdown": {
          "method": "tiered",
          "tiers": [
            { "tier": 0, "from": 0, "to": 50, "pricePerUnit": 0.52, "quantity": 50, "subtotal": 26.00 },
            { "tier": 1, "from": 51, "to": 100, "pricePerUnit": 0.49, "quantity": 50, "subtotal": 24.50 },
            { "tier": 2, "from": 101, "to": 200, "pricePerUnit": 0.47, "quantity": 100, "subtotal": 47.00 }
          ],
          "totalPrice": 97.50
        }
      }
    ]
  },
  {
    "lineId": "<sales-quote-line-id>",
    "productId": "<catalog-product-uuid>",
    "configuration": {
      "bandwidth_mb": 100,
      "cloud_provider": "AWS",
      "cloud_region": "eu-west-2",
      "pricing_model": "burstable"
    },
    "charges": [
      {
        "chargeCode": "commit_bandwidth_fee",
        "chargeType": "mrc",
        "pricingBreakdown": {
          "method": "per_unit",
          "pricePerUnit": 0.46,
          "quantity": 100,
          "totalPrice": 46.00
        }
      },
      {
        "chargeCode": "overage_fee",
        "chargeType": "usage",
        "pricingBreakdown": {
          "method": "per_unit",
          "pricePerUnit": 0.69,
          "quantity": null,
          "totalPrice": null,
          "note": "Billed on 95th-percentile overage above committed bandwidth"
        }
      }
    ]
  }
]
```

### 3.8 Entity Relationship Diagram

```
┌─────────────────────┐         ┌──────────────────────────┐
│  CatalogProduct     │◄────────│  CpqProductAttribute     │
│  (from catalog)     │  1:N    │  (configurable attrs)    │
└────────┬────────────┘         └──────────────────────────┘
         │
         │ 1:N
         ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│  CpqProductCharge        │───►│  CpqPricingTable         │
│  (NRC / MRC / usage)     │M:1 │  (dimensions + columns)  │
│  priceColumnKey ─────────│───►│                          │
└──────────────────────────┘    └────────┬─────────────────┘
                                         │ 1:N
                                         ▼
                                ┌──────────────────────────┐
                                │  CpqPricingTableEntry    │
                                │  (dimension vals + prices)│
                                └──────────────────────────┘

┌─────────────────────┐
│  CpqDataCentre      │
│  (locations)         │
└────────┬────────────┘
         │ referenced by
         ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│  CpqInventoryItem        │───►│  CpqInventoryItem        │
│  (primary / parent)      │1:N │  (child items)           │
│  customerId ──► Customer │    │  parentInventoryItemId   │
│  configuration (JSONB)   │    │  configuration (JSONB)   │
│  charges (JSONB)         │    │  charges (JSONB)         │
└──────────────────────────┘    └──────────────────────────┘

┌─────────────────────┐         ┌──────────────────────────┐
│  SalesQuote         │◄────────│  CpqQuoteConfiguration   │
│  (from sales)       │  1:1    │  (CPQ-specific data)     │
└─────────────────────┘         └──────────────────────────┘
```

---

## 4. Seed Data & Setup

### 4.1 Setup Hook — `src/modules/cpq/setup.ts`

The setup module implements `ModuleSetupConfig` with:

- **`onTenantCreated`**: No-op (or create default settings if needed later).
- **`seedDefaults`**: Seeds the GIX reference data — products, attributes, charges, data centres, and pricing tables.
- **`seedExamples`**: Optionally seeds sample inventory and quote data for demo.
- **`defaultRoleFeatures`**: Grants `cpq.*` to admin and employee roles.

### 4.2 Products to Seed

Create 4 `CatalogProduct` records via the catalog module's entity:

| SKU | Title | Type | Description |
|-----|-------|------|-------------|
| `GIX-ACCESS-PORT` | GIX Access Port | `configurable` | Physical port at a data centre |
| `GIX-INTERNET-PEERING` | GIX Internet Peering | `configurable` | Virtual peering service for internet traffic |
| `GIX-MOBILE-PEERING` | GIX Mobile Peering | `configurable` | Virtual peering service for mobile roaming traffic |
| `GIX-CLOUD-CONNECT` | GIX Cloud Connect | `configurable` | Direct cloud connectivity service |

Set `isConfigurable: true` on all products.

### 4.3 Product Attributes to Seed

**GIX Access Port** attributes:

| Code | Name | Type | Options/Constraints |
|------|------|------|-------------------|
| `data_centre` | Data Centre | `enum` | Options populated from `CpqDataCentre` records |
| `port_size` | Port Size | `enum` | `1G`, `10G`, `100G` — filtered by `data_centre` capabilities (Business Rule #1) via `dependsOn` |

**GIX Internet Peering** attributes:

| Code | Name | Type | Options/Constraints |
|------|------|------|-------------------|
| `bandwidth_mb` | Bandwidth (MB) | `number` | `{ min: 1, step: 1 }` — max enforced by Business Rule #3 at runtime |

**GIX Mobile Peering** attributes:

| Code | Name | Type | Options/Constraints |
|------|------|------|-------------------|
| `bandwidth_mb` | Bandwidth (MB) | `number` | `{ min: 1, step: 1 }` |

**GIX Cloud Connect** attributes:

| Code | Name | Type | Options/Constraints |
|------|------|------|-------------------|
| `cloud_provider` | Cloud Provider | `enum` | `AWS`, `GCP`, `MS Azure` |
| `cloud_region` | Cloud Region | `enum` | Dependent on `cloud_provider`; options derived dynamically from pricing table |
| `pricing_model` | Pricing Model | `enum` | `flat`, `burstable` |
| `bandwidth_mb` | Bandwidth (MB) | `number` | `{ min: 1, step: 1 }` |

### 4.4 Product Charges to Seed

**GIX Access Port** charges:

| Code | Name | Charge Type | Pricing Method | Table | Price Column Key | Quantity Attr | Condition |
|------|------|-------------|---------------|-------|-----------------|---------------|-----------|
| `setup_fee` | Setup Fee | `nrc` | `flat` | `gix_access_port_pricing` | `nrc` | — | — |
| `monthly_port_fee` | Monthly Port Fee | `mrc` | `flat` | `gix_access_port_pricing` | `mrc` | — | — |

**GIX Internet Peering** charges:

| Code | Name | Charge Type | Pricing Method | Table | Price Column Key | Quantity Attr | Condition |
|------|------|-------------|---------------|-------|-----------------|---------------|-----------|
| `bandwidth_fee` | Bandwidth Fee | `mrc` | `tiered` | `gix_internet_peering_pricing` | `per_mb` | `bandwidth_mb` | — |

**GIX Mobile Peering** charges:

| Code | Name | Charge Type | Pricing Method | Table | Price Column Key | Quantity Attr | Condition |
|------|------|-------------|---------------|-------|-----------------|---------------|-----------|
| `bandwidth_fee` | Bandwidth Fee | `mrc` | `tiered` | `gix_mobile_peering_pricing` | `per_mb` | `bandwidth_mb` | — |

**GIX Cloud Connect** charges:

| Code | Name | Charge Type | Pricing Method | Table | Price Column Key | Quantity Attr | Condition |
|------|------|-------------|---------------|-------|-----------------|---------------|-----------|
| `flat_bandwidth_fee` | Flat Bandwidth Fee | `mrc` | `per_unit` | `gix_cloud_connect_pricing` | `flat_per_mb` | `bandwidth_mb` | `pricing_model == flat` |
| `commit_bandwidth_fee` | Committed Bandwidth Fee | `mrc` | `per_unit` | `gix_cloud_connect_pricing` | `commit_per_mb` | `bandwidth_mb` | `pricing_model == burstable` |
| `overage_fee` | Overage Fee | `usage` | `per_unit` | `gix_cloud_connect_pricing` | `overage_per_mb` | `bandwidth_mb` | `pricing_model == burstable` |

### 4.5 Data Centres to Seed

Seed 14 `CpqDataCentre` records as specified in requirements:

| Code | Name | City | Capabilities |
|------|------|------|-------------|
| `equinix-ld5` | Equinix LD5 | London | `{ "supportedPortSizes": ["1G", "10G", "100G"] }` |
| `equinix-ld8` | Equinix LD8 | London | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `telehouse-ldn-south` | TELEHOUSE London Docklands (South) | London | `{ "supportedPortSizes": ["1G"] }` |
| `equinix-fr5` | Equinix FR5 | Frankfurt | `{ "supportedPortSizes": ["1G", "10G", "100G"] }` |
| `digital-realty-fra8` | Digital Realty FRA8 | Frankfurt | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `equinix-md2` | Equinix MD2 | Madrid | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `digital-realty-mad1` | Digital Realty MAD1 | Madrid | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `equinix-am1` | Equinix AM1 | Amsterdam | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `digital-realty-ams11` | Digital Realty AMS11 | Amsterdam | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `equinix-dc3` | Equinix DC3 | Ashburn | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `equinix-dc11` | Equinix DC11 | Ashburn | `{ "supportedPortSizes": ["1G", "10G", "100G"] }` |
| `equinix-dx1` | Equinix DX1 | Dubai | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `datamena-al-salam` | Datamena Al Salam Tower Datacenter | Dubai | `{ "supportedPortSizes": ["1G", "10G"] }` |
| `equinix-sg1` | Equinix SG1 | Singapore | `{ "supportedPortSizes": ["1G"] }` |
| `digital-realty-sin10` | Digital Realty SIN10 | Singapore | `{ "supportedPortSizes": ["1G", "10G", "100G"] }` |

### 4.6 Pricing Tables to Seed

#### Table 1: `gix_access_port_pricing`

- **Model**: `flat`
- **Dimensions**: `[{ key: "data_centre", label: "Data Centre" }, { key: "port_size", label: "Port Size" }]`
- **Price columns**: `[{ key: "nrc", label: "Setup Price (NRC)" }, { key: "mrc", label: "Monthly Recurring (MRC)" }]`
- **Entries**: 42 rows (14 data centres × 3 port sizes, where supported). Each entry has `prices: { "nrc": <setup>, "mrc": <monthly> }` per the requirements pricing table.

#### Table 2: `gix_internet_peering_pricing`

- **Model**: `tiered`
- **Dimensions**: `[]` (universal tiered pricing)
- **Price columns**: `[{ key: "per_mb", label: "Price per MB" }]`
- **Entries**: 6 tier rows: tier 0 (0–50 MB @ 0.52), tier 1 (51–100 @ 0.49), tier 2 (101–250 @ 0.47), tier 3 (251–500 @ 0.45), tier 4 (501–1000 @ 0.43), tier 5 (1001–∞ @ 0.40).

#### Table 3: `gix_mobile_peering_pricing`

- **Model**: `tiered`
- **Dimensions**: `[]`
- **Price columns**: `[{ key: "per_mb", label: "Price per MB" }]`
- **Entries**: 6 tier rows: tier 0 (0–50 @ 1.23), tier 1 (51–100 @ 1.11), tier 2 (101–250 @ 1.00), tier 3 (251–500 @ 0.85), tier 4 (501–1000 @ 0.74), tier 5 (1001–∞ @ 0.63).

#### Table 4: `gix_cloud_connect_pricing`

- **Model**: `per_unit`
- **Dimensions**: `[{ key: "data_centre_location", label: "Data Centre Location" }, { key: "cloud_provider", label: "Cloud Provider" }, { key: "cloud_region", label: "Cloud Region" }]`
- **Price columns**: `[{ key: "flat_per_mb", label: "Flat Price per MB" }, { key: "commit_per_mb", label: "Commit Price per MB" }, { key: "overage_per_mb", label: "Overage Price per MB" }]`
- **Entries**: ~90 entries across 7 locations × 3 providers × multiple regions. Each entry stores all three price points in its `prices` map per the requirements pricing table.

---

## 5. Business Logic — Services

### 5.1 `CpqPricingService`

Registered in DI as `cpqPricingService`. A generic pricing engine that resolves charges for any product.

```typescript
interface CpqPricingService {
  resolveProductCharges(params: {
    productId: string
    configuration: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<ResolvedCharge[]>

  calculateCharge(params: {
    charge: CpqProductCharge
    configuration: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<ResolvedCharge>

  calculateQuoteTotal(params: {
    quoteId: string
    tenantId: string
    organizationId: string
  }): Promise<QuotePricingSummary>
}

interface ResolvedCharge {
  chargeCode: string
  chargeName: string
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod: 'flat' | 'tiered' | 'per_unit'
  unitPrice: number
  quantity: number | null
  totalPrice: number | null
  currencyCode: string
  breakdown?: TierBreakdown | null
  note?: string | null
}

interface TierBreakdown {
  tiers: Array<{
    tier: number
    from: number
    to: number
    pricePerUnit: number
    quantity: number
    subtotal: number
  }>
}

interface QuotePricingSummary {
  lines: Array<{
    lineId: string
    productId: string
    charges: ResolvedCharge[]
  }>
  totals: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; unitPrice: number; note: string }>
  }
  currencyCode: string
}
```

#### Pricing Method Algorithms

**`flat`**: Price is looked up directly from the pricing table entry matched by dimension values.
- `totalPrice = entry.prices[priceColumnKey]`

**`per_unit`**: Unit price from pricing table × quantity from the configuration attribute.
- `totalPrice = entry.prices[priceColumnKey] × configuration[quantityAttributeCode]`

**`tiered`**: Quantity is split across tier ranges; each tier's portion is priced at that tier's rate.
- For N = `configuration[quantityAttributeCode]`:
  1. Sort tiers by `tierNumber`
  2. For each tier: `slabQuantity = min(N - allocated, rangeTo - rangeFrom + 1)`
  3. `slabPrice = slabQuantity × entry.prices[priceColumnKey]`
  4. `totalPrice = sum of all slab prices`

#### Burstable Pricing (Cloud Connect)

When `pricing_model == burstable`:
1. The **`commit_bandwidth_fee`** charge resolves normally as `per_unit` (committed bandwidth × commit rate) → `chargeType: mrc`.
2. The **`overage_fee`** charge resolves with `quantity: null` and `totalPrice: null` because actual overage is usage-based (95th-percentile measured post-hoc). The unit price (`overage_per_mb`) and a descriptive `note` are returned for display on the quote.

The overage charge is informational on the quote ("up to X per MB overage") and will be billed via a usage reconciliation process outside the CPQ quoting flow.

### 5.2 `CpqValidationService`

Registered in DI as `cpqValidationService`. Enforces business rules.

```typescript
interface CpqValidationService {
  validateProductConfiguration(params: {
    productId: string
    configuration: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<{ valid: boolean; errors: Array<{ attribute: string; message: string }> }>

  validateChildOnParent(params: {
    parentInventoryItemId?: string
    parentConfiguration?: Record<string, unknown>
    existingChildrenBandwidth: number
    newChildBandwidthMb: number
  }): Promise<{ valid: boolean; errors: string[]; remainingCapacity: number }>

  validateQuoteConfiguration(params: {
    quoteId: string
    tenantId: string
    organizationId: string
  }): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }>

  getAttributeOptions(params: {
    productId: string
    attributeCode: string
    currentConfiguration: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<Array<{ value: string; label: string; disabled?: boolean }>>

  getParentRemainingCapacity(params: {
    parentInventoryItemId: string
    tenantId: string
    organizationId: string
  }): Promise<{ capacityMb: number; usedMb: number; remainingMb: number }>
}
```

**Business Rules enforced** (GIX-specific rules expressed as data constraints):
1. **Port size by data centre**: `getAttributeOptions('port_size')` reads the data centre's `capabilities.supportedPortSizes` to filter available values.
2. **Service requires parent port**: `validateChildOnParent()` ensures a parent item exists.
3. **Bandwidth cap**: `validateChildOnParent()` sums existing children's `bandwidth_mb` and checks against parent's port capacity.

### 5.3 `CpqInventoryService`

Registered in DI as `cpqInventoryService`. Handles inventory queries.

```typescript
interface CpqInventoryService {
  getCustomerParentItems(params: {
    customerId: string
    productId?: string
    tenantId: string
    organizationId: string
  }): Promise<CpqInventoryItem[]>

  getChildItems(params: {
    parentInventoryItemId: string
    tenantId: string
    organizationId: string
  }): Promise<CpqInventoryItem[]>

  getCustomerInventory(params: {
    customerId: string
    tenantId: string
    organizationId: string
    status?: string
  }): Promise<CpqInventoryItem[]>

  provisionFromOrder(params: {
    orderId: string
    tenantId: string
    organizationId: string
  }): Promise<CpqInventoryItem[]>
}
```

---

## 6. API Routes

All API routes follow the framework's `makeCrudRoute` pattern where appropriate, or use custom handlers for CPQ-specific orchestration.

### 6.1 Data Centres — `/api/cpq/data-centres`

Standard CRUD via `makeCrudRoute`:
- **GET**: List/filter data centres (supports `?city=`, `?isActive=`)
- **POST**: Create data centre
- **PUT**: Update data centre
- **DELETE**: Soft delete

Features: `cpq.datacentres.view` (GET), `cpq.datacentres.manage` (POST/PUT/DELETE)

### 6.2 Pricing Tables — `/api/cpq/pricing-tables`

Standard CRUD for pricing table headers:
- **GET**: List tables (supports `?productId=`, `?code=`)
- **GET** `?id=<id>`: Get table with entries
- **POST**: Create table
- **PUT**: Update table
- **DELETE**: Soft delete

Features: `cpq.pricing.view` (GET), `cpq.pricing.manage` (POST/PUT/DELETE)

### 6.3 Pricing Table Entries — `/api/cpq/pricing-table-entries`

Standard CRUD for individual pricing entries:
- Filterable by `pricingTableId`
- Supports bulk upsert via POST with array body

### 6.4 Product Attributes — `/api/cpq/product-attributes`

Standard CRUD:
- **GET**: List attributes (supports `?productId=`)
- **POST/PUT/DELETE**: Manage attribute definitions

Features: `cpq.products.view` (GET), `cpq.products.manage` (POST/PUT/DELETE)

### 6.5 Product Charges — `/api/cpq/product-charges`

Standard CRUD:
- **GET**: List charges for a product (supports `?productId=`)
- **POST/PUT/DELETE**: Manage charge definitions

Features: `cpq.products.view` (GET), `cpq.products.manage` (POST/PUT/DELETE)

### 6.6 Inventory — `/api/cpq/inventory`

Standard CRUD:
- **GET**: List inventory items (supports `?customerId=`, `?status=`, `?parentInventoryItemId=`, `?productId=`)
- **POST**: Create inventory item (typically from order provisioning)
- **PUT**: Update item (status changes, etc.)
- **DELETE**: Soft delete

Features: `cpq.inventory.view` (GET), `cpq.inventory.manage` (POST/PUT/DELETE)

### 6.7 Customer Inventory Lookup — `/api/cpq/inventory/customer-items`

**GET** `?customerId=<id>&parentOnly=true` — Returns active parent items (e.g., access ports) for a customer, including remaining capacity. Used by the quoting wizard.

### 6.8 CPQ Quote Configuration — `/api/cpq/cpq-quotes/configure`

Custom endpoint for the quoting wizard:

**POST** — Save/update CPQ configuration for a quote:
```typescript
{
  quoteId: string
  customerId: string
  quoteType: 'new_primary' | 'add_child' | 'new_primary_with_children'
  selectedParentInventoryItemId?: string
  primaryItemConfiguration?: {
    productId: string
    configuration: Record<string, unknown>
  }
  childItems: Array<{
    productId: string
    configuration: Record<string, unknown>
  }>
}
```

This endpoint:
1. Validates the full configuration via `CpqValidationService`
2. Resolves all charges via `CpqPricingService`
3. Creates/updates `CpqQuoteConfiguration`
4. Creates/updates `SalesQuoteLine` records — one line per charge (grouped by product item)
5. Writes calculated amounts to quote line price fields
6. Returns the complete configuration with pricing breakdown

### 6.9 CPQ Price Calculation — `/api/cpq/cpq-quotes/price`

**POST** — Calculate price without saving (for real-time wizard preview):
```typescript
// Request
{
  primaryItem?: {
    productId: string
    configuration: Record<string, unknown>
  }
  childItems: Array<{
    productId: string
    configuration: Record<string, unknown>
  }>
}

// Response
{
  primaryItemCharges?: ResolvedCharge[]
  childItemCharges: Array<{
    productId: string
    charges: ResolvedCharge[]
  }>
  totals: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; unitPrice: number; note: string }>
  }
  currencyCode: string
}
```

---

## 7. Backend Pages — Admin Panel

### 7.1 Navigation Structure

| Page | Path | Group | Order | Icon |
|------|------|-------|-------|------|
| Data Centres | `/backend/cpq/data-centres` | CPQ | 10 | `MapPin` |
| Product Config | `/backend/cpq/products` | CPQ | 15 | `Settings` |
| Pricing Tables | `/backend/cpq/pricing` | CPQ | 20 | `Calculator` |
| Inventory | `/backend/cpq/inventory` | CPQ | 30 | `Package` |
| New CPQ Quote | `/backend/cpq/quotes/new` | Sales | 45 | `FileText` |

### 7.2 Data Centres Page — `/backend/cpq/data-centres`

- **List view**: `DataTable` with columns: Name, Code, City, Country, Capabilities summary, Active.
- **Detail view** (`[id]`): `CrudForm` for editing. The `capabilities` field renders as a JSON editor or structured sub-form depending on content.

### 7.3 Product Config Page — `/backend/cpq/products`

- **List view**: `DataTable` showing catalog products that have CPQ attributes or charges defined. Columns: Product Name, SKU, Attribute Count, Charge Count.
- **Detail view** (`[id]`): Two-tab layout:
  - **Attributes tab**: Editable list of `CpqProductAttribute` records for this product. Inline form for adding/editing attributes with type, options, constraints.
  - **Charges tab**: Editable list of `CpqProductCharge` records. Each charge shows type (NRC/MRC/usage), pricing method, linked pricing table, price column key, applicability condition.

### 7.4 Pricing Tables Page — `/backend/cpq/pricing`

- **List view**: Table of pricing tables with columns: Name, Code, Product, Pricing Model, Price Columns count, Currency, Active.
- **Detail view** (`[id]`): Shows table metadata at top (dimensions, price columns). Below: an editable data grid of entries. Grid columns = dimension columns + price column per `priceColumns` definition. For tiered tables, additional columns for tier number, range from/to.
- Supports inline editing of prices and bulk import.

### 7.5 Inventory Page — `/backend/cpq/inventory`

- **List view**: `DataTable` with columns: Customer, Product, Status, Location, Configuration summary, MRC Total, Activated At.
- Filterable by customer, product, status, data centre.
- **Detail view** (`[id]`): Shows item details, configuration attributes, charge breakdown. For parent items, shows child items in a nested table.
- Tree-like display: parent items as rows; child items indent underneath.

### 7.6 Page Metadata Pattern

Each page directory contains a `page.meta.ts` exporting:

```typescript
export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.<feature>.view'],
  pageTitle: '<Page Title>',
  pageTitleKey: 'cpq.<section>.list.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'cpq.nav.group',
  pageOrder: <number>,
  icon: <LucideIcon>,
  breadcrumb: [{ label: '<Label>', labelKey: 'cpq.<section>.list.title' }],
} as const
```

---

## 8. Injection Widgets — Customer Inventory Tab

### 8.1 Injection Widget Definition

**Widget file**: `src/modules/cpq/widgets/injection/customer-inventory/widget.ts`

```typescript
const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'cpq.injection.customer-inventory',
    title: 'Customer Inventory',
    description: 'Shows purchased products and services for a customer',
    features: ['cpq.inventory.view'],
    priority: 50,
    enabled: true,
  },
  Widget: CustomerInventoryWidget,
}
```

**Client component**: `src/modules/cpq/widgets/injection/customer-inventory/widget.client.tsx`

Renders a tabbed view:
- **Active Items tab**: Tree view with parent items and their children. Shows product name, configuration summary, charge totals.
- **All Items tab**: Flat list of all inventory items with status filter.

Each row is clickable, navigating to `/backend/cpq/inventory/[id]`.

Includes a "New CPQ Quote" button at the top that navigates to `/backend/cpq/quotes/new?customerId=<id>`.

### 8.2 Injection Table

**File**: `src/modules/cpq/widgets/injection-table.ts`

```typescript
export const injectionTable: ModuleInjectionTable = {
  'customers.detail:tabs': [
    {
      widgetId: 'cpq.injection.customer-inventory',
      kind: 'tab',
      tabLabel: 'cpq.inventory.tabLabel',
      tabLabelDefault: 'Inventory',
      priority: 60,
    },
  ],
}
```

---

## 9. Quoting Journey — Wizard Flow

### 9.1 Wizard Page

**Location**: `/backend/cpq/quotes/new`

A multi-step wizard implemented as a single-page React component with local state management. Steps are managed via React state, allowing back/forward navigation without route changes.

### 9.2 Wizard Steps

#### Step 1: Select Customer

- Customer search/select dropdown using the existing customer search API.
- On selection, fetches the customer's active parent items (e.g., access ports) via `/api/cpq/inventory/customer-items?customerId=<id>&parentOnly=true`.
- Pre-populated if `?customerId=<id>` query param is present.

#### Step 2: Choose Path

Based on whether the customer has existing parent items:

**If customer has active parent items**:
- Radio button choice:
  - **"Add services to an existing item"** → Step 2a
  - **"Purchase a new primary item"** → Step 3

**If customer has no parent items**:
- Automatically proceeds to Step 3 with an informational message.

#### Step 2a: Select Existing Parent Item

- Card-based selector showing the customer's active parent items.
- Each card shows: Product name, location, configuration summary, capacity utilization bar, charge totals.
- Items with 0 remaining capacity shown but disabled with a "Full" badge.
- On selection → Step 4.

#### Step 3: Configure New Primary Item

- **Product selector**: Choose which product to configure (e.g., GIX Access Port).
- **Attribute form**: Dynamically rendered from `CpqProductAttribute` records for the selected product. Attributes render as:
  - `enum` → Dropdown or radio group
  - `number` → Slider + numeric input
  - `text` → Text input
  - `boolean` → Toggle
- **Dependent attributes**: When an attribute with `dependsOn` changes, dependent attributes refresh their options via `getAttributeOptions()`.
- **Live charge preview**: As attributes are filled, calls `/api/cpq/cpq-quotes/price` to show all charges for this item:
  - **NRC charges**: One-time costs shown with a "One-time" badge.
  - **MRC charges**: Monthly costs shown with a "Monthly" badge.
- On completion → Step 4.

#### Step 4: Configure Child Items (Services)

- **Product type selector**: Card-based picker for available child products (e.g., Internet Peering, Mobile Peering, Cloud Connect).
- **Attribute form**: Dynamically rendered per product, same as Step 3.
- **For Cloud Connect specifically**: The `pricing_model` attribute (flat/burstable) drives which charges appear in the live preview:
  - **Flat**: Shows flat bandwidth fee as MRC.
  - **Burstable**: Shows committed bandwidth fee as MRC + overage fee as informational usage charge with rate displayed.
- **Tiered pricing breakdown**: For tiered charges, shows each tier's contribution as the user adjusts bandwidth.
- **Remaining capacity indicator**: Visual bar showing how much parent capacity remains.
- **"Add Another Service" button**: Allows stacking multiple child items, with bandwidth cap validation via `validateChildOnParent()`.
- **Services summary**: List of configured child items with edit/remove actions. Running totals by charge type.

#### Step 5: Review & Confirm

Full summary showing:
- Customer details
- Primary item (new or existing) with all its charges
- All child items with per-item charge breakdowns
- **Totals grouped by charge type**:
  - **One-time charges (NRC)**: Sum of all NRC charges across all items. Displayed as "Due at signing" or "Setup fees".
  - **Monthly recurring (MRC)**: Sum of all MRC charges. Displayed as "Monthly total".
  - **Usage charges**: Listed with per-unit rates and conditions (e.g., "Overage billed at 0.69/MB above committed bandwidth").
- **Validation status**: Green checkmark or red errors.
- **"Create Quote" button**: Calls `/api/cpq/cpq-quotes/configure` to persist, creates the `SalesQuote`, navigates to quote detail.

### 9.3 Wizard State Shape

```typescript
interface CpqWizardState {
  step: 1 | 2 | '2a' | 3 | 4 | 5
  customerId: string | null
  customerName: string | null
  existingParentItems: CpqInventoryItem[]

  quotePath: 'new_primary' | 'add_child' | null

  // Step 2a
  selectedParentInventoryItemId: string | null
  selectedParentItem: CpqInventoryItem | null

  // Step 3
  primaryProductId: string | null
  primaryConfiguration: Record<string, unknown>
  primaryCharges: ResolvedCharge[]

  // Step 4
  childItems: Array<{
    id: string
    productId: string
    configuration: Record<string, unknown>
    charges: ResolvedCharge[]
  }>

  // Computed
  remainingParentCapacityMb: number
  totals: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; unitPrice: number; note: string }>
  }
  validationErrors: string[]
}
```

---

## 10. Pricing Engine Override

### 10.1 DI Registration — `src/modules/cpq/di.ts`

```typescript
import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer) {
  container.register({
    cpqPricingService: asFunction(({ em }) => {
      return new DefaultCpqPricingService(em)
    }).scoped(),

    cpqValidationService: asFunction(({ em }) => {
      return new DefaultCpqValidationService(em)
    }).scoped(),

    cpqInventoryService: asFunction(({ em }) => {
      return new DefaultCpqInventoryService(em)
    }).scoped(),
  })
}
```

### 10.2 Integration with Sales Pricing

The CPQ module does **not** override the standard `salesCalculationService` or `catalogPricingService`. Instead:

1. The quoting wizard calls `cpqPricingService.resolveProductCharges()` to calculate all charges for each configured item.
2. When persisting via `/api/cpq/cpq-quotes/configure`, the endpoint creates `SalesQuoteLine` records. **Each charge produces its own quote line** so that NRC, MRC, and usage charges are separately visible on the quote document:
   - NRC lines: `unitPriceNet = totalPrice`, `quantity = 1`
   - MRC lines: `unitPriceNet = unitPrice`, `quantity = quantityOrUnits`
   - Usage lines: `unitPriceNet = unitPrice`, `quantity = 0` (informational), with a `note` in the configuration JSONB.
3. The `configuration` JSONB on each `SalesQuoteLine` stores the full CPQ charge breakdown for reference.
4. The `CpqQuoteConfiguration` entity stores the quote-level CPQ state separately.

This approach avoids overriding the core pricing pipeline while leveraging the standard quote/order document structure.

### 10.3 Quote Line Mapping

For a GIX Access Port + Cloud Connect (burstable) quote, the resulting `SalesQuoteLine` records would be:

| Line # | Product | Name | Kind | Qty | Unit Price | Total | Configuration JSONB |
|--------|---------|------|------|-----|-----------|-------|-------------------|
| 1 | GIX Access Port | Setup Fee (NRC) | `charge_nrc` | 1 | 490.00 | 490.00 | `{ chargeCode: "setup_fee", ... }` |
| 2 | GIX Access Port | Monthly Port Fee | `charge_mrc` | 1 | 450.00 | 450.00 | `{ chargeCode: "monthly_port_fee", ... }` |
| 3 | GIX Cloud Connect | Committed Bandwidth Fee | `charge_mrc` | 100 | 0.46 | 46.00 | `{ chargeCode: "commit_bandwidth_fee", ... }` |
| 4 | GIX Cloud Connect | Overage Fee (usage) | `charge_usage` | — | 0.69/MB | — | `{ chargeCode: "overage_fee", note: "95th-pct..." }` |

### 10.4 Order Provisioning Hook

When a quote is converted to an order, the CPQ module listens for an event to create inventory items:

```typescript
subscribers: [
  {
    id: 'cpq.on-order-created',
    event: 'sales.order.created',
    handler: async (payload, ctx) => {
      const cpqConfig = await findCpqQuoteConfigBySourceQuote(payload.sourceQuoteId)
      if (cpqConfig) {
        await ctx.container.resolve('cpqInventoryService').provisionFromOrder({
          orderId: payload.orderId,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
        })
      }
    },
  },
]
```

---

## 11. i18n — Translations

Add the following key namespace to `src/i18n/en.json` (and corresponding entries in `pl.json`, `es.json`, `de.json`):

```json
{
  "cpq.nav.group": "CPQ",
  "cpq.datacentres.list.title": "Data Centres",
  "cpq.datacentres.detail.title": "Data Centre",
  "cpq.products.list.title": "Product Configuration",
  "cpq.products.detail.title": "Product Config",
  "cpq.products.tabs.attributes": "Attributes",
  "cpq.products.tabs.charges": "Charges",
  "cpq.pricing.list.title": "Pricing Tables",
  "cpq.pricing.detail.title": "Pricing Table",
  "cpq.inventory.list.title": "Inventory",
  "cpq.inventory.detail.title": "Inventory Item",
  "cpq.inventory.tabLabel": "Inventory",
  "cpq.charges.type.nrc": "One-time (NRC)",
  "cpq.charges.type.mrc": "Monthly Recurring (MRC)",
  "cpq.charges.type.usage": "Usage-based",
  "cpq.charges.method.flat": "Flat",
  "cpq.charges.method.tiered": "Tiered",
  "cpq.charges.method.per_unit": "Per Unit",
  "cpq.quotes.new.title": "New CPQ Quote",
  "cpq.quotes.wizard.step1.title": "Select Customer",
  "cpq.quotes.wizard.step2.title": "Choose Path",
  "cpq.quotes.wizard.step2.addChild": "Add services to an existing item",
  "cpq.quotes.wizard.step2.newPrimary": "Purchase a new primary item",
  "cpq.quotes.wizard.step2.noItemsMessage": "This customer has no active items. A new primary item must be configured.",
  "cpq.quotes.wizard.step2a.title": "Select Existing Item",
  "cpq.quotes.wizard.step3.title": "Configure Primary Item",
  "cpq.quotes.wizard.step4.title": "Configure Services",
  "cpq.quotes.wizard.step4.addAnother": "Add Another Service",
  "cpq.quotes.wizard.step4.remainingCapacity": "Remaining Capacity",
  "cpq.quotes.wizard.step5.title": "Review & Confirm",
  "cpq.quotes.wizard.step5.createQuote": "Create Quote",
  "cpq.quotes.wizard.pricing.nrcTotal": "One-time Total",
  "cpq.quotes.wizard.pricing.mrcTotal": "Monthly Total",
  "cpq.quotes.wizard.pricing.usageCharges": "Usage Charges",
  "cpq.quotes.wizard.pricing.perUnit": "per unit",
  "cpq.quotes.wizard.pricing.tierBreakdown": "Tier Breakdown",
  "cpq.quotes.wizard.pricing.flatModel": "Flat pricing",
  "cpq.quotes.wizard.pricing.burstableModel": "Burstable pricing",
  "cpq.quotes.wizard.pricing.committedBandwidth": "Committed bandwidth",
  "cpq.quotes.wizard.pricing.overageRate": "Overage rate",
  "cpq.quotes.wizard.validation.capacityExceeded": "Total bandwidth exceeds capacity",
  "cpq.quotes.wizard.validation.parentRequired": "A parent item is required",
  "cpq.quotes.wizard.validation.attributeRequired": "This field is required"
}
```

---

## 12. Database Migrations

After defining entities, run:

```bash
yarn db:generate   # Generates migration files from entity changes
yarn db:migrate    # Applies migrations to the database
```

The following tables will be created:

| Table | Entity |
|-------|--------|
| `cpq_data_centres` | `CpqDataCentre` |
| `cpq_product_attributes` | `CpqProductAttribute` |
| `cpq_product_charges` | `CpqProductCharge` |
| `cpq_pricing_tables` | `CpqPricingTable` |
| `cpq_pricing_table_entries` | `CpqPricingTableEntry` |
| `cpq_inventory_items` | `CpqInventoryItem` |
| `cpq_quote_configurations` | `CpqQuoteConfiguration` |

---

## 13. Implementation Steps — Ordered Checklist

Each step is designed to be independently testable. Steps within a phase can be parallelized where noted.

### Phase 1: Module Scaffold

- [ ] **1.1** Create directory structure: `src/modules/cpq/` with all subdirectories as defined in [Architecture Overview](#1-architecture-overview)
- [ ] **1.2** Create `src/modules/cpq/index.ts` with module metadata
- [ ] **1.3** Create `src/modules/cpq/acl.ts` with feature flag definitions
- [ ] **1.4** Add `{ id: 'cpq', from: '@app' }` to `src/modules.ts`
- [ ] **1.5** Run `yarn generate` to verify the module is picked up by the code generator

### Phase 2: Data Model

- [ ] **2.1** Define `CpqDataCentre` entity in `src/modules/cpq/data/entities.ts`
- [ ] **2.2** Define `CpqProductAttribute` entity
- [ ] **2.3** Define `CpqProductCharge` entity with FK to `CatalogProduct` and `CpqPricingTable`
- [ ] **2.4** Define `CpqPricingTable` entity with `dimensions`, `priceColumns`, `pricingModel`
- [ ] **2.5** Define `CpqPricingTableEntry` entity with `dimensionValues`, `prices` JSONB, tier fields, `ManyToOne` to `CpqPricingTable`
- [ ] **2.6** Define `CpqInventoryItem` entity with `configuration` JSONB, `charges` JSONB, self-referencing `parentInventoryItemId`
- [ ] **2.7** Define `CpqQuoteConfiguration` entity
- [ ] **2.8** Create `src/modules/cpq/ce.ts` with `CustomEntitySpec[]` for all 7 entities
- [ ] **2.9** Run `yarn generate` to update entity registry
- [ ] **2.10** Run `yarn db:generate` to create migration
- [ ] **2.11** Run `yarn db:migrate` to apply migration
- [ ] **2.12** Verify tables exist in database

### Phase 3: Seed Data

- [ ] **3.1** Create `src/modules/cpq/setup.ts` implementing `ModuleSetupConfig`
- [ ] **3.2** Implement `seedDefaults` — seed 14 data centres with capabilities
- [ ] **3.3** Seed 4 catalog products (GIX Access Port, Internet Peering, Mobile Peering, Cloud Connect)
- [ ] **3.4** Seed product attribute definitions for each product (including `pricing_model` for Cloud Connect)
- [ ] **3.5** Seed product charge definitions for each product (NRC + MRC for Access Port, tiered MRC for peering, flat/commit/overage for Cloud Connect)
- [ ] **3.6** Seed `gix_access_port_pricing` table with `priceColumns: [nrc, mrc]` and 42 entries
- [ ] **3.7** Seed `gix_internet_peering_pricing` table with 6 tier entries
- [ ] **3.8** Seed `gix_mobile_peering_pricing` table with 6 tier entries
- [ ] **3.9** Seed `gix_cloud_connect_pricing` table with `priceColumns: [flat_per_mb, commit_per_mb, overage_per_mb]` and ~90 entries
- [ ] **3.10** Implement `defaultRoleFeatures` granting `cpq.*` to admin and employee roles
- [ ] **3.11** Run `yarn generate` and test seeding on a fresh tenant

### Phase 4: Business Logic Services

- [ ] **4.1** Create `src/modules/cpq/services/cpqPricingService.ts` — implement `resolveProductCharges`
- [ ] **4.2** Implement charge applicability filtering (evaluate `applicabilityCondition`)
- [ ] **4.3** Implement flat pricing resolution (dimension lookup → `prices[priceColumnKey]`)
- [ ] **4.4** Implement per-unit pricing resolution (`unitPrice × quantity`)
- [ ] **4.5** Implement tiered pricing resolution (tier-filling algorithm)
- [ ] **4.6** Implement usage charge handling (return rate with `quantity: null` for informational display)
- [ ] **4.7** Implement `calculateQuoteTotal` with NRC/MRC/usage aggregation
- [ ] **4.8** Create `src/modules/cpq/services/cpqValidationService.ts` — implement `validateProductConfiguration`
- [ ] **4.9** Implement `validateChildOnParent` (bandwidth cap)
- [ ] **4.10** Implement `getAttributeOptions` (dynamic option filtering from data centre capabilities and pricing tables)
- [ ] **4.11** Implement `getParentRemainingCapacity`
- [ ] **4.12** Create `src/modules/cpq/services/cpqInventoryService.ts` — implement query methods
- [ ] **4.13** Implement `provisionFromOrder` for inventory creation from orders
- [ ] **4.14** Create `src/modules/cpq/di.ts` — register all 3 services in DI container
- [ ] **4.15** Create `src/modules/cpq/data/validators.ts` — Zod schemas for all API inputs
- [ ] **4.16** Write unit tests for pricing: flat, per-unit, tiered algorithms
- [ ] **4.17** Write unit tests for charge applicability filtering
- [ ] **4.18** Write unit tests for burstable Cloud Connect pricing (commit MRC + overage display)
- [ ] **4.19** Write unit tests for validation rules (port size constraints, bandwidth cap)

### Phase 5: API Routes

- [ ] **5.1** Create `/api/cpq/data-centres/route.ts` — CRUD via `makeCrudRoute`
- [ ] **5.2** Create `/api/cpq/pricing-tables/route.ts` — CRUD for pricing table headers
- [ ] **5.3** Create `/api/cpq/pricing-table-entries/route.ts` — CRUD for pricing entries
- [ ] **5.4** Create `/api/cpq/product-attributes/route.ts` — CRUD for attribute definitions
- [ ] **5.5** Create `/api/cpq/product-charges/route.ts` — CRUD for charge definitions
- [ ] **5.6** Create `/api/cpq/inventory/route.ts` — CRUD for inventory items
- [ ] **5.7** Create `/api/cpq/inventory/customer-items/route.ts` — Customer items lookup
- [ ] **5.8** Create `/api/cpq/cpq-quotes/configure/route.ts` — Quote configuration (multi-charge line creation)
- [ ] **5.9** Create `/api/cpq/cpq-quotes/price/route.ts` — Price preview (returns charges by type)
- [ ] **5.10** Run `yarn generate` to register all API routes
- [ ] **5.11** Test all API endpoints via curl or API docs

### Phase 6: Backend Pages — Admin Panel

- [ ] **6.1** Create Data Centres list page with `DataTable`
- [ ] **6.2** Create Data Centres detail page with `CrudForm`
- [ ] **6.3** Create Data Centres `page.meta.ts` with navigation config
- [ ] **6.4** Create Product Config list page showing products with CPQ configuration
- [ ] **6.5** Create Product Config detail page with Attributes tab + Charges tab
- [ ] **6.6** Create Product Config `page.meta.ts`
- [ ] **6.7** Create Pricing Tables list page
- [ ] **6.8** Create Pricing Tables detail page with dynamic entry grid (columns from `priceColumns`)
- [ ] **6.9** Create Pricing Tables `page.meta.ts`
- [ ] **6.10** Create Inventory list page with tree-style parent/child display
- [ ] **6.11** Create Inventory detail page with charge breakdown
- [ ] **6.12** Create Inventory `page.meta.ts`
- [ ] **6.13** Run `yarn generate` to register backend routes
- [ ] **6.14** Verify pages appear in sidebar navigation under "CPQ" group

### Phase 7: Customer Inventory Injection Widget

- [ ] **7.1** Create `src/modules/cpq/widgets/injection/customer-inventory/widget.ts` — widget definition
- [ ] **7.2** Create `src/modules/cpq/widgets/injection/customer-inventory/widget.client.tsx` — client component
- [ ] **7.3** Create `src/modules/cpq/widgets/injection-table.ts` — map widget to `customers.detail:tabs`
- [ ] **7.4** Run `yarn generate` to register injection widget and table
- [ ] **7.5** Navigate to a customer detail page and verify the "Inventory" tab appears

### Phase 8: Quoting Wizard

- [ ] **8.1** Create `src/modules/cpq/backend/cpq/quotes/new/page.tsx` — wizard shell with step navigation
- [ ] **8.2** Create `page.meta.ts` for the wizard page
- [ ] **8.3** Implement Step 1: Customer selection with search
- [ ] **8.4** Implement Step 2: Path selection (existing item vs new primary) with item count check
- [ ] **8.5** Implement Step 2a: Existing parent item selector with capacity visualization
- [ ] **8.6** Implement Step 3: Primary item configurator with dynamic attribute form
- [ ] **8.7** Implement Step 3 live charge preview showing NRC + MRC charges
- [ ] **8.8** Implement Step 4: Child item configurator with dynamic attribute form per product type
- [ ] **8.9** Implement Step 4 pricing model toggle for Cloud Connect (flat vs burstable) with charge switching
- [ ] **8.10** Implement Step 4 tiered pricing breakdown display
- [ ] **8.11** Implement Step 4 "Add Another Service" with capacity validation
- [ ] **8.12** Implement Step 5: Review summary with charges grouped by type (NRC / MRC / usage)
- [ ] **8.13** Wire "Create Quote" to POST `/api/cpq/cpq-quotes/configure` and navigate to quote detail
- [ ] **8.14** Run `yarn generate` and test the full wizard flow end-to-end

### Phase 9: Event Subscriber & Order Provisioning

- [ ] **9.1** Add `subscribers` array to module definition — listen for `sales.order.created`
- [ ] **9.2** Implement handler: check if order originated from CPQ quote, create inventory items with charge snapshots
- [ ] **9.3** Test: create CPQ quote → convert to order → verify inventory items created with correct charges

### Phase 10: i18n & Polish

- [ ] **10.1** Add all `cpq.*` translation keys to `src/i18n/en.json`
- [ ] **10.2** Add translations to `src/i18n/pl.json`, `es.json`, `de.json` (placeholder copies initially)
- [ ] **10.3** Review all pages for proper i18n key usage
- [ ] **10.4** Final `yarn generate` and `yarn typecheck`
- [ ] **10.5** Run `yarn lint` and fix any issues
- [ ] **10.6** Manual end-to-end test of the full flow:
  1. Seed data on fresh tenant
  2. View data centres, product config, pricing tables
  3. Verify pricing table shows NRC + MRC columns for Access Port
  4. Verify pricing table shows flat/commit/overage columns for Cloud Connect
  5. Create CPQ quote: new Access Port + Internet Peering (tiered) → verify NRC + MRC totals
  6. Create CPQ quote: add Cloud Connect (flat) to existing port → verify MRC calculation
  7. Create CPQ quote: add Cloud Connect (burstable) → verify commit MRC + overage usage charge displayed
  8. View quote in standard sales quotes list → verify lines show per-charge breakdown
  9. Convert quote to order → verify inventory items created with charge snapshots
  10. View inventory tab on customer detail page
  11. Verify bandwidth cap validation works when adding services to a full port

---

## Appendix A: Port Size to MB Mapping (GIX-specific)

| Port Size | Capacity (MB) |
|-----------|--------------|
| 1G | 1,000 |
| 10G | 10,000 |
| 100G | 100,000 |

This mapping is part of the GIX seed data and would be expressed in validation logic that reads the `port_size` attribute from the parent inventory item's configuration.

## Appendix B: Files Modified Outside `src/modules/cpq/`

| File | Change | Reason |
|------|--------|--------|
| `src/modules.ts` | Add `{ id: 'cpq', from: '@app' }` | Module registration |
| `src/i18n/en.json` | Add `cpq.*` keys | English translations |
| `src/i18n/pl.json` | Add `cpq.*` keys | Polish translations |
| `src/i18n/es.json` | Add `cpq.*` keys | Spanish translations |
| `src/i18n/de.json` | Add `cpq.*` keys | German translations |

No `@open-mercato/*` package files are modified. All `.mercato/generated/*` files are regenerated by `yarn generate`.

## Appendix C: Key Design Decisions

1. **Generic CPQ framework, not GIX-specific**: All product-specific knowledge is expressed as data (attributes, charges, pricing tables, validation rules). GIX products are seed data. Adding a new product — even from a completely different domain — requires only database records, not code changes.

2. **Multi-charge model with `CpqProductCharge`**: Instead of assuming "one product = one price," the charge entity allows a product to generate multiple independent charge lines (NRC setup fee, MRC recurring fee, usage-based overage). Each charge independently resolves its price from a pricing table. This models real-world telecom and SaaS pricing accurately.

3. **Named price columns in pricing tables**: Rather than creating separate pricing tables for NRC vs MRC (which would duplicate all dimension data), a single pricing table holds multiple named price columns (e.g., `{ nrc: 490, mrc: 450 }`). Each charge definition references a specific `priceColumnKey`. This keeps the admin UI clean (one table per product) while supporting multi-charge resolution.

4. **Applicability conditions on charges**: The `applicabilityCondition` JSONB on `CpqProductCharge` allows conditional charges. For Cloud Connect, the "flat bandwidth fee" only applies when `pricing_model == flat`, and "commit/overage fees" only when `pricing_model == burstable`. This is evaluated generically without product-specific code.

5. **Usage charges as informational on quotes**: Usage-based charges (like burstable overage) cannot be calculated at quote time because actual usage is unknown. The pricing engine returns the unit rate and a descriptive note; the quote line shows this as an informational charge with `quantity: null`. Actual billing happens via a separate usage reconciliation process.

6. **One `SalesQuoteLine` per charge**: Rather than cramming all charges into a single line, each charge becomes its own quote line with a `kind` of `charge_nrc`, `charge_mrc`, or `charge_usage`. This makes the standard sales quote view accurate without UI modifications.

7. **JSONB `configuration` on `SalesQuoteLine`**: The standard quote line's `configuration` field stores the CPQ charge breakdown, making it visible to the standard sales UI without any modifications.

8. **`CpqQuoteConfiguration` companion entity**: Holds quote-level CPQ state (path choice, selected parent, validation results) separately from per-line data. Enables wizard resume and audit trail.

9. **Injection widget for customer inventory**: Rather than modifying the customer detail page, the inventory tab is injected via the framework's injection widget system, respecting the open-close principle.

10. **Event-driven inventory provisioning**: Inventory items are created by subscribing to `sales.order.created` rather than hooking into order creation code, decoupling the CPQ module from the sales module.
