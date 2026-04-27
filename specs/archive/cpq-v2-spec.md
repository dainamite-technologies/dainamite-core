# CPQ Module v2 — Specification

This document specifies the second iteration of the CPQ (Configure, Price, Quote) module for Open Mercato. The goal is a **generic, reusable CPQ engine** that can model any configurable product catalog — not tied to a specific vertical.

> **Context**: v1 (see `cpq-spec.md`) was a working prototype with hard-coded GIX telecom logic. v2 extracts the generic patterns into a proper engine with typed attributes, pluggable business rules, flexible pricing, and reference attributes.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Product Model](#2-product-model)
3. [Attribute System](#3-attribute-system)
4. [Charge Model](#4-charge-model)
5. [Pricing Tables](#5-pricing-tables)
6. [Business Rules Engine](#6-business-rules-engine)
7. [Data Model — Entities](#7-data-model--entities)
8. [Services](#8-services)
9. [Admin UI](#9-admin-ui)
10. [Migration from v1](#10-migration-from-v1)
11. [GIX Reference Implementation](#11-gix-reference-implementation)

---

## 1. Design Principles

1. **Generic over specific** — The engine knows nothing about telecom, data centres, or bandwidth. All domain knowledge lives in product configuration and business rules.
2. **Configuration as data, rules as code** — Product structure (attributes, charges, pricing tables) is data stored in the database. Business rules are TypeScript classes registered in DI and referenced by product configuration.
3. **Open Mercato native** — Uses MikroORM entities, Awilix DI, the module system, and existing catalog/sales infrastructure. No external dependencies.
4. **Composable** — Products can have relationships (parent/child, dependencies, bundles). Rules can compose and chain.

---

## 2. Product Model

A **CPQ Product** extends the existing Open Mercato catalog `Product` entity. The CPQ layer adds:

| Concept | Description |
|---------|-------------|
| **Attributes** | Typed configuration parameters the user fills in when ordering |
| **Charges** | Pricing components attached to the product (one-time, recurring, usage) |
| **Pricing Tables** | Multi-dimensional lookup tables used to resolve charge prices |
| **Business Rules** | Code-based rules attached to the product for validation, constraints, eligibility |
| **Product Relationships** | Declared dependencies between products (requires, excludes, parent-child) |

### Product Types

Products have a `productType` to control behavior:

| Type | Description |
|------|-------------|
| `standalone` | Independent product, no parent required |
| `parent` | Can have child products attached |
| `child` | Must be attached to a parent product |
| `bundle` | Composite product grouping multiple sub-products |

### Product Configuration Entity

Rather than adding columns to the catalog `Product`, a separate `CpqProductConfig` entity links to a catalog product and holds all CPQ-specific settings:

```
CpqProductConfig
├── productId          → FK to catalog Product
├── productType        → standalone | parent | child | bundle
├── allowedParentProducts  → UUID[] (if child — which parent products it can attach to)
├── allowedChildProducts   → UUID[] (if parent — which child products can attach)
├── rules              → RuleBinding[] (references to rule classes + config)
├── maxQuantity        → number | null (max instances per quote/order)
└── metadata           → JSONB (extensible)
```

---

## 3. Attribute System

Attributes define the **configurable parameters** of a product. Each attribute has a type that determines validation, UI rendering, and storage.

### Attribute Types

| Type | Value stored | Description |
|------|-------------|-------------|
| `text` | `string` | Free text input |
| `number` | `number` | Numeric input with optional min/max/step |
| `boolean` | `boolean` | Toggle/checkbox |
| `select` | `string` | Single selection from a list of options |
| `multi-select` | `string[]` | Multiple selections from a list of options |
| `reference` | `string` (UUID) | Reference to an Open Mercato entity |

### Attribute Definition

```
CpqProductAttribute
├── productId            → FK to catalog Product
├── code                 → string (unique per product, used in rules/pricing)
├── name                 → string (display label)
├── attributeType        → text | number | boolean | select | multi-select | reference
├── isRequired           → boolean
├── isReadOnly           → boolean (computed/derived attributes)
├── defaultValue         → JSONB | null
├── sortOrder            → number
├── groupCode            → string | null (for UI grouping)
├── groupLabel           → string | null
├── constraints          → AttributeConstraints (type-specific validation)
├── isActive             → boolean
└── metadata             → JSONB
```

### Attribute Constraints (by type)

```typescript
// Number constraints
{
  min?: number;
  max?: number;
  step?: number;
  unit?: string;        // e.g. "MB", "GB", "units"
}

// Text constraints
{
  minLength?: number;
  maxLength?: number;
  pattern?: string;     // regex
}

// Select / Multi-select constraints
{
  options: Array<{
    value: string;
    label: string;
    isDefault?: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

// Reference constraints
{
  entityName: string;       // MikroORM entity name e.g. "CpqDataCentre", "CloudRegion"
  displayField: string;     // field to show in UI e.g. "name"
  valueField: string;       // field to store as value, defaults to "id"
  filters?: Record<string, unknown>;  // static filters e.g. { isActive: true }
  searchFields?: string[];  // fields for search/autocomplete
}
```

### Attribute Groups

Attributes can be grouped using `groupCode` / `groupLabel` for organizing the configuration form into logical sections (e.g. "Connection Details", "Billing Options").

---

## 4. Charge Model

Charges define the **pricing components** of a product. A product can have multiple charges (e.g. setup fee + monthly fee + usage fee).

### Charge Types

| Type | Code | Description |
|------|------|-------------|
| One-time (Non-Recurring) | `nrc` | Charged once at purchase/activation |
| Recurring | `mrc` | Charged on a regular cycle (monthly, annually, etc.) |
| Usage | `usage` | Charged based on metered consumption |

### Charge Models (Pricing Methods)

| Model | Code | Description |
|-------|------|-------------|
| Flat | `flat` | Fixed price, regardless of quantity |
| Per Unit | `per_unit` | Price multiplied by quantity |
| Tiered | `tiered` | Different price per unit at each tier bracket (each tier has its own rate) |
| Volume | `volume` | Single rate applied to all units, determined by which tier the total quantity falls into |

#### Tiered vs Volume Example

For 150 units with tiers: 0-100 @ $10, 101-200 @ $8:

- **Tiered**: (100 × $10) + (50 × $8) = **$1,400**
- **Volume**: 150 × $8 = **$1,200** (all units at the tier that 150 falls into)

### Charge Entity

```
CpqProductCharge
├── productId                → FK to catalog Product
├── code                     → string (unique per product)
├── name                     → string (display label)
├── chargeType               → nrc | mrc | usage
├── chargeModel              → flat | per_unit | tiered | volume
├── pricingTableId           → FK to CpqPricingTable | null
├── priceColumnKey           → string | null (which column in the pricing table holds this charge's price)
├── quantityAttributeCode    → string | null (which product attribute drives quantity)
├── fixedPrice               → number | null (for simple flat charges not using a pricing table)
├── currencyCode             → string (default: USD)
├── billingCycle              → monthly | quarterly | annually | null (for mrc)
├── applicabilityCondition   → ApplicabilityCondition | null
├── sortOrder                → number
├── isActive                 → boolean
└── metadata                 → JSONB
```

### Applicability Conditions

A charge may only apply under certain configurations. The condition references attribute values:

```typescript
interface ApplicabilityCondition {
  operator: 'and' | 'or';
  conditions: Array<{
    attributeCode: string;
    op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'lt' | 'gte' | 'lte';
    value: unknown;
  }>;
}
```

Example: A "burstable overage" charge only applies when `pricing_model == 'burstable'`:
```json
{
  "operator": "and",
  "conditions": [
    { "attributeCode": "pricing_model", "op": "eq", "value": "burstable" }
  ]
}
```

---

## 5. Pricing Tables

Pricing tables are **multi-dimensional lookup structures** that map product configuration values to prices.

### Structure

A pricing table defines:
- **Dimensions**: The axes of the table (e.g. "data_centre", "port_size", "cloud_provider")
- **Price Columns**: The output values (e.g. "setup_price", "monthly_price")
- **Entries**: Rows in the table, each with dimension values and corresponding prices

### Pricing Table Entity

```
CpqPricingTable
├── code                → string (unique identifier)
├── name                → string (display label)
├── description         → string | null
├── productId           → FK to catalog Product | null (scoped to product, or shared)
├── dimensions          → DimensionDef[]
├── priceColumns        → PriceColumnDef[]
├── currencyCode        → string (default: USD)
├── effectiveFrom       → Date | null (for versioned pricing)
├── effectiveTo         → Date | null
├── isActive            → boolean
└── metadata            → JSONB
```

```typescript
interface DimensionDef {
  key: string;          // maps to attribute code or tier field
  label: string;
  type: 'attribute' | 'tier';  // 'attribute' = matches config value, 'tier' = range-based
}

interface PriceColumnDef {
  key: string;          // referenced by CpqProductCharge.priceColumnKey
  label: string;
  chargeType: 'nrc' | 'mrc' | 'usage';
}
```

### Pricing Table Entry Entity

```
CpqPricingTableEntry
├── pricingTableId      → FK to CpqPricingTable
├── dimensionValues     → Record<string, string | number> (keyed by dimension key)
├── tierNumber          → number | null (for tiered dimensions)
├── rangeFrom           → number | null
├── rangeTo             → number | null (null = infinity)
├── prices              → Record<string, number> (keyed by price column key)
├── isActive            → boolean
└── metadata            → JSONB
```

### Lookup Logic

1. Match entries where all `attribute`-type dimensions match the product configuration
2. For `tier`-type dimensions, find entries where quantity falls within `[rangeFrom, rangeTo]`
3. Apply charge model (flat/per_unit/tiered/volume) to resolve final price

---

## 6. Business Rules Engine

Business rules are **TypeScript classes** that implement specific rule interfaces. They are:

1. **Written as code** — extending abstract base classes
2. **Registered in DI** — available in the Awilix container
3. **Auto-discovered** — scanned from `src/modules/cpq/rules/` directory
4. **Bound to products** — product configuration references which rule classes apply

### Rule Types

| Type | Interface | Purpose |
|------|-----------|---------|
| **Product Rule** | `CpqProductRule` | Rules between products (requires, excludes, co-dependency) |
| **Configuration Rule** | `CpqConfigurationRule` | Rules that constrain attribute values based on other selections |
| **Eligibility Rule** | `CpqEligibilityRule` | Rules that determine if a product/option is available given context |
| **Pricing Rule** | `CpqPricingRule` | Rules that modify or override calculated pricing |

### Base Interfaces

```typescript
interface RuleContext {
  customerId: string;
  quoteId?: string;
  existingInventory: InventoryItem[];     // customer's current inventory
  currentConfiguration: ProductConfiguration;  // what user has selected so far
  allQuoteItems: QuoteItemConfiguration[];     // other items in the same quote
}

// --- Product Rules ---
// Control relationships between products in a quote/order

abstract class CpqProductRule {
  /** Unique identifier for this rule (used in product config bindings) */
  abstract readonly ruleId: string;
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Evaluate the rule and return violations (if any).
   * Called when validating the full quote/cart.
   */
  abstract evaluate(context: RuleContext): Promise<ProductRuleResult>;
}

interface ProductRuleResult {
  valid: boolean;
  violations: Array<{
    message: string;
    severity: 'error' | 'warning';
    relatedProductIds?: string[];
  }>;
  /** Products that should be auto-added based on this rule */
  requiredProducts?: Array<{
    productId: string;
    reason: string;
  }>;
}

// --- Configuration Rules ---
// Constrain attribute values dynamically based on selections

abstract class CpqConfigurationRule {
  abstract readonly ruleId: string;
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Given current selections, return constraints on attribute options.
   * Called on every attribute change to update available options in real-time.
   */
  abstract evaluate(context: RuleContext): Promise<ConfigurationRuleResult>;
}

interface ConfigurationRuleResult {
  attributeConstraints: Array<{
    attributeCode: string;
    /** Restrict available options to this subset */
    allowedValues?: Array<string | number>;
    /** Remove these specific options */
    disallowedValues?: Array<string | number>;
    /** Override min/max for number attributes */
    overrideMin?: number;
    overrideMax?: number;
    /** Set a computed value (for read-only/derived attributes) */
    setValue?: unknown;
    /** Custom message explaining the constraint */
    message?: string;
  }>;
}

// --- Eligibility Rules ---
// Determine if a product/option is available for a customer/context

abstract class CpqEligibilityRule {
  abstract readonly ruleId: string;
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Is this product eligible in the current context?
   * Called when loading the product catalog for a customer.
   */
  abstract evaluate(context: RuleContext): Promise<EligibilityRuleResult>;
}

interface EligibilityRuleResult {
  eligible: boolean;
  reason?: string;
}

// --- Pricing Rules ---
// Modify or override the price calculated by the pricing engine

abstract class CpqPricingRule {
  abstract readonly ruleId: string;
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Can modify the resolved charges (discounts, surcharges, overrides).
   * Called after standard pricing table lookup.
   */
  abstract evaluate(
    context: RuleContext,
    resolvedCharges: ResolvedCharge[],
  ): Promise<PricingRuleResult>;
}

interface PricingRuleResult {
  modifiedCharges: ResolvedCharge[];
  appliedAdjustments: Array<{
    chargeCode: string;
    adjustmentType: 'discount_pct' | 'discount_abs' | 'surcharge_pct' | 'surcharge_abs' | 'override';
    value: number;
    reason: string;
  }>;
}
```

### Rule Registration & Discovery

Rules are registered through two complementary mechanisms:

#### 1. Directory Auto-Discovery

Files in `src/modules/cpq/rules/` matching `*.rule.ts` are auto-scanned at module startup. Each file exports one or more rule classes:

```
src/modules/cpq/rules/
├── port-capacity.rule.ts         → PortCapacityConfigRule
├── service-requires-port.rule.ts → ServiceRequiresPortRule
├── datacenter-port-sizes.rule.ts → DatacenterPortSizesRule
└── bandwidth-eligibility.rule.ts → BandwidthEligibilityRule
```

#### 2. DI Registration

Rules are registered in `di.ts` as tagged services. Auto-discovered rules are registered automatically; additional rules can be registered manually:

```typescript
// In di.ts — manual registration example
container.register({
  myCustomRule: asClass(MyCustomRule).scoped().tag('cpq:rule'),
});
```

The rule engine collects all services tagged `cpq:rule` at startup.

### Binding Rules to Products

Product configuration references rules by `ruleId`. When the engine evaluates a product, it loads only the rules bound to that product:

```typescript
// In CpqProductConfig.rules (JSONB)
[
  {
    ruleId: 'datacenter-port-sizes',
    ruleType: 'configuration',
    config: {}    // optional rule-specific parameters
  },
  {
    ruleId: 'service-requires-port',
    ruleType: 'product',
    config: {}
  }
]
```

### Admin UI for Rule Binding

In the product configuration admin page, users can:
1. See all available rule classes (from DI registry) grouped by type
2. Select which rules apply to this product
3. Provide optional configuration parameters per rule binding

The UI shows `ruleId`, `name`, and `description` from each rule class — no need to display code.

---

## 7. Data Model — Entities

### Entity Changes from v1

| Entity | Change | Notes |
|--------|--------|-------|
| `CpqProductConfig` | **NEW** | Replaces implicit product-level config; holds productType, rules, relationships |
| `CpqProductAttribute` | **UPDATED** | Add `attributeType` enum, `groupCode/groupLabel`, `isReadOnly`, `defaultValue`. Restructure `constraints` by type |
| `CpqProductCharge` | **UPDATED** | Rename `pricingMethod` → `chargeModel`, add `volume` model, add `fixedPrice`, `billingCycle` |
| `CpqPricingTable` | **UPDATED** | Add `effectiveFrom/To` for versioned pricing |
| `CpqPricingTableEntry` | **UNCHANGED** | Already generic enough |
| `CpqInventoryItem` | **UNCHANGED** | Stays as-is for v2 |
| `CpqQuoteConfiguration` | **MINOR UPDATE** | Add `ruleViolations` field to store rule evaluation results |
| `CpqDataCentre` | **DEPRECATE** | Move to a generic "reference entity" approach — data centres become a standard OM entity referenced via `reference` attributes |

### New Entity: CpqProductConfig

```typescript
@Entity({ tableName: 'cpq_product_config' })
class CpqProductConfig {
  @PrimaryKey() id: string;                    // UUID
  @Property() organizationId: string;
  @Property() tenantId: string;
  @ManyToOne(() => Product) product: Product;  // FK to catalog product
  @Enum() productType: 'standalone' | 'parent' | 'child' | 'bundle';
  @Property({ type: 'jsonb', nullable: true })
  allowedParentProducts: string[];             // product IDs this can attach to
  @Property({ type: 'jsonb', nullable: true })
  allowedChildProducts: string[];              // product IDs that can attach to this
  @Property({ type: 'jsonb', nullable: true })
  rules: RuleBinding[];                        // rule references + config
  @Property({ nullable: true })
  maxQuantity: number | null;
  @Property({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;
  @Property() createdAt: Date;
  @Property({ onUpdate: () => new Date() }) updatedAt: Date;
  @Property({ nullable: true }) deletedAt: Date | null;
}

interface RuleBinding {
  ruleId: string;
  ruleType: 'product' | 'configuration' | 'eligibility' | 'pricing';
  config?: Record<string, unknown>;
}
```

### Updated: CpqProductAttribute

Key changes from v1:
- `attributeType` becomes a proper enum: `text | number | boolean | select | multi-select | reference`
- `options` field removed — options now live inside `constraints` (for select/multi-select types)
- `groupCode` / `groupLabel` added for UI grouping
- `isReadOnly` added for computed/derived attributes
- `defaultValue` added (JSONB)

### Updated: CpqProductCharge

Key changes from v1:
- `pricingMethod` renamed to `chargeModel`
- `volume` added as a new charge model option
- `fixedPrice` added for simple flat-price charges that don't need a pricing table
- `billingCycle` added for recurring charges
- `applicabilityCondition` structure updated to support more operators (`gt`, `lt`, `gte`, `lte`, `in`, `nin`)

---

## 8. Services

### CpqRuleEngine

Central service that orchestrates rule evaluation.

```typescript
class CpqRuleEngine {
  constructor(
    private ruleRegistry: CpqRuleRegistry,  // holds all discovered rules
    private em: EntityManager,
  ) {}

  /** Get all rules bound to a product, instantiated and ready */
  getRulesForProduct(productId: string, ruleType?: string): CpqRule[];

  /** Evaluate configuration rules → return constrained attribute options */
  evaluateConfigurationRules(context: RuleContext): Promise<ConfigurationRuleResult>;

  /** Evaluate product rules → return violations */
  evaluateProductRules(context: RuleContext): Promise<ProductRuleResult>;

  /** Evaluate eligibility rules → return eligible/ineligible */
  evaluateEligibilityRules(context: RuleContext): Promise<EligibilityRuleResult>;

  /** Evaluate pricing rules → return modified charges */
  evaluatePricingRules(context: RuleContext, charges: ResolvedCharge[]): Promise<PricingRuleResult>;
}
```

### CpqRuleRegistry

Collects and indexes all available rule classes.

```typescript
class CpqRuleRegistry {
  /** Register a rule class (called during module init / auto-discovery) */
  register(rule: CpqRule): void;

  /** Get all registered rules */
  getAll(): CpqRule[];

  /** Get rule by ID */
  getById(ruleId: string): CpqRule | undefined;

  /** Get rules by type */
  getByType(ruleType: string): CpqRule[];

  /** List available rules for admin UI (id, name, description, type) */
  listAvailable(): RuleDescriptor[];
}
```

### CpqPricingService (updated)

Changes from v1:
- Add `volume` charge model support
- Accept `RuleContext` to allow pricing rules to run post-calculation
- Delegate to `CpqRuleEngine.evaluatePricingRules()` after standard lookup

```typescript
class CpqPricingService {
  /** Resolve all charges for a product configuration */
  resolveProductCharges(
    productId: string,
    configuration: Record<string, unknown>,
    context: RuleContext,
  ): Promise<QuotePricingSummary>;
}
```

### CpqValidationService (updated)

Changes from v1:
- Remove all hard-coded domain logic (PORT_SIZE_TO_MB, etc.)
- Delegate to `CpqRuleEngine` for all dynamic validation
- Keep only generic attribute type validation (required, min/max, pattern)

```typescript
class CpqValidationService {
  /** Validate attribute values against type constraints */
  validateAttributes(
    productId: string,
    configuration: Record<string, unknown>,
  ): Promise<ValidationResult>;

  /** Full validation: attributes + rules */
  validateConfiguration(
    context: RuleContext,
  ): Promise<FullValidationResult>;
}
```

### CpqProductService (new)

Provides product catalog operations with CPQ awareness.

```typescript
class CpqProductService {
  /** Get product with full CPQ config (attributes, charges, rules) */
  getProductConfig(productId: string): Promise<FullProductConfig>;

  /** List products eligible for a customer/context */
  listEligibleProducts(context: RuleContext): Promise<EligibleProduct[]>;

  /** Get constrained attribute options for a product given current selections */
  getConstrainedAttributes(
    productId: string,
    currentSelections: Record<string, unknown>,
    context: RuleContext,
  ): Promise<ConstrainedAttribute[]>;

  /** List available child products for a parent */
  getAvailableChildProducts(parentProductId: string): Promise<Product[]>;
}
```

### Service DI Registration

```typescript
// di.ts
container.register({
  cpqRuleRegistry: asClass(CpqRuleRegistry).singleton(),
  cpqRuleEngine: asClass(CpqRuleEngine).scoped(),
  cpqPricingService: asClass(CpqPricingService).scoped(),
  cpqValidationService: asClass(CpqValidationService).scoped(),
  cpqProductService: asClass(CpqProductService).scoped(),
  cpqInventoryService: asClass(CpqInventoryService).scoped(),
});
```

---

## 9. Admin UI

### 9.1 Product Configuration Page (`/backend/cpq/products/[id]`)

Redesigned with tabs:

| Tab | Content |
|-----|---------|
| **General** | Product type, allowed parents/children, max quantity |
| **Attributes** | CRUD for product attributes with type-specific constraint editors |
| **Charges** | CRUD for product charges with charge model config |
| **Pricing** | Link to pricing tables, preview pricing table entries |
| **Rules** | Browse available rules, bind/unbind rules to product, configure rule parameters |

#### Attributes Tab Details

- List of attributes with drag-and-drop reordering
- Inline editing of attribute properties
- Type-specific constraint editor:
  - **text**: min/max length, pattern
  - **number**: min, max, step, unit label
  - **boolean**: default value
  - **select / multi-select**: option list editor (value + label pairs)
  - **reference**: entity picker (select from available OM entities), display field, filter config

#### Rules Tab Details

- Left panel: list of rules bound to this product (with remove button)
- Right panel: browse available rules from the registry, grouped by type
- Each available rule shows: `name`, `description`, `ruleType`
- "Add" button binds a rule to the product
- Optional config editor per rule binding (JSON editor or form if rule declares a config schema)

### 9.2 Pricing Tables Page (`/backend/cpq/pricing`)

Largely the same as v1, with additions:
- Date range display for `effectiveFrom/To`
- "Duplicate" action to clone a pricing table (for creating new versions)
- Import/export pricing table entries as CSV

### 9.3 Rules Overview Page (`/backend/cpq/rules`)

New page listing all registered rule classes:

| Column | Content |
|--------|---------|
| Rule ID | `ruleId` identifier |
| Name | Human-readable name |
| Type | product / configuration / eligibility / pricing |
| Description | What the rule does |
| Used By | Count of products using this rule |

This page is **read-only** — rules are code, not configurable data. It serves as documentation for admins.

### 9.4 Navigation Structure

```
CPQ (sidebar group)
├── Product Configuration    → /backend/cpq/products
├── Pricing Tables           → /backend/cpq/pricing
├── Business Rules           → /backend/cpq/rules
├── Inventory                → /backend/cpq/inventory
└── New Quote                → /backend/cpq/quotes/new
```

---

## 10. Migration from v1

### Database Migrations

1. Create `cpq_product_config` table
2. Alter `cpq_product_attribute`:
   - Add `attribute_type` column (enum), backfill from existing data
   - Add `group_code`, `group_label`, `is_read_only`, `default_value` columns
   - Migrate `options` into `constraints` JSON structure
   - Drop `options` column
3. Alter `cpq_product_charge`:
   - Rename `pricing_method` → `charge_model`
   - Add `volume` to charge model enum
   - Add `fixed_price`, `billing_cycle` columns
4. Alter `cpq_pricing_table`:
   - Add `effective_from`, `effective_to` columns
5. Alter `cpq_quote_configuration`:
   - Add `rule_violations` JSONB column
6. Migrate existing product data:
   - Create `CpqProductConfig` rows for existing products
   - Derive `productType` from existing parent/child relationships
   - Convert hard-coded validation logic to rule classes

### CpqDataCentre → Reference Entity

The v1 `CpqDataCentre` entity is domain-specific. In v2:
- Keep the entity (it works fine as a reference target)
- But it is no longer a "special" CPQ concept — it's just an entity that `reference` attributes point to
- The GIX use case creates `CpqDataCentre` records and configures a `reference` attribute pointing to it
- Other use cases would create their own reference entities

---

## 11. GIX Reference Implementation

The GIX telecom use case from v1 becomes the **seed/example** implementation demonstrating all v2 features:

### Products → CpqProductConfig

| Product | Type | Rules |
|---------|------|-------|
| GIX Access Port | `parent` | `datacenter-port-sizes` (configuration), `port-capacity-check` (product) |
| GIX Internet Peering | `child` (of Access Port) | `service-requires-port` (product), `bandwidth-limit` (configuration) |
| GIX Mobile Peering | `child` (of Access Port) | `service-requires-port` (product), `bandwidth-limit` (configuration) |
| GIX Cloud Connect | `child` (of Access Port) | `service-requires-port` (product), `bandwidth-limit` (configuration), `cloud-region-filter` (configuration) |

### Rule Classes

```
src/modules/cpq/rules/
├── datacenter-port-sizes.rule.ts
│   → CpqConfigurationRule: Constrains port_size options based on selected data_centre
│
├── service-requires-port.rule.ts
│   → CpqProductRule: Validates that child services are attached to an Access Port
│
├── bandwidth-limit.rule.ts
│   → CpqConfigurationRule: Constrains bandwidth max to not exceed parent port capacity
│
├── port-capacity-check.rule.ts
│   → CpqProductRule: Validates total child bandwidth doesn't exceed port size
│
└── cloud-region-filter.rule.ts
    → CpqConfigurationRule: Filters available regions based on selected cloud_provider
```

### Attributes (example: GIX Access Port)

| Code | Type | Constraints |
|------|------|-------------|
| `data_centre` | `reference` | entity: CpqDataCentre, display: name, filters: { isActive: true } |
| `port_size` | `select` | options: [1G, 10G, 100G] — dynamically constrained by `datacenter-port-sizes` rule |

### Attributes (example: GIX Cloud Connect)

| Code | Type | Constraints |
|------|------|-------------|
| `bandwidth` | `number` | min: 1, max: (dynamic via rule), step: 1, unit: MB |
| `cloud_provider` | `select` | options: [AWS, GCP, MS Azure] |
| `cloud_region` | `select` | options: (dynamic via `cloud-region-filter` rule) |
| `pricing_model` | `select` | options: [flat, burstable] |

### Charges (example: GIX Cloud Connect)

| Code | Type | Model | Pricing Table | Condition |
|------|------|-------|---------------|-----------|
| `flat_bandwidth` | mrc | per_unit | cloud-connect-pricing, col: `flat_price_per_mb` | `pricing_model == 'flat'` |
| `commit_bandwidth` | mrc | per_unit | cloud-connect-pricing, col: `commit_price_per_mb` | `pricing_model == 'burstable'` |
| `overage_bandwidth` | usage | per_unit | cloud-connect-pricing, col: `overage_price_per_mb` | `pricing_model == 'burstable'` |

---

## Summary of v1 → v2 Changes

| Area | v1 | v2 |
|------|----|----|
| Product config | Implicit in attributes/charges | Explicit `CpqProductConfig` entity |
| Attribute types | Generic text + JSONB options | Typed: text, number, boolean, select, multi-select, reference |
| Reference attributes | Hard-coded CpqDataCentre | Generic reference to any OM entity |
| Charge models | flat, tiered, per_unit | flat, tiered, per_unit, **volume** |
| Pricing | Tables only | Tables + `fixedPrice` for simple cases |
| Business rules | Hard-coded in validation service | **Code-based rules**: abstract classes, DI-registered, bound to products |
| Validation | Hard-coded PORT_SIZE_TO_MB | Delegated to rule engine |
| Admin UI | Basic product/pricing pages | Full config: attributes editor, charges editor, rule binding, rule browser |
| Pricing versioning | None | `effectiveFrom/To` on pricing tables |
