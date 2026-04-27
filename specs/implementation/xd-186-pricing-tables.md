# Price Engine — Pricing Tables

## Objective

Define the data structures and APIs for **pricing tables** — the source of truth from which the price engine resolves unit rates during quote calculation. A pricing table is a 2-dimensional (or multi-dimensional) matrix: rows are entries identified by dimension values; columns are named prices. The engine matches a product configuration against the dimensions and reads a price from the relevant column.

Pricing tables are **shared infrastructure** for the pricing engine. They have no pricing logic of their own; all algorithmic behaviour (flat, per-unit, tiered, volume) is declared on `CpqProductCharge` and executed by `DefaultCpqPricingService`.

> **Domain parent**: [Pricing Engine](pricing-engine.md)
> **Consumed by**: [Calculate Price API](calculate-price-api.md)
> **Entities**: `src/modules/cpq/data/entities.ts` — `CpqPricingTable`, `CpqPricingTableEntry`
> **Validators**: `src/modules/cpq/data/validators.ts` — `cpqPricingTableCreateSchema`, `cpqPricingTableEntryCreateSchema`
> **APIs**: `src/modules/cpq/api/pricing-tables/route.ts`, `src/modules/cpq/api/pricing-table-entries/route.ts`

---

## Entities

### CpqPricingTable

Stores the structure (schema) of a pricing matrix. Does not store price values directly — those live in `CpqPricingTableEntry`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | auto | Primary key |
| `organizationId` | UUID | yes | Tenant scope |
| `tenantId` | UUID | yes | Tenant scope |
| `code` | text | yes | Unique identifier within the tenant. Used for reference in setup/seed scripts. Unique constraint: `(organizationId, tenantId, code)` |
| `name` | text | yes | Human-readable display name |
| `dimensions` | jsonb | yes | Ordered array of dimension definitions: `[{ key, label }]`. Keys must match `dimensionValues` keys in entries |
| `priceColumns` | jsonb | yes | Array of price column definitions: `[{ key, label }]`. Keys must match the `prices` map keys in entries |
| `currencyCodeList` | jsonb | yes | Array of ISO 4217 currency codes supported by this table (e.g. `["USD", "EUR"]`). Each entry carries its own `currencyCode` matching one of these values |
| `isActive` | boolean | yes | Soft-enable flag. Intended to mark a table as inactive. **Note**: the engine does not currently filter by this field — see [G-PT-7](#g-pt-7-table-isactive-not-enforced-by-engine). Inactive tables are excluded from admin list responses only. |
| `createdAt` | timestamp | auto | |
| `updatedAt` | timestamp | auto | |
| `deletedAt` | timestamp | no | Soft-delete timestamp |

#### Dimension definition shape

```typescript
{
  key: string    // Attribute code used as the lookup key (e.g. "region", "service_tier")
  label: string  // Display label for the admin UI
}
```

#### Price column definition shape

```typescript
{
  key: string        // Identifier used in entry.prices and CpqProductCharge.priceColumnKey
  label: string      // Display label (e.g. "NRC", "MRC", "Overage Rate")
}
```

---

### CpqPricingTableEntry

Stores one row of a pricing table. Each row contains a combination of dimension values (the lookup key) and a map of prices (the output values).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | auto | Primary key |
| `organizationId` | UUID | yes | Tenant scope |
| `tenantId` | UUID | yes | Tenant scope |
| `pricingTableId` | UUID | yes | Parent table reference |
| `dimensionValues` | jsonb | yes | `Record<string, string>` — one key per table dimension. Values are strings (case-insensitive match at lookup time) |
| `tierNumber` | integer | no | Tier ordinal for tiered pricing tables. `null` for non-tiered tables |
| `rangeFrom` | numeric | no | Tier range lower bound (inclusive). Stored as text in DB (`numeric` type) |
| `rangeTo` | numeric | no | Tier range upper bound (inclusive). `null` means unbounded (last tier) |
| `currencyCode` | text | yes | ISO 4217 currency code for this entry (e.g. `'USD'`, `'EUR'`). Must match one of the values in the parent table's `currencyCodeList` |
| `prices` | jsonb | yes | `Record<string, number>` — one key per price column defined on the table |
| `createdAt` | timestamp | auto | |
| `updatedAt` | timestamp | auto | |
| `deletedAt` | timestamp | no | Soft-delete timestamp |

#### Database indexes

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_pricing_tables_scope_idx` | `organizationId, tenantId` | B-tree | Tenant scoping queries |
| `cpq_pricing_tables_code_unique` | `organizationId, tenantId, code` | Unique | Code uniqueness per tenant |
| `cpq_pricing_table_entries_scope_idx` | `organizationId, tenantId, pricingTableId` | B-tree | Entry list by table |
| `cpq_pricing_table_entries_dim_gin_idx` | `dimensionValues` | GIN | Fast JSONB containment queries on dimension values |

---

## Key Concepts

### Dimensions — the lookup key

Dimensions define the axes of the matrix. When the engine resolves a price, it takes the product configuration and matches it against `dimensionValues` on each entry. All dimensions must match for an entry to be selected.

- Match is **case-insensitive exact string comparison**: `String(config[dim.key]).toLowerCase() === String(entry.dimensionValues[dim.key]).toLowerCase()`
- All dimensions declared in `table.dimensions` must be present in every entry's `dimensionValues`
- Configuration attributes that are not declared as dimensions are ignored
- If no entry matches all dimensions, the charge returns `unitPrice: 0` (see [R-PT-5](#r-pt-5-no-match-returns-zero))

### Price columns — the output

Each entry holds a `prices` map. A charge reads a single value from this map using `CpqProductCharge.priceColumnKey`.

**One table, multiple charges**: A single pricing table can serve multiple charges by using different price column keys. For example, a table with dimensions `[region, service_tier]` can hold both an NRC and an MRC column — avoiding dimension duplication across two separate tables.

```
entry.prices = { "nrc": 500, "mrc": 120 }
  charge A (setup_fee):    priceColumnKey = "nrc"  → resolves 500
  charge B (monthly_fee):  priceColumnKey = "mrc"  → resolves 120
```

### Flat tables

One entry per unique dimension combination. The engine picks the matching entry and reads the price.

| region | service_tier | nrc | mrc |
|--------|-------------|-----|-----|
| eu-west | standard | 500 | 120 |
| eu-west | premium | 800 | 200 |
| us-east | standard | 450 | 100 |

### Tiered tables

Multiple entries per dimension combination, differentiated by `tierNumber`, `rangeFrom`, and `rangeTo`. The engine iterates entries sorted by `tierNumber` ascending and distributes the quantity across tiers.

> **Implementation constraint — uniform dimensionValues required**: The current tiered algorithm loads ALL active entries for the table and sorts them by `tierNumber` globally. It does **not** pre-filter by `dimensionValues` before distributing quantity. This means: if a tiered table contains entries for multiple dimension groups (e.g. `region=eu-west` and `region=us-east`), the algorithm mixes entries from both groups and produces incorrect totals. Until a pre-filtering step is added (see [Planned Enhancements](#planned-enhancements) item 9 and [G-PT-6](#g-pt-6-tiered-algorithm-ignores-dimension-values)), tiered tables must either have **no dimensions** (`dimensionValues: {}` for all entries) or have **all entries share the same single dimension value** (one region per table). If multi-dimension tiered pricing is needed, create a separate tiered table per dimension group and wire each with a distinct charge + applicability condition.

For a tiered table with a single fixed dimension set (only `eu-west` entries, one table per region):

| dimensionValues | tierNumber | rangeFrom | rangeTo | mrc |
|----------------|-----------|-----------|---------|-----|
| `{ "region": "eu-west" }` | 1 | 1 | 100 | 3.00 |
| `{ "region": "eu-west" }` | 2 | 101 | 500 | 2.50 |
| `{ "region": "eu-west" }` | 3 | 501 | null | 2.00 |

`rangeTo: null` signals the last (unbounded) tier.

> **Constraint**: There is currently no database-level uniqueness constraint on dimension values + tier number combinations within a table. Duplicate entries are possible and would cause non-deterministic pricing. Administrators must ensure uniqueness. See [Planned Enhancements](#planned-enhancements) item 1.

---

## Relationship to CpqProductCharge

The connection between a charge and a pricing table is defined on `CpqProductCharge`:

| Charge field | Purpose |
|-------------|---------|
| `pricingTableId` | Which table to look up prices from |
| `priceColumnKey` | Which column key in `entry.prices` to read |
| `pricingMethod` | Algorithm: `flat`, `per_unit`, `tiered`, `volume` |
| `quantityAttributeCode` | For `per_unit` and `tiered`: which config attribute holds the quantity |

**Multiple charges can reference the same table** using different `priceColumnKey` values, as long as the table's `priceColumns` defines those keys.

**A charge must reference a valid `priceColumnKey`** that exists in the table's `priceColumns` array. If the key is absent from a matched entry's `prices` map, the engine returns `0` (same as a missing entry).

---

## APIs

### Pricing Tables — `/api/cpq/pricing-tables`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.pricing.view` | List tables (paginated) or fetch a single table with embedded entries |
| `POST` | `cpq.pricing.manage` | Create a new pricing table |
| `PUT` | `cpq.pricing.manage` | Update an existing table |
| `DELETE` | `cpq.pricing.manage` | Soft-delete a table |

#### GET — list (no `?id`)

```
GET /api/cpq/pricing-tables?page=1&pageSize=50&code=<text>
```

Query parameters:

| Param | Required | Description |
|-------|----------|-------------|
| `page` | No | Default `1` |
| `pageSize` | No | Default `50`, max `100` |
| `code` | No | Exact match on `code` field |

Response: paginated list. Entries are **not** included in the list response — fetch by ID to get entries.

```typescript
{
  items: Array<{
    id: string; code: string; name: string
    dimensions: Array<{ key: string; label: string }>
    priceColumns: Array<{ key: string; label: string }>
    currencyCodeList: string[]; isActive: boolean
    createdAt: string; updatedAt: string
  }>
  total: number; page: number; pageSize: number; totalPages: number
}
```

#### GET — single with entries (`?id=<uuid>`)

```
GET /api/cpq/pricing-tables?id=<uuid>
```

Returns the table record plus all its entries embedded in an `entries` array.

```typescript
{
  id: string; code: string; name: string
  dimensions: Array<{ key: string; label: string }>
  priceColumns: Array<{ key: string; label: string }>
  currencyCodeList: string[]; isActive: boolean
  entries: Array<{
    id: string
    dimensionValues: Record<string, string>
    tierNumber: number | null
    rangeFrom: string | null   // stored as string (numeric DB type)
    rangeTo: string | null
    currencyCode: string
    prices: Record<string, number>
  }>
  createdAt: string; updatedAt: string
}
```

> **Note**: `rangeFrom` and `rangeTo` are returned as strings (the database `numeric` type serialises to string). Consumers must parse to `Number()` before arithmetic.

#### POST — create table

```
POST /api/cpq/pricing-tables
```

Validated by `cpqPricingTableCreateSchema`. Body:

```typescript
{
  code: string                  // min 1 char, unique per tenant
  name: string                  // min 1 char
  dimensions: Array<{ key: string; label: string }>
  priceColumns: Array<{ key: string; label: string }>
  currencyCodeList: string[]    // e.g. ['USD', 'EUR'] — at least one required
  isActive?: boolean            // default true
}
```

Response: `201 Created` with the created table (same shape as GET single, without `entries`).

#### PUT — update table

```
PUT /api/cpq/pricing-tables
```

Body: `{ id: string } & Partial<CreateBody>`. All fields optional except `id`. Returns updated table.

> **Warning**: Changing `dimensions` or `priceColumns` on a live table will break existing entries that were created under the old schema. Entries are not validated against the table schema. Prefer creating a new table version.

#### DELETE — soft-delete table

```
DELETE /api/cpq/pricing-tables
```

Body: `{ id: string }`. Sets `deletedAt`. Returns `{ success: true }`.

> **Warning**: Soft-deleting a table that is still referenced by active `CpqProductCharge` records will cause those charges to return `unitPrice: 0` silently (the engine cannot find the table). No referential integrity check is performed at delete time. See [Planned Enhancements](#planned-enhancements) item 2.

---

### Pricing Table Entries — `/api/cpq/pricing-table-entries`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.pricing.view` | List entries for a table (paginated) |
| `POST` | `cpq.pricing.manage` | Create one or multiple entries |
| `PUT` | `cpq.pricing.manage` | Update a single entry |
| `DELETE` | `cpq.pricing.manage` | Soft-delete a single entry |

#### GET — list entries

```
GET /api/cpq/pricing-table-entries?pricingTableId=<uuid>&page=1&pageSize=50
```

`pricingTableId` is **required**. Returns a 400 error if missing or not a valid UUID.

Response: paginated list of entries sorted by `createdAt` **descending** (newest first).

> **Note for tiered tables**: the default sort (newest first) means tier entries are returned in reverse creation order. Consumers that need tiers in ascending order must re-sort the response by `tierNumber` client-side. The engine always re-sorts by `tierNumber` internally, so price resolution is unaffected.

#### POST — create entries (single or bulk)

```
POST /api/cpq/pricing-table-entries
```

Accepts **a single object** or **an array of objects**. Bulk create is transactional — either all entries are created or none are (single flush).

Single body:

```typescript
{
  pricingTableId: string         // UUID of the parent table
  dimensionValues: Record<string, string>   // must cover all table dimensions
  tierNumber?: number | null     // required for tiered tables
  rangeFrom?: number | null      // required for tiered tables
  rangeTo?: number | null        // null = unbounded (last tier)
  currencyCode: string           // must match one of the parent table's currencyCodeList values
  prices: Record<string, number> // must include all priceColumnKeys
}
```

Bulk body: array of the above. Response for bulk: `{ items: [...] }` with status `201`.

> **Note**: `rangeFrom` and `rangeTo` are accepted as `number` in the request body (Zod schema) but stored as `string` in the database (`numeric` type). The API normalises them on write.

#### PUT — update entry

Body: `{ id: string } & Partial<CreateBody>`. `rangeFrom`/`rangeTo` normalisation applies as with POST.

#### DELETE — soft-delete entry

Body: `{ id: string }`. Returns `{ success: true }`.

---

## Requirements

### R-PT-1: Dimension Keys Must Be Consistent
All entries in a table must carry `dimensionValues` keys that match the table's `dimensions[].key` definitions. The API does not enforce this; the administrator is responsible for keeping entries consistent with the table schema.

### R-PT-2: Price Column Keys Must Be Consistent
All entries in a table must include all keys declared in `priceColumns[].key`. Missing keys in `entry.prices` resolve to `0` at engine lookup time rather than an error.

### R-PT-3: Code Uniqueness Per Tenant
`CpqPricingTable.code` is unique per `(organizationId, tenantId)`. Attempting to create a duplicate code returns a database constraint error.

### R-PT-4: Soft Delete Only
Both tables and entries use soft-delete (`deletedAt`). Hard deletion is not supported.

- **API list responses**: filter by `deletedAt: null` — soft-deleted records are excluded.
- **Engine table lookup**: uses `findOne` without a `deletedAt` filter; a table is excluded only if it cannot be found by `id` + tenant scope (i.e. if it was hard-deleted, which is not supported, or if its `id` changed).
- **Engine entry lookup**: filters by `deletedAt: null` — soft-deleted entries are excluded from all dimension matching and tiered calculations.

### R-PT-5: No Match Returns Zero
If no active entry matches the full dimension combination for a given configuration, the engine returns `unitPrice: 0` and `totalPrice: 0` for that charge. No error is thrown. See [R-CPRICE-6](calculate-price-api.md#r-cprice-6-graceful-missing-entry).

### R-PT-6: Currency Is Entry-Scoped
Each `CpqPricingTableEntry` carries its own `currencyCode`. The engine reads this value from the matched entry and assigns it to the resolved charge's `currencyCode`. A table may hold entries in multiple currencies (as declared in `currencyCodeList`); the currency ultimately used is the one on the matched entry.

### R-PT-7: Bulk Entry Creation Is Atomic
When the entries API receives an array, all entries are persisted in a single `em.flush()`. If any entry fails validation, no entries are written.

### R-PT-8: Tenant Isolation
All API queries filter by `organizationId` and `tenantId` from the authenticated session. Cross-tenant table or entry access is not possible through the API.

### R-PT-9: Tiered Entry Ordering
For tiered tables, entries must be created with `tierNumber` values reflecting the intended ascending order. The engine sorts by `tierNumber` at resolution time. Gaps in tier numbers are acceptable but `tierNumber` must be non-null for tiered tables.

### R-PT-10: One Table, Multiple Charges
A single pricing table may be referenced by multiple `CpqProductCharge` records using different `priceColumnKey` values. This is the preferred pattern to avoid duplicating dimension data.

---

## Error Responses

### Pricing Tables

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Body fails `cpqPricingTableCreateSchema` / `cpqPricingTableUpdateSchema` | `{ "error": "Validation error", "details": [...] }` |
| `400 Bad Request` | DELETE body missing `id` | `{ "error": "Missing id" }` |
| `401 Unauthorized` | No valid session or missing feature flag | `{ "error": "Unauthorized" }` |
| `404 Not Found` | GET/PUT/DELETE with unknown or deleted `id` | `{ "error": "Not found" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

### Pricing Table Entries

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | GET without valid UUID `pricingTableId` | `{ "error": "pricingTableId is required and must be a valid UUID" }` |
| `400 Bad Request` | Body fails entry schema | `{ "error": "Validation error", "details": [...] }` |
| `400 Bad Request` | DELETE body missing `id` | `{ "error": "Missing id" }` |
| `401 Unauthorized` | No valid session or missing feature flag | `{ "error": "Unauthorized" }` |
| `404 Not Found` | PUT/DELETE with unknown or deleted `id` | `{ "error": "Not found" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

---

## Examples

### Example 1 — Flat table: multi-column (NRC + MRC in one table)

One table with two dimensions (`region`, `service_tier`) and two price columns (`nrc`, `mrc`). Two charges on the same product (`setup_fee`, `monthly_fee`) both reference this table with different `priceColumnKey` values.

**Create table**

```json
POST /api/cpq/pricing-tables
{
  "code": "service-pricing",
  "name": "Service Pricing",
  "dimensions": [
    { "key": "region",       "label": "Region" },
    { "key": "service_tier", "label": "Service Tier" }
  ],
  "priceColumns": [
    { "key": "nrc", "label": "Setup Fee" },
    { "key": "mrc", "label": "Monthly Fee" }
  ],
  "currencyCodeList": ["USD"]
}
```

**Create entries (bulk)**

```json
POST /api/cpq/pricing-table-entries
[
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "eu-west", "service_tier": "standard" }, "currencyCode": "USD", "prices": { "nrc": 500, "mrc": 120 } },
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "eu-west", "service_tier": "premium"  }, "currencyCode": "USD", "prices": { "nrc": 800, "mrc": 200 } },
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "us-east", "service_tier": "standard" }, "currencyCode": "USD", "prices": { "nrc": 450, "mrc": 100 } },
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "us-east", "service_tier": "premium"  }, "currencyCode": "USD", "prices": { "nrc": 700, "mrc": 180 } }
]
```

**Charge wiring**

| Charge code | pricingTableId | priceColumnKey | pricingMethod |
|-------------|---------------|----------------|---------------|
| `setup_fee` | `<table-uuid>` | `nrc` | `flat` |
| `monthly_fee` | `<table-uuid>` | `mrc` | `per_unit` |

When the engine resolves `{ region: "eu-west", service_tier: "standard", quantity: 3 }`:
- `setup_fee` → entry matched, reads `prices.nrc = 500`, flat → `totalPrice: 500`
- `monthly_fee` → same entry, reads `prices.mrc = 120`, per_unit × 3 → `totalPrice: 360`

---

### Example 2 — Tiered table: quantity-based MRC

A table where the monthly rate depends on how many units are consumed, split across three tiers. The only dimension is `region` — all tiers share the same dimension match.

**Create table**

```json
POST /api/cpq/pricing-tables
{
  "code": "tiered-unit-pricing",
  "name": "Tiered Unit Pricing",
  "dimensions": [
    { "key": "region", "label": "Region" }
  ],
  "priceColumns": [
    { "key": "mrc", "label": "Monthly Rate" }
  ],
  "currencyCodeList": ["USD"]
}
```

**Create entries**

```json
POST /api/cpq/pricing-table-entries
[
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "eu-west" }, "tierNumber": 1, "rangeFrom": 1,   "rangeTo": 100,  "currencyCode": "USD", "prices": { "mrc": 3.00 } },
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "eu-west" }, "tierNumber": 2, "rangeFrom": 101, "rangeTo": 500,  "currencyCode": "USD", "prices": { "mrc": 2.50 } },
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "eu-west" }, "tierNumber": 3, "rangeFrom": 501, "rangeTo": null, "currencyCode": "USD", "prices": { "mrc": 2.00 } }
]
```

**Engine resolution for quantity = 150, region = eu-west**

| Tier | Range | Rate | Units consumed | Subtotal |
|------|-------|------|----------------|----------|
| 1 | 1–100 | $3.00 | 100 | $300 |
| 2 | 101–500 | $2.50 | 50 | $125 |
| Total | | avg $2.83/unit | 150 | **$425** |

---

### Example 3 — Conditional usage rate (overage)

A table used for a usage charge (overage). The rate varies by region. The charge has `chargeType: 'usage'` and `pricingMethod: 'per_unit'`, so the engine resolves `unitPrice` but returns `totalPrice: null`.

**Create table**

```json
POST /api/cpq/pricing-tables
{
  "code": "overage-rates",
  "name": "Overage Rates",
  "dimensions": [
    { "key": "region", "label": "Region" }
  ],
  "priceColumns": [
    { "key": "overage", "label": "Overage Rate" }
  ],
  "currencyCodeList": ["USD"]
}
```

**Entries**

```json
[
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "eu-west" }, "currencyCode": "USD", "prices": { "overage": 0.12 } },
  { "pricingTableId": "<table-uuid>", "dimensionValues": { "region": "us-east" }, "currencyCode": "USD", "prices": { "overage": 0.10 } }
]
```

**Charge wiring**

| Charge code | chargeType | pricingMethod | pricingTableId | priceColumnKey |
|-------------|-----------|---------------|---------------|----------------|
| `overage_fee` | `usage` | `per_unit` | `<table-uuid>` | `overage` |

Engine resolves `{ region: "eu-west" }` → `unitPrice: 0.12`, `quantity: null`, `totalPrice: null`. The rate appears in `totals.usageCharges`.

---

## Known Gaps and Limitations

### G-PT-1: No entry uniqueness constraint
No database-level uniqueness check exists for `(pricingTableId, dimensionValues, tierNumber)`. Duplicate entries for the same dimension combination will cause non-deterministic pricing (the engine uses `find().find()` which returns the first match in query order). See [Planned Enhancements](#planned-enhancements) item 1.

### G-PT-2: No referential integrity on delete
Soft-deleting a `CpqPricingTable` does not cascade to `CpqPricingTableEntry` records, nor check for referencing `CpqProductCharge` records. Orphaned entries and broken charges are possible. See item 2.

### G-PT-3: No versioned pricing (effectiveFrom/To)
`CpqPricingTable` has no date-range fields. All active entries are always in scope regardless of when the quote is created. Versioned pricing (R-PRICE-6 in the domain spec) is not implemented. See item 3.


### G-PT-5: `rangeFrom` / `rangeTo` type mismatch
These fields are stored as `text` in the database (PostgreSQL `numeric` type serialises to string) but accepted as `number` in the Zod schema. Consumers must parse the string response values with `Number()` before arithmetic. See item 4.

### G-PT-6: Tiered algorithm ignores dimension values
The `calculateTiered` method in `DefaultCpqPricingService` loads all active entries for a table and sorts them globally by `tierNumber`. It does **not** pre-filter entries by matching `dimensionValues` against the request configuration. As a result, a tiered table that contains entries for more than one dimension group (e.g. `region=eu-west` rows and `region=us-east` rows) will produce incorrect pricing — quantity will be distributed across the mixed set. Until this is fixed, tiered tables must contain entries with uniform (or empty) `dimensionValues`. See item 9 and [Planned Enhancements item 16 in Calculate Price API](calculate-price-api.md).

### G-PT-7: Table `isActive` not enforced by engine
The price engine resolves a pricing table with `findOne({ id, tenantId, organizationId })` and does not add an `isActive: true` filter. An inactive table (one with `isActive: false` but `deletedAt: null`) is still used for price resolution. The `isActive` flag on `CpqPricingTable` currently has no effect on the engine. To truly prevent a table from being used, it must be soft-deleted. See item 10.


---

## Planned Enhancements

| # | Enhancement | Requirement reference |
|---|-------------|----------------------|
| 1 | **Unique constraint on entries** - add DB uniqueness on `(pricingTableId, organizationId, tenantId, dimensionValues, tierNumber)` to prevent non-deterministic lookups | G-PT-1 |
| 2 | **Referential integrity on delete** - before soft-deleting a table, check for active `CpqProductCharge` references and return an error or cascade deactivation | G-PT-2 |
| 3 | **Versioned pricing** - add `effectiveFrom` and `effectiveTo` date fields to `CpqPricingTable`. Engine selects the version effective at quote creation time | R-PRICE-6 |
| 4 | **Consistent numeric types** - align `rangeFrom`/`rangeTo` to `decimal` or `float` in the API response instead of string serialisation | G-PT-5 |
| 5 | **Schema validation on entry create** - validate that `dimensionValues` keys match the table's `dimensions[].key` array and `prices` keys match `priceColumns[].key` | R-PT-1, R-PT-2 |
| 6 | **Bulk update and delete** - entries API currently supports bulk create only. Add bulk PUT and bulk DELETE for efficient table editing | _(usability)_ |
| 7 | **Import/export** - support CSV import for pricing tables to allow bulk data entry from spreadsheets | _(usability)_ |
| 9 | **Tiered dimension pre-filter** - add dimension matching step in `calculateTiered` to filter entries by `dimensionValues` before distributing quantity across tiers. Until then, tiered tables must have uniform dimensionValues | G-PT-6 |
| 10 | **Enforce table isActive in engine** - add `isActive: true` to the `findOne` query in `calculateCharge` so that deactivating a table immediately removes it from price resolution without requiring soft-deletion | G-PT-7 |