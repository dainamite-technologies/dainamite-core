# XD-187: Product Specification & Offering Implementation

## Summary

Introduce the **CpqProductSpecification** and **CpqProductOffering** entities — together they model the full product lifecycle from blueprint to sellable item.

- **CpqProductSpecification** is the blueprint: what attributes a product has, their types, dependencies, and the product's structural relationships with other products.
- **CpqProductOffering** is a sellable instance of a specification: design-time attribute values are fixed, charges are attached, and it's ready to be quoted.

This separation reflects a fundamental distinction between **what a product is** (specification) and **how it is sold** (offering).

### Relationship to Standard Open Mercato Entities

```
CatalogProduct                       (identity, naming, SKU, categories, tags)
  │
  ├── CatalogOffer                   (channel assignment + static pricing — standard commerce)
  │     └── CatalogProductPrice      (unit prices per channel/customer/promo)
  │
  └── CpqProductSpecification        (CPQ blueprint — attributes, dependencies, relationships)
        ├── CpqProductAttribute      (typed attributes with resolution_time: design_time / run_time)
        ├── CpqProductRelationship   (requires, excludes, parent_child)
        │
        └── CpqProductOffering       (sellable instance — design-time values + charges)
              └── CpqProductCharge   (commercial charges → CpqPricingTable)
```

**Key principles**:

- **CatalogProduct** remains the master record for identity, naming, SKU, tax, categories, and tags. Not modified by CPQ (R-GEN-2).
- **CpqProductSpecification** is a **companion entity** to `CatalogProduct` (R-GEN-4). One spec per product. Defines the configuration schema.
- **CpqProductOffering** is a specific sellable configuration of a spec. One spec can produce multiple offerings (e.g. "GIX Cloud Connect — AWS", "GIX Cloud Connect — GCP"). Charges live here, not on the spec.
- **CatalogOffer** (standard) handles channel assignment and static pricing. A `CpqProductOffering` may optionally reference a `CatalogOffer` to associate with a sales channel, but they are independent entities.
- Visual grouping and rendering of attributes during quoting is a concern of the **Workflow domain** — not the Product domain. The specification defines *what* can be configured; the workflow defines *how* it's presented.

### Design-Time vs Run-Time Attributes

Each attribute on a specification has a **resolution time**:

| Resolution Time | When resolved | Who resolves | Stored on | Example |
|-------|--------------|--------------|-----------|---------|
| `design_time` | When creating an offering from a spec | Product admin | `CpqProductOffering.designTimeValues` | Cloud provider (AWS/GCP/Azure), number type (geographic/mobile/toll-free) |
| `run_time` | During quoting/purchase | Customer / sales rep | `CpqQuoteConfiguration` / `CpqInventoryItem.configuration` | Bandwidth, data centre, origin countries, estimated volume |

Design-time attributes define the commercial identity of the offering — they determine which pricing tables and charges apply. Run-time attributes are what the customer configures during the quoting journey.

### Replacing v1 JSONB Extension Approach

The previous CPQ implementation (v1) stored product configuration knowledge in scattered locations:
- `CpqQuoteConfiguration.primaryItemConfiguration` / `childItemConfigurations` — JSONB blobs with untyped product config
- `CpqInventoryItem.configuration` — JSONB blob with resolved attribute values
- `CpqInventoryItem.charges` — JSONB array of charge snapshots
- Implicit product structure knowledge baked into quoting UI and API logic

**This spec replaces that pattern.** Product structure is explicitly defined in `CpqProductSpecification` and its related entities. The JSONB fields on runtime entities remain for storing **run-time configuration values** (what the user selected), but the **schema** of what can be configured is now in the specification.

**Domain**: Product (see `specs/domains/product.md`)
**Blueprint ref**: `specs/blueprint.md` — Domain #1

---

## Motivation

### Current State (v1)

- `CpqProductAttribute` and `CpqProductCharge` reference `productId` (catalog `CatalogProduct`) directly — no specification or offering layer.
- No entity captures relationships or structural constraints between products.
- Attribute dependencies are not modelled — the UI hard-codes GIX-specific logic (e.g. Cloud Connect region depends on provider).
- No distinction between design-time and run-time attributes — all attributes are treated equally.
- No `reference` attribute type — data centre selection is handled via a separate entity/API rather than as a generic attribute pointing to any Open Mercato entity.
- Product relationships (parent/child, requires, excludes) are implicit in quoting logic, not declared as data.
- No concept of product offering — charges are attached to the product directly, making it impossible to have different commercial configurations of the same product.

### Why This Matters Across Use Cases

| Capability | GIX (IX Operator) | NovaNET (Wholesale Carrier) | Nexio (CPaaS) |
|---|---|---|---|
| **Relationships** | Service requires Access Port; Port is parent of services | Local tail requires backbone circuit; Circuit is parent of segments | Inbound SMS/Voice requires Phone Number; APIs are standalone |
| **Design-time attrs** | (none — single offering per product) | Service level (Gold/Silver/Bronze), access technology | Cloud provider, number type, contract model (PAYG/commit) |
| **Run-time attrs** | Data centre, port size, bandwidth | A-End/Z-End locations, bandwidth | Direction, countries, estimated volume |
| **Multiple offerings** | 1 offering per product | 3 offerings per product (Gold/Silver/Bronze) | Multiple: per number type, per contract term |
| **Conditional charges** | Cloud Connect: flat vs burstable pricing model | Off-net: local tail MRC+NRC only if off-net location | 10DLC charges only if US + mobile number |

Without spec + offering, each new use case requires code changes. With it, they are purely configuration.

---

## Data Model

### New Entities

#### 1. CpqProductSpecification

The blueprint entity. One per catalog product. Defines the attribute schema and structural relationships.

**Table**: `cpq_product_specifications`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `product_id` | uuid | no | | FK to `CatalogProduct.id` (unique per org+tenant) |
| `code` | text | no | | Unique spec code (e.g. `gix-access-port`, `nexio-sms-api`) |
| `name` | text | no | | Display name |
| `description` | text | yes | | |
| `lifecycle_status` | text | no | `'draft'` | Enum: `draft`, `active`, `deprecated`, `retired` |
| `version` | integer | no | 1 | Spec version for change tracking |
| `effective_from` | timestamptz | yes | | When this spec version becomes active |
| `effective_to` | timestamptz | yes | | When this spec version expires |
| `metadata` | jsonb | yes | | Arbitrary extension data |
| `is_active` | boolean | no | true | Soft toggle |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:
- Unique: `(organization_id, tenant_id, product_id)` — one spec per product per tenant
- Unique: `(organization_id, tenant_id, code)` — unique code per tenant
- Index: `(organization_id, tenant_id, lifecycle_status)` — filter active specs

---

#### 2. CpqProductOffering

A sellable configuration of a specification. Created by filling in design-time attribute values and attaching charges.

**Table**: `cpq_product_offerings`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `spec_id` | uuid | no | | FK to `CpqProductSpecification.id` |
| `catalog_offer_id` | uuid | yes | null | Optional FK to `CatalogOffer.id` for channel assignment |
| `code` | text | no | | Unique offering code (e.g. `gix-cloud-connect-aws`, `nexio-number-mobile`) |
| `name` | text | no | | Display name (e.g. "GIX Cloud Connect — AWS") |
| `description` | text | yes | | |
| `design_time_values` | jsonb | no | `'{}'` | Resolved design-time attribute values as `Record<string, unknown>` |
| `lifecycle_status` | text | no | `'draft'` | Enum: `draft`, `active`, `deprecated`, `retired` |
| `effective_from` | timestamptz | yes | | |
| `effective_to` | timestamptz | yes | | |
| `metadata` | jsonb | yes | | |
| `is_active` | boolean | no | true | |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | |

**Indexes**:
- Unique: `(organization_id, tenant_id, code)` — unique offering code per tenant
- Index: `(organization_id, tenant_id, spec_id)` — find offerings for a spec
- Index: `(organization_id, tenant_id, lifecycle_status)` — filter active offerings

**Key design**: `design_time_values` stores the resolved values for all `design_time` attributes defined on the spec. For example, for "GIX Cloud Connect — AWS": `{ "cloud_provider": "aws" }`. This JSONB is validated against the spec's design-time attribute definitions on create/update.

---

#### 3. CpqProductRelationship

Declares structural relationships between product specifications.

**Table**: `cpq_product_relationships`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `source_spec_id` | uuid | no | | FK to `CpqProductSpecification.id` |
| `target_spec_id` | uuid | no | | FK to `CpqProductSpecification.id` |
| `relationship_type` | text | no | | Enum: `parent_child`, `requires`, `excludes` |
| `cardinality_min` | integer | no | 0 | Min number of target items (0 = optional) |
| `cardinality_max` | integer | yes | null | Max number of target items (null = unlimited) |
| `condition` | jsonb | yes | | Condition expression for when relationship applies |
| `metadata` | jsonb | yes | | |
| `is_active` | boolean | no | true | |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | |

**Indexes**:
- Unique: `(organization_id, tenant_id, source_spec_id, target_spec_id, relationship_type)`
- Index: `(organization_id, tenant_id, source_spec_id)`
- Index: `(organization_id, tenant_id, target_spec_id)`

**Use-case examples**:

| Source | Target | Type | Condition | Meaning |
|--------|--------|------|-----------|---------|
| GIX Access Port | GIX Internet Peering | `parent_child` | null | Port is parent, peering is child |
| GIX Internet Peering | GIX Access Port | `requires` | null | Peering service requires an access port |
| Nexio SMS API | Nexio Phone Numbers | `requires` | `{"attribute": "direction", "operator": "in", "value": ["inbound", "both"]}` | Inbound SMS requires a phone number |
| Nexio Video: SD Archive | Nexio Video: HD Archive | `excludes` | null | Archiving tiers are mutually exclusive |

---

### Modified Entities

#### 4. CpqProductAttribute (v2 changes)

Extend the existing entity with spec reference, resolution time, dependency support, and the `reference` attribute type. Remove group reference (visual grouping is a Workflow domain concern).

**New/changed columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `spec_id` | uuid | yes | null | FK to `CpqProductSpecification.id`. Replaces `product_id` as primary lookup. Nullable for backward compat during migration. |
| `resolution_time` | text | no | `'run_time'` | Enum: `design_time`, `run_time`. Determines when the attribute is resolved. |
| `attribute_type` | text | no | | Extended enum: `text`, `number`, `boolean`, `select`, `multi-select`, `reference` |
| `reference_entity` | text | yes | null | For `reference` type: entity name (e.g. `CpqDataCentre`, `Country`) |
| `reference_filter` | jsonb | yes | null | For `reference` type: filter criteria for the entity query |
| `depends_on` | jsonb | yes | null | Dependency declaration (see Attribute Dependencies below) |
| `default_value` | jsonb | yes | null | Default value for the attribute |
| `help_text` | text | yes | null | Tooltip/help text for UI |

**Removed from previous draft**: `group_id`, `visibility_condition` — these are Workflow domain concerns.

**New indexes**:
- Index: `(organization_id, tenant_id, spec_id)` — lookup by spec
- Index: `(organization_id, tenant_id, spec_id, resolution_time)` — lookup design_time vs run_time attrs

**Migration note**: Existing attributes with `product_id` remain valid. The migration will:
1. Add `spec_id`, `resolution_time`, and new columns as nullable (with `resolution_time` defaulting to `run_time`)
2. Backfill `spec_id` from auto-created specifications for existing products
3. Existing queries by `product_id` continue to work; new queries use `spec_id`

---

#### 5. CpqProductCharge (v2 changes)

**Charges now belong to offerings, not specifications.** A charge defines a commercial element of a specific sellable offering.

**New/changed columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `offering_id` | uuid | yes | null | FK to `CpqProductOffering.id`. Primary lookup for v2. Nullable for backward compat. |
| `fixed_price` | numeric | yes | null | Fixed price for simple charges not needing a pricing table |
| `currency_code` | text | yes | null | Currency for `fixed_price`. Inherits from pricing table if null. |
| `description` | text | yes | null | User-facing charge description |

**Existing `product_id`** remains for backward compat. New charges should use `offering_id`.

**New indexes**:
- Index: `(organization_id, tenant_id, offering_id)` — lookup by offering

**Migration note**: Existing charges with `product_id` remain valid. New charges use `offering_id`. The backfill migration creates default offerings for existing products and links charges to them.

---

### Entity Relationship Diagram

```
CatalogProduct (existing, @open-mercato/core)
      │
      │ 1:1 companion
      ▼
CpqProductSpecification ──── N:M ──► CpqProductRelationship (source/target)
      │
      ├── 1:N ──► CpqProductAttribute (with resolution_time: designtime | runtime)
      │
      └── 1:N ──► CpqProductOffering (design_time_values filled in)
                        │
                        ├── 1:N ──► CpqProductCharge (commercial charges)
                        │                │
                        │                │ (pricing_table_id)
                        │                ▼
                        │           CpqPricingTable (existing)
                        │
                        └── opt ──► CatalogOffer (channel assignment)
```

---

## Design-Time / Run-Time Examples

### GIX Cloud Connect

**Spec** (`gix-cloud-connect`):
- Design-time attributes: `cloud_provider` (select: AWS, GCP, Azure)
- Run-time attributes: `region` (select, depends on `cloud_provider`), `bandwidth` (number), `pricing_model` (select: flat, burstable)

**Offerings created from spec**:

| Offering code | Design-time values | Charges |
|---|---|---|
| `gix-cloud-connect-aws` | `{ "cloud_provider": "aws" }` | MRC flat (→ pricing table filtered by AWS), MRC commit, Usage overage |
| `gix-cloud-connect-gcp` | `{ "cloud_provider": "gcp" }` | MRC flat (→ pricing table filtered by GCP), MRC commit, Usage overage |
| `gix-cloud-connect-azure` | `{ "cloud_provider": "azure" }` | MRC flat (→ pricing table filtered by Azure), MRC commit, Usage overage |

At quoting time, the user selects an offering (e.g. "Cloud Connect — AWS"), then fills in run-time attributes (region, bandwidth, pricing model).

### Nexio Phone Numbers

**Spec** (`nexio-phone-numbers`):
- Design-time attributes: `number_type` (select: geographic, mobile, toll_free, short_code)
- Run-time attributes: `country` (reference: Country, depends on `number_type` for availability), `quantity` (number)

**Offerings**:

| Offering code | Design-time values | Charges |
|---|---|---|
| `nexio-number-geographic` | `{ "number_type": "geographic" }` | MRC rental $1.00/mo |
| `nexio-number-mobile` | `{ "number_type": "mobile" }` | MRC rental $1.50/mo, conditional 10DLC charges (if country=US) |
| `nexio-number-toll-free` | `{ "number_type": "toll_free" }` | NRC setup $5.00, MRC rental $3.50/mo |
| `nexio-number-short-code` | `{ "number_type": "short_code" }` | NRC setup $1000, MRC rental $1000/mo |

### GIX Access Port

**Spec** (`gix-access-port`):
- Design-time attributes: (none)
- Run-time attributes: `data_centre` (reference: CpqDataCentre), `port_size` (select, depends on `data_centre`)

**Offerings**: Single offering since there are no design-time attributes:

| Offering code | Design-time values | Charges |
|---|---|---|
| `gix-access-port` | `{}` | NRC setup, MRC monthly (both → port pricing table) |

When a spec has no design-time attributes, there is still exactly one offering — it just has empty `design_time_values`.

---

## Attribute Dependencies

Attribute dependencies allow one attribute's available options to be constrained by the current value of another attribute (R-PROD-4). Dependencies can span across resolution times — a `run_time` attribute can depend on a `design_time` attribute (whose value is fixed on the offering).

### Dependency Schema

The `depends_on` field on `CpqProductAttribute` uses a structured JSON schema:

```typescript
interface AttributeDependency {
  /** Code of the attribute this depends on */
  attributeCode: string

  /** How the dependency affects this attribute */
  effect: 'filter_options' | 'set_value' | 'toggle_required'

  /** Mapping rules: parent value -> constrained options/values */
  rules: DependencyRule[]
}

interface DependencyRule {
  /** Condition on the parent attribute */
  when: {
    operator: 'eq' | 'neq' | 'in' | 'not_in' | 'any'
    value: string | string[]
  }
  /** Effect payload */
  then: {
    /** For filter_options: allowed option values */
    options?: string[]
    /** For set_value: forced value */
    value?: string | number | boolean
    /** For toggle_required: new state */
    state?: boolean
  }
}
```

### Cross-resolution-time dependency example

**GIX Cloud Connect — `region` (run-time) depends on `cloud_provider` (design-time)**:

```json
{
  "attributeCode": "cloud_provider",
  "effect": "filter_options",
  "rules": [
    {
      "when": { "operator": "eq", "value": "aws" },
      "then": { "options": ["eu-west-2", "eu-west-1", "eu-central-1", "us-east-1", "us-west-2"] }
    },
    {
      "when": { "operator": "eq", "value": "gcp" },
      "then": { "options": ["europe-west2", "europe-west1", "europe-west3", "us-east1", "us-west1"] }
    }
  ]
}
```

When resolving run-time attributes for an offering, the engine merges the offering's `design_time_values` into the evaluation context. So for the "Cloud Connect — AWS" offering, `cloud_provider = "aws"` is already known, and the `region` attribute is automatically filtered to AWS regions.

### Same-resolution-time dependency example

**GIX Access Port — `port_size` (run-time) depends on `data_centre` (run-time)**:

```json
{
  "attributeCode": "data_centre",
  "effect": "filter_options",
  "rules": [
    { "when": { "operator": "eq", "value": "equinix-ld8" }, "then": { "options": ["1G", "10G"] } },
    { "when": { "operator": "eq", "value": "telehouse-south" }, "then": { "options": ["1G"] } },
    { "when": { "operator": "eq", "value": "equinix-ld5" }, "then": { "options": ["1G", "10G", "100G"] } }
  ]
}
```

---

## Reference Attributes

The `reference` attribute type (R-PROD-3) allows an attribute to point to any Open Mercato entity rather than using a static options list.

### Configuration

```typescript
// "data_centre" on GIX Access Port — reference to CpqDataCentre entity
{
  code: 'data_centre',
  name: 'Data Centre',
  attributeType: 'reference',
  resolutionTime: 'run_time',
  referenceEntity: 'CpqDataCentre',
  referenceFilter: { isActive: true },
}

// "country" on Nexio Phone Numbers — reference to Country entity
{
  code: 'country',
  name: 'Country',
  attributeType: 'reference',
  resolutionTime: 'run_time',
  referenceEntity: 'Country',
  referenceFilter: { codes: ['US', 'GB', 'CA', 'DE', ...] },
}
```

### Resolution

The `getConstrainedAttributes` service method resolves reference attributes by:
1. Querying the referenced entity (scoped by org/tenant)
2. Applying `referenceFilter` criteria
3. Applying `depends_on` rules if the reference attribute has dependencies
4. Returning `{ value: entity.id, label: entity.name }` option pairs

---

## API Design

All APIs are scoped by `organizationId` + `tenantId` (from auth context). All APIs follow the existing pattern in `src/modules/cpq/api/`.

### Product Specification APIs

#### `GET /api/cpq/product-specifications`

List product specifications with filtering.

| Param | Type | Description |
|-------|------|-------------|
| `lifecycleStatus` | string | Filter by status (default: `active`) |
| `hasRelationshipType` | string | Filter specs that have a given relationship type |
| `search` | string | Search by name or code |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Items per page (default: 25) |

#### `GET /api/cpq/product-specifications/:id`

Get a single specification with full structure: attributes (both resolution times), relationships, and offerings.

**Response**:

```typescript
{
  id: string
  productId: string
  product: { id: string, name: string, code: string }
  code: string
  name: string
  description: string | null
  lifecycleStatus: string
  version: number

  attributes: CpqProductAttribute[]      // Flat list, sorted by sortOrder. Each has resolutionTime field.
  offerings: CpqProductOffering[]        // Each with their charges

  // Resolved relationships (structured, not raw edges)
  parentSpecs: Array<{ specId: string, code: string, name: string, productId: string }>
  childSpecs: Array<{ specId: string, code: string, name: string, productId: string, cardinalityMin: number, cardinalityMax: number | null }>
  requiredSpecs: Array<{ specId: string, code: string, name: string, productId: string, condition: object | null }>
  excludedSpecs: Array<{ specId: string, code: string, name: string, productId: string }>
}
```

#### `POST /api/cpq/product-specifications`

Create a new product specification.

```typescript
{
  productId: string
  code: string
  name: string
  description?: string
  lifecycleStatus?: 'draft' | 'active'
  effectiveFrom?: string
  effectiveTo?: string
  metadata?: Record<string, unknown>
}
```

**Feature**: `cpq.specifications.manage`

#### `PUT /api/cpq/product-specifications/:id`

Update. Cannot change `productId` after creation. Cannot retire if active inventory items exist.

#### `DELETE /api/cpq/product-specifications/:id`

Soft-delete. Cannot delete if active inventory items exist.

---

### Product Offering APIs

#### `GET /api/cpq/product-offerings`

List offerings with filtering.

| Param | Type | Description |
|-------|------|-------------|
| `specId` | string | Filter by specification |
| `lifecycleStatus` | string | Filter by status (default: `active`) |
| `search` | string | Search by name or code |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Items per page (default: 25) |

#### `GET /api/cpq/product-offerings/:id`

Get a single offering with its charges and resolved spec info.

**Response**:

```typescript
{
  id: string
  specId: string
  spec: { id: string, code: string, name: string, productId: string }
  catalogOfferId: string | null
  code: string
  name: string
  description: string | null
  designTimeValues: Record<string, unknown>
  lifecycleStatus: string

  charges: CpqProductCharge[]
  // Run-time attributes inherited from spec (for reference)
  runTimeAttributes: CpqProductAttribute[]
}
```

#### `POST /api/cpq/product-offerings`

Create an offering from a specification.

```typescript
{
  specId: string
  catalogOfferId?: string               // Optional channel linkage
  code: string
  name: string
  description?: string
  designTimeValues: Record<string, unknown>  // Must satisfy all design_time attributes on the spec
  lifecycleStatus?: 'draft' | 'active'
  effectiveFrom?: string
  effectiveTo?: string
  metadata?: Record<string, unknown>
}
```

**Validation**:
- `designTimeValues` must contain a value for every required `design_time` attribute on the spec
- Each value must pass the attribute's type validation and constraint checks
- If the attribute has `depends_on`, the dependency rules are evaluated against other design-time values

**Feature**: `cpq.offerings.manage`

#### `PUT /api/cpq/product-offerings/:id`

Update. Cannot change `specId` after creation. `designTimeValues` can be updated if no active inventory items reference this offering.

#### `DELETE /api/cpq/product-offerings/:id`

Soft-delete. Cannot delete if active inventory items exist.

---

### Product Relationship APIs

#### `GET /api/cpq/product-relationships`

List relationships, filtered by `sourceSpecId` or `targetSpecId`.

#### `POST /api/cpq/product-relationships`

```typescript
{
  sourceSpecId: string
  targetSpecId: string
  relationshipType: 'parent_child' | 'requires' | 'excludes'
  cardinalityMin?: number
  cardinalityMax?: number | null
  condition?: object
}
```

**Validation**: source != target, no circular parent_child chains, excludes are auto-bidirectional.

#### `PUT /api/cpq/product-relationships/:id` | `DELETE /api/cpq/product-relationships/:id`

Standard update / soft-delete.

---

## Service Layer

### CpqProductSpecificationService

Registered in Awilix DI container as `cpqProductSpecificationService`.

```typescript
interface CpqProductSpecificationService {
  // Specification CRUD
  getSpecifications(params: ListParams): Promise<PaginatedResult<CpqProductSpecification>>
  getSpecification(id: string): Promise<SpecificationWithRelations>
  getSpecificationByProductId(productId: string): Promise<SpecificationWithRelations | null>
  getSpecificationByCode(code: string): Promise<SpecificationWithRelations | null>
  createSpecification(data: CreateSpecInput): Promise<CpqProductSpecification>
  updateSpecification(id: string, data: UpdateSpecInput): Promise<CpqProductSpecification>
  deleteSpecification(id: string): Promise<void>

  // Relationships
  getRelationships(specId: string): Promise<{ outgoing: Relationship[], incoming: Relationship[] }>
  getAllowedChildSpecs(specId: string): Promise<CpqProductSpecification[]>
  getAllowedParentSpecs(specId: string): Promise<CpqProductSpecification[]>
  getRequiredSpecs(specId: string, config: Record<string, unknown>): Promise<CpqProductSpecification[]>
  getExcludedSpecs(specId: string): Promise<CpqProductSpecification[]>
}
```

### CpqProductOfferingService

Registered as `cpqProductOfferingService`.

```typescript
interface CpqProductOfferingService {
  // Offering CRUD
  getOfferings(params: ListParams): Promise<PaginatedResult<CpqProductOffering>>
  getOffering(id: string): Promise<OfferingWithCharges>
  getOfferingsBySpecId(specId: string): Promise<CpqProductOffering[]>
  createOffering(data: CreateOfferingInput): Promise<CpqProductOffering>
  updateOffering(id: string, data: UpdateOfferingInput): Promise<CpqProductOffering>
  deleteOffering(id: string): Promise<void>

  // Design-time validation
  validateDesignTimeValues(specId: string, values: Record<string, unknown>): Promise<ValidationResult>

  // Runtime attribute resolution (consumed by Quoting domain, not exposed as API)
  getConstrainedAttributes(offeringId: string, currentConfig: Record<string, unknown>, context?: Record<string, unknown>): Promise<ConstrainedAttribute[]>
  resolveReferenceOptions(attribute: CpqProductAttribute, filter?: Record<string, unknown>): Promise<Option[]>
  validateConfiguration(offeringId: string, config: Record<string, unknown>): Promise<ValidationResult>
}
```

### Changes to Existing Services

#### CpqPricingService

- Accept `offeringId` as primary lookup for charge resolution
- Load charges via `offering.charges` instead of `product_id` lookup
- Fallback to `product_id` for backward compat during migration

#### CpqValidationService

- Use `getConstrainedAttributes` for attribute validation
- Validate product relationships (required/excluded products) in quote context
- Validate product relationships (required/excluded) in quote context

#### CpqInventoryService

- Resolve offering from quote configuration to store `offering_id` on inventory items
- Use offering's design-time values + user's run-time values as the full configuration

---

## Migration Strategy

### Phase 1: Schema (non-breaking)

1. Create `cpq_product_specifications` table
2. Create `cpq_product_offerings` table
3. Create `cpq_product_relationships` table
4. Add new columns to `cpq_product_attributes`: `spec_id`, `resolution_time`, `reference_entity`, `reference_filter`, `depends_on`, `default_value`, `help_text`
5. Add new columns to `cpq_product_charges`: `offering_id`, `fixed_price`, `currency_code`, `description`

### Phase 2: Data backfill

1. For each distinct `productId` in `cpq_product_attributes` or `cpq_product_charges`:
   - Create a `CpqProductSpecification` with `lifecycleStatus: 'active'`
   - Set `code` and `name` from product's catalog data
2. For each created specification:
   - Create a single `CpqProductOffering` with empty `designTimeValues: {}`
   - Set `code` to `{spec.code}-default`, `name` to spec name
3. Backfill `spec_id` on all existing attributes (with `resolution_time: 'run_time'`)
4. Backfill `offering_id` on all existing charges (pointing to the default offering)

### Phase 3: API additions

1. Deploy specification, offering, relationship APIs
2. Deploy `getConstrainedAttributes` API
3. Existing APIs (`/api/product-attributes`, `/api/product-charges`) continue unchanged

### Phase 4: Service integration

1. Update `CpqPricingService` to prefer `offering_id`
2. Update `CpqValidationService` to use constrained attributes
3. Update quoting flow to select offering (not just product) and use relationships for structural validation

---

## Validation Rules

### Specification Validation

| Rule | Description |
|------|-------------|
| V-SPEC-1 | `code` must be unique within org+tenant |
| V-SPEC-2 | `productId` must reference an existing `CatalogProduct` |
| V-SPEC-3 | `productId` must be unique — one spec per product per org+tenant |
| V-SPEC-4 | `effectiveTo` must be after `effectiveFrom` if both set |

### Offering Validation

| Rule | Description |
|------|-------------|
| V-OFF-1 | `code` must be unique within org+tenant |
| V-OFF-2 | `specId` must reference an active `CpqProductSpecification` |
| V-OFF-3 | `designTimeValues` must contain a valid value for every required `design_time` attribute on the spec |
| V-OFF-4 | Each design-time value must pass type validation and constraints |
| V-OFF-5 | Design-time attribute dependencies must be satisfied within the design-time values |
| V-OFF-6 | `catalogOfferId` (if set) must reference an existing `CatalogOffer` for the same product |

### Relationship Validation

| Rule | Description |
|------|-------------|
| V-REL-1 | Source and target must be different specifications |
| V-REL-2 | No circular `parent_child` chains (A->B->C->A) |
| V-REL-3 | A spec cannot have conflicting relationships with the same target (e.g. both `requires` and `excludes`) |
| V-REL-4 | `cardinalityMin` must be >= 0 |
| V-REL-5 | `cardinalityMax` must be >= `cardinalityMin` if set |

### Attribute Dependency Validation

| Rule | Description |
|------|-------------|
| V-DEP-1 | `depends_on.attributeCode` must reference an existing attribute in the same spec |
| V-DEP-2 | No circular dependency chains |
| V-DEP-3 | `filter_options` rule values must be a subset of the attribute's defined options |
| V-DEP-4 | A `run_time` attribute may depend on a `design_time` or `run_time` attribute. A `design_time` attribute may only depend on another `design_time` attribute. |

---

## ACL / Feature Flags

Extend existing ACL in `src/modules/cpq/acl.ts`:

| Feature | Description |
|---------|-------------|
| `cpq.specifications.view` | View product specifications and their structure |
| `cpq.specifications.manage` | Create/update/delete specifications and relationships |
| `cpq.offerings.view` | View product offerings |
| `cpq.offerings.manage` | Create/update/delete offerings and their charges |

Existing `cpq.products.view` and `cpq.products.manage` remain for backward-compatible attribute and charge APIs.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/modules/cpq/data/entities.ts` | Modify | Add `CpqProductSpecification`, `CpqProductOffering`, `CpqProductRelationship`. Extend `CpqProductAttribute` and `CpqProductCharge`. |
| `src/modules/cpq/data/validators.ts` | Modify | Add Zod schemas for new entities and extended fields |
| `src/modules/cpq/services/cpqProductSpecificationService.ts` | Create | Specification + relationship service |
| `src/modules/cpq/services/cpqProductOfferingService.ts` | Create | Offering service with design-time validation and runtime attribute resolution |
| `src/modules/cpq/api/product-specifications.ts` | Create | Specification CRUD APIs |
| `src/modules/cpq/api/product-offerings.ts` | Create | Offering CRUD APIs |
| `src/modules/cpq/api/product-relationships.ts` | Create | Relationship CRUD APIs |
| `src/modules/cpq/services/cpqPricingService.ts` | Modify | Add `offering_id` lookup path |
| `src/modules/cpq/services/cpqValidationService.ts` | Modify | Use constrained attributes for validation |
| `src/modules/cpq/di.ts` | Modify | Register new services |
| `src/modules/cpq/acl.ts` | Modify | Add offering and specification features |
| `src/modules/cpq/migrations/Migration_...product_specification.ts` | Create | Schema changes + data backfill |
| `src/modules/cpq/backend/cpq/specifications/` | Create | Admin UI for managing specifications |
| `src/modules/cpq/backend/cpq/offerings/` | Create | Admin UI for managing offerings |

---

## Design Decisions

### DD-1: No `productType` on CpqProductSpecification

The specification does **not** carry a `productType` enum. The product's structural role is fully determined by its `CpqProductRelationship` records:

- A product **is a parent** if it has outgoing `parent_child` relationships
- A product **is a child** if it has incoming `parent_child` relationships
- A product **is standalone** if it has no `parent_child` relationships
- A product **can be both** parent and child simultaneously

Bundling (commercial packaging at a combined price) is a concern of offerings and will be addressed in a future enhancement.

### DD-2: CpqProductSpecification as companion, not JSONB extension

All CPQ product metadata lives in dedicated entities — not in JSONB metadata fields on `CatalogProduct`. Runtime JSONB fields on `CpqQuoteConfiguration` and `CpqInventoryItem` remain for storing user-selected values; the schema is in the specification.

### DD-3: Charges belong to offerings, not specifications

The specification defines the attribute schema (what CAN be configured). The offering defines the commercial terms (what it COSTS). This separation allows:
- Multiple offerings from the same spec with different pricing structures
- Design-time attribute values to influence which charges/pricing tables apply
- Clear lifecycle: spec is stable, offerings are commercial and may change more frequently

### DD-4: No attribute groups in Product domain

Visual presentation of attributes during quoting (grouping, section headers, collapsibility, conditional visibility of UI sections) is a **Workflow domain** concern. The product specification defines *what* can be configured and the data constraints. The workflow defines *how* it's presented to the user. This keeps the Product domain focused on data modelling and avoids coupling product definitions to UI layout.

### DD-5: Design-time vs run-time attribute resolution

Attributes carry a `resolution_time` that determines when they are resolved:
- `design_time`: resolved when creating an offering. Values are stored on `CpqProductOffering.designTimeValues`. These define the offering's commercial identity.
- `run_time` (default): resolved during quoting/purchase. Values are stored on quote configuration and inventory items.

A `run_time` attribute may depend on a `design_time` attribute (cross-resolution-time dependency). The `design_time` value is known at offering creation time and is automatically included in the evaluation context during quoting.

---

## Open Questions

1. **Attribute dependency vs Business Rules domain**: Simple dependencies (filter options based on parent value) are modelled in `depends_on`. Complex cross-product rules (bandwidth cannot exceed port size) remain in the Business Rules domain. Is this boundary clear enough? -> Yes

2. **Versioning strategy**: The spec has `version` and `effective_from/to` fields. Should we support multiple active versions of the same spec (e.g. grandfathered pricing for existing customers), or is one active version per product sufficient?  -> Future enhancement

3. **Reference attribute resolution performance**: For entities with many records (e.g. Countries), should we add server-side search/pagination to the reference option resolution, or is client-side filtering sufficient? -> We can keep it client-side for now.
