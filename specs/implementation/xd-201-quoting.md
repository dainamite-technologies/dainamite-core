# XD-201: Quoting Domain — Implementation Spec

## Summary

Evolve the quoting domain from the current v1 implementation to work with the **Product Specification & Offering** model (XD-187), the **Calculate Price API** (XD-187), **Pricing Tables** (XD-186), and **Price Rules** (XD-188). The quoting domain orchestrates the full CPQ flow: select an offering, configure run-time attributes, validate, price, and persist a structurally correct quote using standard Open Mercato `SalesQuote` / `SalesQuoteLine` entities.

> **Domain parent**: [Quoting](../domains/quoting.md)
> **Blueprint ref**: `specs/blueprint.md` — Domain #3
> **Dependencies**: XD-187 (Product Specification & Offering, Calculate Price API), XD-186 (Pricing Tables), XD-188 (Price Rules)
> **Existing implementation**: `src/modules/cpq/api/quotes/`, `src/modules/cpq/services/cpqPricingService.ts`, `src/modules/cpq/services/cpqValidationService.ts`
> **Out of scope**: Quote-to-order conversion (separate domain), wizard UI (Workflow domain), subscription/inventory management (future domain)

---

## Motivation

### Current State (v1)

The v1 quoting implementation works but has structural limitations:

1. **Product-centric, not offering-centric** — quotes reference `productId` directly. There is no concept of selecting an offering (a specific commercial configuration of a product). All charges are loaded by `productId`, not by `offeringId`.

2. **JSONB-blob configurations** — `CpqQuoteConfiguration` stores `primaryItemConfiguration` and `childItemConfigurations` as untyped JSONB blobs. There is no schema validation against the product specification's attribute definitions.

3. **No relationship enforcement** — the wizard hard-codes which products can be parents or children. Product relationships (`requires`, `excludes`, `parent_child`) defined in `CpqProductRelationship` (XD-187) are not evaluated.

4. **Validation is product-specific** — `DefaultCpqValidationService` has GIX-specific logic (port size capacities, data centre capabilities). It does not use the generic attribute dependency and constraint system from XD-187.

5. **No price rule integration** — the configure endpoint calls `resolveProductCharges()` which does not apply `CpqPriceRule` records (XD-188).

6. **Single-product parent assumption** — the wizard assumes exactly one primary product type. The v2 model supports multiple parent specifications with different offerings.

7. **Hard-coded parent context propagation** — `parentDataCentreCode` is a GIX-specific hook baked into the pricing engine. Context resolution should be the quoting domain's concern.

8. **Quote type constrains the quote** — `quoteType` (`new_primary`, `add_child`, `new_primary_with_children`) forces a single operation per quote. Real-world quotes mix operations.

9. **No quote lifecycle** — quotes have no CPQ-specific status progression beyond what the standard sales module provides.

10. **One charge = one quote line** — each resolved charge creates its own `SalesQuoteLine`. This fragments the quote document and makes it hard to see per-offering totals.

### What Changes

| Aspect | v1 | v2 |
|--------|----|----|
| Product selection | `productId` | `offeringId` (resolves spec + design-time values) |
| Attribute schema | Implicit, per-product custom logic | Defined on `CpqProductSpecification`, validated generically |
| Attribute options | `getAttributeOptions()` with product-specific branches | `getConstrainedAttributes()` from `CpqProductOfferingService` |
| Relationships | Hard-coded in wizard | `CpqProductRelationship` evaluated at runtime |
| Pricing | `resolveProductCharges(productId, config)` | `resolveProductCharges(offeringId, config, currencyCode)` with price rules |
| Context propagation | `parentDataCentreCode` (pricing engine concern) | Generic `quoteContext` (quoting domain concern, flat values passed to pricing) |
| Quote line structure | 1 charge = 1 `SalesQuoteLine` | 1 offering = 1 `SalesQuoteLine` with NRC/MRC/usage columns |
| Quote type | Fixed per quote (`new_primary`, `add_child`) | No type — lines carry `action` (`add`, `modify`, `cancel`) |
| Lifecycle | None (standard sales status only) | CPQ-specific: New → Incomplete → Ready → ... → Accepted/Rejected |
| Versioning | None | `version` field, clone increments |
| Validation + save | Invalid quotes not saved | Invalid quotes saved with status `Incomplete` |
| Currency | Derived from first charge | Quote-level `currencyCode` passed to pricing engine |

---

## Data Model

### Modified Entity: CpqQuoteConfiguration

The companion entity to `SalesQuote`. Evolves to drop quote-type constraints, add lifecycle, versioning, and generic context.

**New/changed columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `cpq_status` | text | no | `'new'` | CPQ lifecycle status. See [Quote Lifecycle](#quote-lifecycle). |
| `version` | integer | no | `1` | Quote version. Starts at 1; incremented on clone. |
| `parent_quote_id` | uuid | yes | null | FK to `CpqQuoteConfiguration.id` of the previous version (set when cloned) |
| `currency_code` | text | no | `'USD'` | Quote-level currency. Passed to pricing engine for all calculations. |
| `quote_context` | jsonb | yes | null | Generic context bag. See [Quote Context](#quote-context). |

**Columns to remove** (v1 concepts replaced by v2):

| Column | Reason |
|--------|--------|
| `quoteType` | Removed. Quotes are generic — line-level `action` replaces quote-level type. |
| `selectedParentInventoryItemId` | Removed. Inventory/subscription references are out of scope — future domain concern. |
| `primaryItemConfiguration` | Removed. Item configurations now live on `CpqQuoteLineConfiguration` (one per quote line). |
| `childItemConfigurations` | Removed. Same — each child is its own quote line with its own configuration entity. |

**Columns retained**:

| Column | Notes |
|--------|-------|
| `quoteId` | FK to `SalesQuote.id` |
| `customerId` | FK to customer entity |
| `validationResult` | Now includes relationship and dependency validation |
| `pricingSummary` | Now includes rule adjustment totals, discount/surcharge summaries |

### New Entity: CpqQuoteLineConfiguration

A companion entity to `SalesQuoteLine`. Stores the CPQ-specific configuration for each quote line (one offering = one quote line = one configuration).

**Table**: `cpq_quote_line_configurations`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `quote_line_id` | uuid | no | | FK to `SalesQuoteLine.id` (unique per org+tenant) |
| `quote_configuration_id` | uuid | no | | FK to `CpqQuoteConfiguration.id` (for fast lookup of all CPQ lines for a quote) |
| `offering_id` | uuid | yes | null | FK to `CpqProductOffering.id`. Primary lookup for v2. |
| `product_id` | uuid | yes | null | FK to `CatalogProduct.id`. v1 compat / catalog reference. |
| `spec_id` | uuid | yes | null | Denormalized from offering for validation. |
| `action` | text | no | `'add'` | Line action: `add`, `modify`, `cancel`. Only `add` supported in this implementation. |
| `parent_line_id` | uuid | yes | null | FK to `SalesQuoteLine.id`. Establishes parent-child hierarchy within the quote. |
| `start_date` | date | yes | null | Service start date for this line item |
| `term_months` | integer | yes | null | Contract term in months (e.g. 12, 24, 36). Passed to pricing engine as a dimension for term-based pricing. |
| `end_date` | date | yes | null | Service end date. Auto-calculated as `start_date + term_months` by default, but overridable for custom scenarios (e.g. co-termination with existing contracts). |
| `configuration` | jsonb | no | `'{}'` | Run-time attribute values selected by the user |
| `quantity` | integer | no | `1` | Offering instance count (e.g. 5× "Phone Number — Mobile"). Min 1. |
| `charges` | jsonb | yes | null | Array of `ResolvedCharge` objects for a **single instance** of the offering (full charge detail including adjustments). Per-instance breakdown — not multiplied by `quantity`. |
| `nrc_total` | numeric(18,4) | no | `0` | Sum of all NRC charges × `quantity`. Already multiplied. |
| `mrc_total` | numeric(18,4) | no | `0` | Sum of all MRC charges × `quantity`. Already multiplied. |
| `usage_estimates` | jsonb | yes | null | User-provided usage estimates per charge: `Array<{ chargeCode, estimatedQuantity, estimatedTotal }>`. Per-instance values — not multiplied by `quantity`. |
| `usage_total_estimated` | numeric(18,4) | yes | null | Sum of all `usage_estimates[].estimatedTotal` × `quantity`. Null if no estimates provided. |
| `validation_errors` | jsonb | yes | null | Per-line validation errors (attribute, relationship) |
| `is_configured` | boolean | no | `false` | Whether this line is fully and correctly configured (all required attributes set, constraints satisfied, relationships met, pricing resolved) |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:
- Unique: `(organization_id, tenant_id, quote_line_id)` — one CPQ config per quote line
- Index: `(organization_id, tenant_id, quote_configuration_id)` — all CPQ lines for a quote
- Index: `(organization_id, tenant_id, parent_line_id)` — find children of a line

**Design notes**:
- **Quantity model**: `charges` JSONB stores resolved charges for a **single instance** of the offering. The pricing engine is called once per offering, producing per-instance charges. The quoting domain then multiplies NRC and MRC totals by `quantity` to compute `nrc_total` and `mrc_total`. This keeps the pricing engine unaware of line quantity.
- **Usage estimates**: The pricing engine resolves usage charges with `quantity: null`, `totalPrice: null` and a `unitPrice` from the pricing table (as per XD-187). The user can optionally provide estimated quantities per usage charge (e.g. "~10,000 API calls/month"). The quoting domain computes `estimatedTotal = unitPrice × estimatedQuantity` per charge, stores them in `usage_estimates` JSONB, and rolls up `usage_total_estimated = sum(estimatedTotals) × lineQuantity`. These are explicitly user-driven estimates — not system-calculated.
- `parent_line_id` enables parent-child hierarchy within the quote, mirroring `CpqProductRelationship.parent_child` at the line level.
- `action` defaults to `add` for this implementation. Future MACD flows will add `modify` and `cancel` actions, where `modify` changes an existing subscription item and `cancel` cancels it.
- **Term and dates**: `start_date` and `term_months` are user-provided. `end_date` is auto-calculated as `start_date + term_months` when both are set and `end_date` is not explicitly provided. If `end_date` is explicitly set, it takes precedence (supports co-termination scenarios). `term_months` is included in the merged configuration passed to the pricing engine, enabling term-based pricing dimensions.

### Quote Line Mapping to SalesQuoteLine

Each offering on the quote produces **one `SalesQuoteLine`**. The standard entity's existing fields are mapped as follows:

| SalesQuoteLine field | CPQ mapping |
|---------------------|-------------|
| `kind` | `'product'` (standard kind — we no longer use `charge_nrc`/`charge_mrc`/`charge_usage`) |
| `productId` | `CatalogProduct.id` (resolved from offering → spec → product) |
| `name` | Offering name (e.g. "GIX Cloud Connect — AWS") |
| `quantity` | `CpqQuoteLineConfiguration.quantity` — offering instance count (e.g. 5) |
| `currencyCode` | Quote-level `currencyCode` |
| `unitPriceNet` | Per-instance `nrc + mrc` (single-instance total from `charges` JSONB) |
| `totalNetAmount` | `unitPriceNet × quantity` (equals `CpqQuoteLineConfiguration.nrc_total + mrc_total`) |
| `configuration` | JSONB with CPQ summary: `{ offeringId, offeringCode, action, nrcTotal, mrcTotal, usageSummary[] }` |
| `metadata` | JSONB with additional CPQ data if needed |

**Parent-child hierarchy**: `SalesQuoteLine` does not have a native `parentLineId` field. The parent-child relationship is tracked on `CpqQuoteLineConfiguration.parent_line_id`. The `SalesQuoteLine.configuration` JSONB includes `parentLineId` for consumers that read the standard entity without joining the companion.

> **Note**: The detailed charge breakdown (per-charge NRC, MRC, usage rates, tier breakdowns, rule adjustments) lives on `CpqQuoteLineConfiguration.charges` JSONB — not on `SalesQuoteLine`. The standard quote line shows the offering-level totals; the CPQ companion holds the detail.

---

## Quote Context

The quote carries a **generic context bag** that the quoting domain assembles from various sources and passes as flat key-value pairs to the pricing engine. The pricing engine has no knowledge of where these values come from — it only receives resolved values.

### Context Sources

| Source | Examples | When resolved |
|--------|----------|---------------|
| **Customer** | `customer_segment: "enterprise"`, `customer_country: "GB"` | At quote creation, from customer record |
| **Deal** | `deal_type: "renewal"`, `deal_tier: "gold"` | At quote creation, from linked deal (if any) |
| **Parent product** | `parent_data_centre_location: "London"`, `parent_port_size: "10G"` | When primary item is configured; derived from reference attribute resolution |
| **Subscription item** (future) | `existing_bandwidth: "1000"`, `current_plan: "premium"` | Future domain — from active subscription being modified |
| **Custom** | Any key-value pair | Set by the user, API caller, or business rules |

### Context Resolution Flow

```
1. Quote is created with customerId (and optionally dealId)
2. Quoting domain loads customer → extracts relevant attributes into quoteContext
3. If deal linked → extracts deal attributes into quoteContext
4. When primary item is configured:
   a. Resolve reference attributes (e.g. data_centre → city lookup)
   b. Inject derived values into quoteContext
5. When pricing any item (primary or child):
   a. Merge quoteContext into the item's configuration as additional key-value pairs
   b. Pass the merged configuration to resolveProductCharges()
   c. Pricing engine matches dimensions against all values (attribute + context) — it doesn't distinguish between them
```

### quoteContext schema

```typescript
// Stored on CpqQuoteConfiguration.quoteContext
type QuoteContext = Record<string, string | number | boolean>
```

The schema is intentionally loose — context keys are not predefined. The pricing engine performs case-insensitive string matching against dimension keys, so any context value that matches a pricing table dimension will participate in price resolution.

### Relationship to Pricing Engine

The pricing engine's `resolveProductCharges` method receives a single `configuration` object. The quoting domain is responsible for merging:

```typescript
const mergedConfig = {
  ...quoteContext,                    // Customer, deal, parent-derived values
  ...offeringDesignTimeValues,        // From CpqProductOffering.designTimeValues
  ...userRuntimeConfiguration,        // User-entered run-time attribute values
}

// Pricing engine sees a flat bag of values — no awareness of source
const charges = await pricingService.resolveProductCharges(offeringId, mergedConfig, scope)
```

The pricing engine does not resolve context. It does not call `CpqDataCentre`, customer APIs, or deal APIs. All enrichment is the quoting domain's responsibility.

---

## Quote Lifecycle

CPQ quotes follow a defined status progression stored on `CpqQuoteConfiguration.cpqStatus`.

### Statuses

| Status | Description |
|--------|-------------|
| `new` | Quote just created, no items configured yet |
| `incomplete` | Quote has items but validation errors exist (missing required attributes, relationship violations, pricing failures) |
| `ready` | All items are valid, priced, and the quote is ready for review |
| `in_approval` | Quote sent for internal approval (discount thresholds, non-standard configs) |
| `pre_approved` | Pre-approved by automated rules (within standard parameters) |
| `approved` | Approved by authorized approver |
| `with_customer` | Quote sent to the customer for review |
| `accepted` | Customer accepted the quote |
| `rejected` | Customer rejected the quote (or internally rejected during approval) |
| `cancelled` | Quote withdrawn before reaching a terminal decision (not rejected — simply abandoned or superseded) |

### Allowed Transitions

```
new → incomplete        (items added but validation fails)
new → ready             (items added and all valid)
incomplete → ready      (errors fixed via reconfigure)
incomplete → incomplete (reconfigure but still has errors)
ready → incomplete      (reconfigure introduced errors)
ready → in_approval
ready → pre_approved    (auto-approved — within standard parameters)
ready → with_customer   (skip approval if not required)
in_approval → approved
in_approval → rejected
pre_approved → with_customer
approved → with_customer
with_customer → accepted
with_customer → rejected
accepted → (terminal — triggers downstream processes)
rejected → (terminal — quote is archived)
cancelled → (terminal — quote is archived)
new → cancelled
incomplete → cancelled
ready → cancelled
in_approval → cancelled
with_customer → cancelled
```

### Auto-Status on Recalculate

When `recalculate` is called (see [Recalculate API](#recalculate-quote)):
- If validation passes → status set to `ready` (or remains `ready`)
- If validation fails → status set to `incomplete`
- If quote has no items → status set to `new`

Status transitions beyond `ready` (approval, customer review, acceptance) are triggered by explicit API calls, not by recalculate.

---

## Quote Line Action

Each `CpqQuoteLineConfiguration` carries an `action` field indicating what operation this line represents:

| Action | Description | Supported |
|--------|-------------|-----------|
| `add` | New offering being added to the customer's portfolio | **This implementation** |
| `modify` | Change to an existing subscription item (upgrade, downgrade, reconfig) | Future |
| `cancel` | Cancellation of an existing subscription item | Future |

For this implementation, all lines have `action: 'add'`. The field is present in the schema to establish the pattern for future MACD (Move, Add, Change, Cancel) flows.

> **Future**: `modify` and `cancel` actions will reference an existing subscription item ID. The quoting domain will calculate the delta (prorated charges, cancellation fees) by comparing the current subscription state with the requested change.

---

## Quote Versioning

Quotes support versioning for revision workflows:

| Field | Description |
|-------|-------------|
| `CpqQuoteConfiguration.version` | Integer, starts at `1` |
| `CpqQuoteConfiguration.parentQuoteId` | FK to the previous version's `CpqQuoteConfiguration.id` |

### Clone/Revision Flow

1. User requests a clone of quote v1
2. System creates a new `SalesQuote` with a new quote number
3. System creates a new `CpqQuoteConfiguration` with:
   - `version = parentVersion + 1`
   - `parentQuoteId = original CpqQuoteConfiguration.id`
   - `cpqStatus = 'new'`
   - Deep-copied `quoteContext`
4. System copies all `SalesQuoteLine` + `CpqQuoteLineConfiguration` records
5. System calls `recalculate(save: true)` on the new quote to reprice at current rates
6. The new quote may end up as `ready` or `incomplete` depending on whether the original configuration is still valid

The original quote is not modified. Both versions co-exist independently.

---

## Service Layer

### CpqQuotingService (new)

A new orchestration service that coordinates validation, pricing, relationship checks, and quote persistence. Replaces the inline logic currently in the configure route handler.

**Registration**: `cpqQuotingService` in Awilix DI container.

```typescript
interface CpqQuotingService {
  /**
   * Create a new CPQ quote for a customer.
   * Sets status to 'new', version to 1.
   */
  createQuote(input: CreateQuoteInput, scope: TenantScope): Promise<QuoteResult>

  /**
   * Add a quote line (offering) to an existing quote.
   * Validates relationships, prices the new item, recalculates totals.
   * Sets status to 'ready' or 'incomplete' based on validation.
   */
  addQuoteItem(quoteId: string, item: QuoteItemInput, scope: TenantScope): Promise<QuoteResult>

  /**
   * Update an existing quote line's configuration.
   * Re-validates, re-prices, recalculates totals.
   */
  updateQuoteItem(quoteId: string, lineId: string, configuration: Record<string, unknown>, scope: TenantScope): Promise<QuoteResult>

  /**
   * Remove a quote line. Validates that removal doesn't break relationships.
   * Recalculates totals.
   */
  removeQuoteItem(quoteId: string, lineId: string, scope: TenantScope): Promise<QuoteResult>

  /**
   * Recalculate the quote: re-validate all items, re-price at current rates,
   * recalculate totals. Optionally persist results.
   */
  recalculate(quoteId: string, options: { save: boolean }, scope: TenantScope): Promise<QuoteResult>

  /**
   * Clone a quote to create a new version.
   * Increments version, re-prices at current rates.
   */
  cloneQuote(quoteId: string, scope: TenantScope): Promise<QuoteResult>

  /**
   * Transition quote to a new lifecycle status.
   * Validates that the transition is allowed.
   */
  transitionStatus(quoteId: string, targetStatus: string, scope: TenantScope): Promise<QuoteResult>
}
```

#### CreateQuoteInput

```typescript
interface CreateQuoteInput {
  customerId: string
  dealId?: string                                 // Optional deal linkage
  currencyCode?: string                           // Default: 'USD'
  quoteContext?: Record<string, string | number | boolean>  // Initial context (auto-enriched from customer/deal)
}
```

#### QuoteItemInput

```typescript
interface QuoteItemInput {
  offeringId: string                              // v2: primary lookup
  productId?: string                              // v1 compat fallback
  configuration: Record<string, unknown>          // Run-time attribute values
  quantity?: number                               // Offering instance count. Default: 1. Min: 1.
  usageEstimates?: Array<{                        // Optional user-provided usage estimates
    chargeCode: string                            // Must match a usage charge on the offering
    estimatedQuantity: number                     // Expected consumption per instance (e.g. 10000 API calls)
  }>
  action?: 'add' | 'modify' | 'cancel'        // Default: 'add'. Only 'add' supported now.
  parentLineId?: string                           // FK to SalesQuoteLine.id for parent-child
  startDate?: string                              // ISO date. Service start date.
  termMonths?: number                             // Contract term in months (e.g. 12, 24, 36)
  endDate?: string                                // ISO date. Auto-calculated from startDate + termMonths if omitted; overridable.
}
```

#### QuoteResult

```typescript
interface QuoteResult {
  id: string                                      // CpqQuoteConfiguration.id
  quoteId: string                                 // SalesQuote.id
  quoteNumber: string                             // SalesQuote.quoteNumber
  customerId: string
  cpqStatus: string                               // Current lifecycle status
  version: number
  parentQuoteId: string | null
  currencyCode: string

  validationResult: {
    valid: boolean
    errors: ValidationError[]                     // Attribute, relationship, and rule errors
  }

  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{
      chargeCode: string
      chargeName: string                          // Populated by quoting domain: cross-references CpqQuoteLineConfiguration.charges by chargeCode to retrieve chargeName. Resolves the known gap in the pricing engine's totals.usageCharges (see XD-187 Planned Enhancement 9).
      unitPrice: number
      note: string | null                         // From ResolvedCharge.note — null when no usage description is set on the charge
    }>
    usageTotalEstimated: number | null            // Sum of all usage estimates across all lines. Null if no estimates.
    discountTotal: number                         // Total savings from discount rules: sum(abs(adjustment.delta) × chargeQuantity × lineQuantity) for adjustments where ruleType starts with 'discount_'. chargeQuantity = charge.quantity ?? 1 (null for usage charges).
    surchargeTotal: number                        // Total surcharge additions: sum(adjustment.delta × chargeQuantity × lineQuantity) for adjustments where ruleType starts with 'surcharge_'. Uses RuleAdjustment.delta from XD-188.
    currencyCode: string
  }

  lines: Array<{
    lineId: string                                // SalesQuoteLine.id
    offeringId: string | null
    offeringName: string
    productId: string | null
    action: string
    parentLineId: string | null
    quantity: number
    startDate: string | null
    termMonths: number | null
    endDate: string | null                        // Auto-calculated or overridden
    nrcTotal: number                              // Already multiplied by quantity
    mrcTotal: number                              // Already multiplied by quantity
    usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null
    usageTotalEstimated: number | null            // Sum of estimates × quantity
    charges: ResolvedCharge[]                     // Per-instance resolved charges
    isConfigured: boolean
    validationErrors: ValidationError[] | null
  }>
}
```

### Changes to CpqPricingService

| Change | Description |
|--------|-------------|
| `resolveProductCharges` accepts `offeringId` | Load charges via `CpqProductCharge` where `offeringId` matches. Fallback to `productId` for v1 compat. |
| `resolveProductCharges` accepts `currencyCode` | Quote-level currency passed through. Used to set `currencyCode` on resolved charges and validate that pricing tables match. |
| Price rules applied post-calculation | After all charges are resolved, load `CpqPriceRule` records (product-scoped + global), apply in `sortOrder` order per XD-188 spec. |
| No context resolution | The pricing service receives a flat `configuration` bag. It does **not** resolve customer data, deal data, parent product data, or any other context. That is the quoting domain's responsibility. |
| `ResolvedCharge` gains `adjustments` field | Populated by price rule application. See XD-188 `RuleAdjustment` type. |

### Changes to CpqValidationService

| Change | Description |
|--------|-------------|
| Offering-aware validation | Load spec via offering → spec relationship. Validate run-time attributes against spec definitions. |
| Generic attribute constraints | Use `CpqProductAttribute.depends_on` rules instead of hard-coded logic. |
| Reference attribute resolution | For `reference` type attributes, validate that the selected value exists in the referenced entity. |
| Relationship validation | Evaluate `CpqProductRelationship` records: enforce `requires`, block `excludes`, validate `parent_child` cardinality. |
| Design-time value merge | When validating run-time config, merge the offering's `designTimeValues` into the evaluation context for cross-resolution-time dependencies. |

#### Relationship Validation Detail

When recalculating a quote with multiple items, the service validates structural relationships:

```
For each line in the quote:
  1. Resolve the line's spec from its offering
  2. Load all CpqProductRelationship records where sourceSpecId = line's specId

  For each relationship:
    - parent_child: verify the parent spec is present in the quote (as the line's parentLineId target)
                    verify cardinality (min/max children of this type)
    - requires: verify the required spec is present in the quote (as any other line)
    - excludes: verify the excluded spec is NOT present in the quote
```

Validation errors are returned per-line on `CpqQuoteLineConfiguration.validation_errors`:

```typescript
{
  type: 'relationship'
  relationshipType: 'requires' | 'excludes' | 'parent_child'
  sourceSpec: string    // spec code
  targetSpec: string    // spec code
  message: string       // Human-readable explanation
}
```

---

## API Design

All APIs are scoped by `organizationId` + `tenantId` from auth context. All follow existing patterns in `src/modules/cpq/api/`.

### Create Quote — `POST /api/cpq/quotes`

Create a new empty CPQ quote.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.manage` |
| Side effects | Creates `SalesQuote` + `CpqQuoteConfiguration` |

**Request**:

```typescript
{
  customerId: string
  dealId?: string
  currencyCode?: string              // Default: 'USD'
}
```

**Business logic**:
1. Validate customer exists
2. Load customer record → extract context values (segment, country, etc.) into `quoteContext`
3. If `dealId` provided → load deal → extract context values into `quoteContext`
4. Create `SalesQuote` (standard entity) with customer snapshot
5. Create `CpqQuoteConfiguration` with `cpqStatus: 'new'`, `version: 1`, assembled `quoteContext`
6. Return `QuoteResult`

### Add Quote Item — `POST /api/cpq/quotes/:quoteId/items`

Add an offering to the quote as a new line.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.manage` |

**Request**:

```typescript
{
  offeringId: string
  productId?: string                 // v1 compat
  configuration: Record<string, unknown>
  action?: 'add'                     // Only 'add' supported for now
  parentLineId?: string              // For child items: FK to parent SalesQuoteLine.id
}
```

**Business logic** (delegated to `CpqQuotingService.addQuoteItem`):

1. Load the quote and its `CpqQuoteConfiguration`
2. Guard: quote must not be in a terminal status (`accepted`, `rejected`)
3. Resolve offering → spec → product
4. Merge context: `quoteContext` + `designTimeValues` + user `configuration`
5. Validate the item's configuration against spec attributes
6. Validate relationships against existing items in the quote
7. Price the item: call `resolveProductCharges(offeringId, mergedConfig, scope)` passing `currencyCode` from the quote
8. Create `SalesQuoteLine` with offering-level totals
9. Create `CpqQuoteLineConfiguration` with full charge detail
10. Recalculate quote-level totals and re-validate all relationships (adding an item may fix a `requires` violation on another item)
11. Update `cpqStatus`: `ready` if all lines `is_configured = true`, `incomplete` if any line `is_configured = false`
12. Persist and return `QuoteResult`

### Update Quote Item — `PUT /api/cpq/quotes/:quoteId/items/:lineId`

Update a quote line's configuration.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.manage` |

**Request**:

```typescript
{
  configuration: Record<string, unknown>
}
```

**Business logic**: Loads existing line, replaces configuration, re-validates, re-prices, recalculates quote totals. Updates `cpqStatus`.

### Remove Quote Item — `DELETE /api/cpq/quotes/:quoteId/items/:lineId`

Remove a line from the quote.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.manage` |

**Business logic**:
1. Soft-delete the `SalesQuoteLine` and `CpqQuoteLineConfiguration`
2. Also soft-delete any child lines whose `parentLineId` points to this line
3. Recalculate quote totals
4. Re-validate relationships (removal may introduce a `requires` violation on another item)
5. Update `cpqStatus`

### Recalculate Quote — `POST /api/cpq/quotes/:quoteId/recalculate`

Re-validate all items, re-price at current rates, recalculate totals. Replaces the old `calculatePreview` concept.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.view` (read-only when `save: false`), `cpq.quotes.manage` (when `save: true`) |
| Side effects | When `save: true`: updates `SalesQuoteLine` prices, `CpqQuoteLineConfiguration` charges, `CpqQuoteConfiguration` summary. When `save: false`: no writes. |

**Request**:

```typescript
{
  save: boolean                      // true = persist results, false = preview only
}
```

**Business logic** (delegated to `CpqQuotingService.recalculate`):

1. Load the quote with all lines and their CPQ configurations
2. For each line:
   a. Merge context: `quoteContext` + offering `designTimeValues` + line `configuration`
   b. Validate configuration against spec attributes
   c. Resolve charges: `resolveProductCharges(offeringId, mergedConfig, scope)` with quote `currencyCode`
   d. Apply price rules post-calculation
   e. Compute line-level NRC/MRC/usage totals
   f. Record per-line validation errors
3. Validate cross-line relationships
4. Aggregate quote-level totals: `nrcTotal`, `mrcTotal`, `usageCharges`, `discountTotal`, `surchargeTotal`
5. Determine `cpqStatus`:
   - No lines → `new`
   - Any line has `is_configured = false` → `incomplete`
   - All lines `is_configured = true` → `ready`
6. If `save: true` → persist all changes
7. Return `QuoteResult`

### Clone Quote — `POST /api/cpq/quotes/:quoteId/clone`

Create a new version of a quote.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.manage` |

**Business logic**:
1. Load existing quote + all lines
2. Create new `SalesQuote` with new quote number
3. Create new `CpqQuoteConfiguration`:
   - `version = original.version + 1`
   - `parentQuoteId = original.id`
   - `cpqStatus = 'new'`
   - Deep-copy `quoteContext`, `customerId`, `currencyCode`
4. Deep-copy all `SalesQuoteLine` + `CpqQuoteLineConfiguration` records (new IDs)
5. Call `recalculate(save: true)` on the new quote
6. Return `QuoteResult` for the new quote

### Transition Status — `POST /api/cpq/quotes/:quoteId/status`

Explicitly transition the quote to a new lifecycle status.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.manage` |

**Request**:

```typescript
{
  targetStatus: string
}
```

**Business logic**:
1. Validate the transition is allowed (see [Allowed Transitions](#allowed-transitions))
2. Additional guards:
   - `ready → in_approval`: quote must have `cpqStatus = 'ready'`
   - `→ with_customer`: quote must be `approved` or `pre_approved` (or `ready` if approval not required)
3. Update `CpqQuoteConfiguration.cpqStatus`
4. Return `QuoteResult`

### Get Constrained Attributes — `GET /api/cpq/quotes/attributes`

Returns available run-time attributes for an offering, with constraints applied based on current configuration state.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.view` |
| Side effects | None |

**Query parameters**:

| Param | Required | Description |
|-------|----------|-------------|
| `offeringId` | Yes* | The offering being configured |
| `productId` | Yes* | v1 compat fallback |
| `configuration` | No | URL-encoded JSON of current attribute values (for dependency resolution) |

\* One of `offeringId` or `productId` required.

**Response**:

```typescript
{
  attributes: Array<{
    code: string
    name: string
    attributeType: 'text' | 'number' | 'boolean' | 'select' | 'multi-select' | 'reference'
    isRequired: boolean
    sortOrder: number
    helpText: string | null

    // Constraint state (resolved based on current configuration)
    options?: Array<{ value: string; label: string }>
    constraints?: { min?: number; max?: number; step?: number }
    defaultValue?: unknown
    isDisabled?: boolean
    dependsOn?: string
  }>
}
```

### Validate Relationships — `POST /api/cpq/quotes/validate-relationships`

Check whether a set of offerings can co-exist on a quote.

| Property | Value |
|----------|-------|
| Auth required | Yes |
| Feature flag | `cpq.quotes.view` |
| Side effects | None |

**Request**:

```typescript
{
  offeringIds: string[]
  parentChildPairs?: Array<{ parentOfferingId: string; childOfferingId: string }>
}
```

**Response**:

```typescript
{
  valid: boolean
  errors: Array<{
    type: 'relationship'
    relationshipType: string
    sourceSpec: string
    targetSpec: string
    message: string
  }>
  allowedChildSpecs: Array<{
    specId: string
    code: string
    name: string
    productId: string
    cardinalityMin: number
    cardinalityMax: number | null
    currentCount: number
  }>
}
```

---

## Requirements Traceability

| Domain Requirement | Implementation |
|-------------------|----------------|
| R-QUOTE-1: Standard Entity Integration | `SalesQuote` + `SalesQuoteLine` used for persistence. `CpqQuoteConfiguration` and `CpqQuoteLineConfiguration` are companion entities only. |
| R-QUOTE-2: One Line Per Charge | **Changed**: one line per offering. Charges stored in companion JSONB. NRC/MRC/usage totals as separate fields on `CpqQuoteLineConfiguration`. |
| R-QUOTE-3: Full Validation Before Persist | **Changed**: quotes with validation errors are saved with `cpqStatus: 'incomplete'`. Only `ready` quotes can proceed to approval/customer. |
| R-QUOTE-4: Quote-Level Aggregation | `pricingSummary` aggregates `nrcTotal`, `mrcTotal`, `usageCharges`, `discountTotal`, `surchargeTotal` |
| R-QUOTE-5: Price Preview | `POST /api/cpq/quotes/:quoteId/recalculate` with `save: false` |
| R-QUOTE-6: Quote Cloning | `POST /api/cpq/quotes/:quoteId/clone` — deep-copy + version increment + re-price |
| R-QUOTE-7: Quote-to-Order | **Out of scope** — separate domain concern |
| R-GEN-1: Product Agnostic | All product knowledge comes from spec/offering/attribute data, not code. Context resolution is generic. |
| R-GEN-2: Open-Close Principle | No modifications to `@open-mercato/*` packages |
| R-GEN-3: Multi-Tenancy | All queries scoped by `organizationId` + `tenantId` |
| R-GEN-4: Standard Integration | Companion entity pattern: `CpqQuoteConfiguration` → `SalesQuote`, `CpqQuoteLineConfiguration` → `SalesQuoteLine` |
| R-GEN-5: Extensibility via DI | `CpqQuotingService` registered in Awilix, overridable |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Request body fails Zod validation | `{ "error": "Validation error", "details": [...ZodIssue] }` |
| `401 Unauthorized` | No valid session or missing feature flag | `{ "error": "Unauthorized" }` |
| `404 Not Found` | Quote, line, or offering not found | `{ "error": "Not found" }` |
| `409 Conflict` | Invalid status transition | `{ "error": "Cannot transition from '<current>' to '<target>'" }` |
| `422 Unprocessable Entity` | Status transition blocked by business rule (e.g. `incomplete` → `in_approval`) | `{ "error": "Quote must be in 'ready' status", "cpqStatus": "<current>" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

---

## ACL / Feature Flags

Existing flags are retained:

| Feature | Description |
|---------|-------------|
| `cpq.quotes.view` | View CPQ quotes, recalculate (preview), constrained attributes, relationship validation |
| `cpq.quotes.manage` | Create/update/delete/clone CPQ quotes, recalculate (persist), status transitions |

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/modules/cpq/data/entities.ts` | Modify | Add new columns to `CpqQuoteConfiguration` (`cpqStatus`, `version`, `parentQuoteId`, `currencyCode`, `quoteContext`). Remove `quoteType`, `selectedParentInventoryItemId`, `primaryItemConfiguration`, `childItemConfigurations`. Add new entity `CpqQuoteLineConfiguration`. |
| `src/modules/cpq/data/validators.ts` | Modify | New schemas: `cpqCreateQuoteSchema`, `cpqAddQuoteItemSchema`, `cpqUpdateQuoteItemSchema`, `cpqRecalculateSchema`, `cpqTransitionStatusSchema`. Remove old `cpqQuoteConfigureSchema`. |
| `src/modules/cpq/services/cpqQuotingService.ts` | Create | New orchestration service implementing `CpqQuotingService` interface |
| `src/modules/cpq/services/cpqPricingService.ts` | Modify | Add `offeringId` charge lookup path. Accept `currencyCode` parameter. Integrate price rule application from XD-188. Remove `parentDataCentreCode` logic. |
| `src/modules/cpq/services/cpqValidationService.ts` | Modify | Replace product-specific validation with generic spec-based validation. Add relationship validation. Use `getConstrainedAttributes` from offering service. |
| `src/modules/cpq/api/quotes/route.ts` | Create | New route for `POST /api/cpq/quotes` (create quote) |
| `src/modules/cpq/api/quotes/[quoteId]/items/route.ts` | Create | Routes for add/update/remove items |
| `src/modules/cpq/api/quotes/[quoteId]/recalculate/route.ts` | Create | Recalculate endpoint |
| `src/modules/cpq/api/quotes/[quoteId]/clone/route.ts` | Create | Clone endpoint |
| `src/modules/cpq/api/quotes/[quoteId]/status/route.ts` | Create | Status transition endpoint |
| `src/modules/cpq/api/quotes/attributes/route.ts` | Create | Constrained attributes endpoint |
| `src/modules/cpq/api/quotes/validate-relationships/route.ts` | Create | Relationship validation endpoint |
| `src/modules/cpq/api/quotes/configure/route.ts` | Remove | Replaced by new create + add item + recalculate flow |
| `src/modules/cpq/api/quotes/price/route.ts` | Remove | Replaced by recalculate endpoint |
| `src/modules/cpq/di.ts` | Modify | Register `cpqQuotingService` |
| `src/modules/cpq/ce.ts` | Modify | Add `cpq:cpq_quote_line_configuration` entry for entity discovery |
| `src/modules/cpq/migrations/Migration_...quoting_v2.ts` | Create | Schema changes: new columns, new table, column removals |

---

## Migration Strategy

### Phase 1: Schema (non-breaking)

1. Create `cpq_quote_line_configurations` table
2. Add new nullable columns to `cpq_quote_configurations`: `cpq_status`, `version`, `parent_quote_id`, `currency_code`, `quote_context`
3. Backfill `cpq_status = 'ready'` for existing quotes that have `pricingSummary` set; `'new'` for others
4. Backfill `version = 1` for all existing quotes
5. Backfill `currency_code = 'USD'` for all existing quotes

### Phase 2: Service layer

1. Create `CpqQuotingService` as orchestration layer
2. Update `CpqPricingService` to accept `offeringId` and `currencyCode` (with `productId` fallback)
3. Update `CpqValidationService` to use spec-based validation (with `productId` fallback)
4. Create new API routes
5. Mark old configure/price routes as deprecated (keep functional for v1 compat)

### Phase 3: Data migration

1. For existing `CpqQuoteConfiguration` records with `primaryItemConfiguration`:
   - Create `SalesQuoteLine` entries if they don't exist (v1 had them as charge lines — keep them)
   - Create corresponding `CpqQuoteLineConfiguration` records from the stored configurations
2. Drop deprecated columns from `cpq_quote_configurations` after v1 routes are removed

---

## Design Decisions

### DD-1: One Offering = One Quote Line

Instead of fragmenting the quote with one line per charge, each offering produces a single `SalesQuoteLine`. This means:
- The standard quote view shows offering-level items (e.g. "GIX Cloud Connect — AWS: $500 NRC + $120/mo MRC") — not individual charge entries
- Detailed charge breakdown lives in the companion `CpqQuoteLineConfiguration.charges` JSONB
- NRC, MRC, and usage totals are separate numeric columns on the companion for easy querying/aggregation
- Parent-child hierarchy in the quote mirrors the product relationship structure

### DD-2: Quote Context is the Quoting Domain's Responsibility

The pricing engine receives a flat `configuration` bag and performs dimension matching. It has no knowledge of customers, deals, parent products, or subscriptions. The quoting domain resolves all context from various sources and merges it before calling the pricing engine. This keeps the pricing engine generic and testable.

### DD-3: Quantity and SalesQuoteLine.unitPriceNet Mapping

`SalesQuoteLine.quantity` holds the offering instance count (e.g. 5× "Phone Number — Mobile"). `unitPriceNet` holds the per-instance total (NRC + MRC for one instance). `totalNetAmount = unitPriceNet × quantity`.

The pricing engine is called **once per offering** and produces per-instance charges. The quoting domain multiplies NRC and MRC totals by the line quantity. This keeps the pricing engine unaware of line-level quantity — it just prices one instance. Usage charges are stored per-instance (not multiplied) since actual consumption is unknown at quote time.

The detailed per-instance charge breakdown (individual NRC, MRC, usage rates, tier breakdowns, rule adjustments) lives in `CpqQuoteLineConfiguration.charges` JSONB. The multiplied totals live in `nrc_total` and `mrc_total` columns for easy aggregation.

### DD-4: Quotes with Errors Can Be Saved

Unlike v1 which refused to persist invalid quotes, v2 saves them with `cpqStatus: 'incomplete'`. This allows:
- Users to save work-in-progress and return later
- Partial configurations to persist across sessions
- The UI to show a clear "fix these issues" state rather than losing unsaved work

### DD-5: No Quote Type

The quote is a generic container. Each line carries its own `action` (`add`/`modify`/`cancel`), allowing a single quote to mix operations. This removes the v1 constraint of one operation per quote and prepares for MACD flows.

### DD-6: Currency is Quote-Level

The quote's `currencyCode` is set at creation time and passed to the pricing engine for all calculations. This ensures currency consistency (R-CPRICE-8) and removes the fragile "derive from first charge" pattern in v1.

---

## Known Gaps and Limitations

### G-QUOTE-1: No approval workflow engine

Status transitions to `in_approval`, `pre_approved`, and `approved` are available but there is no automated approval engine. Transitions are manual API calls. Automated approval rules (e.g. "auto-approve if discount < 15%") are a future enhancement.

### G-QUOTE-2: No multi-currency within a quote

All items in a quote must use the same currency (set at quote level). Mixed-currency quotes are not supported.

### G-QUOTE-3: No quote expiry enforcement

`SalesQuote.validUntil` is not enforced by the CPQ module. An expired quote can still be transitioned. Expiry enforcement is a future enhancement.

### G-QUOTE-4: No bulk item operations

Adding/updating/removing multiple items requires separate API calls.

### G-QUOTE-5: Only `add` action supported

`modify` and `cancel` line actions are schema-present but not implemented. They require subscription/inventory domain integration.

### G-QUOTE-6: Relationship validation is per-quote only

Cross-quote constraints (e.g. "customer can only have one active instance of this offering") require inventory/subscription lookup — future domain concern.

### G-QUOTE-7: No diff between quote versions

`parentQuoteId` tracks the chain but there is no API to compute a diff between two versions.

---

## Planned Enhancements

| # | Enhancement | Requirement reference |
|---|-------------|----------------------|
| 1 | **Approval workflow engine** — automated rule evaluation for approval routing, threshold-based auto-approval | G-QUOTE-1 |
| 2 | **MACD flows** — implement `modify` and `cancel` line actions with subscription item reference and delta calculation | G-QUOTE-5 |
| 3 | **Bulk item operations** — add/update/remove multiple items in a single request | G-QUOTE-4 |
| 4 | **Quote version diff** — API to compare two versions of a quote (added/removed/changed items, price delta) | G-QUOTE-7 |
| 5 | **Quote templates** — pre-configured quote templates with default offerings and configurations for common scenarios | _(usability)_ |
| 6 | **Customer context in pricing** — extend quote context resolution with customer segment-based pricing tier lookup | R-PRICE-5 |
| 7 | **Quote expiry** — auto-transition expired quotes to a `expired` status; block transitions on expired quotes | G-QUOTE-3 |
| 8 | **PDF generation** — generate a formatted quote document with offering-level summaries and detailed charge breakdowns | _(usability)_ |
