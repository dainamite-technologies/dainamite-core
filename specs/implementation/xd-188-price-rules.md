# Price Engine — Simple Price Rules

## Objective

Define **data-driven post-calculation rules** that modify resolved charges after the standard pricing table lookup. A price rule adjusts `unitPrice` (and consequently `totalPrice`) without altering the pricing table itself — allowing promotions, regional discounts, volume incentives, and surcharges to be expressed as configuration data rather than code.

Price rules are **simple**: each rule has one rule type, one numeric value, an optional applicability condition, and optional charge/type filters. There is no expression language, no scripting, and no access to cross-item or customer context (those capabilities are covered by Planned Enhancement 7 in the [Calculate Price API](calculate-price-api.md)).

> **Domain parent**: [Pricing Engine](pricing-engine.md)
> **Consumed by**: [Calculate Price API](calculate-price-api.md)
> **Addresses**: R-PRICE-5 in [Pricing Engine](pricing-engine.md), Planned Enhancement 2 in [Calculate Price API](calculate-price-api.md)
> **Implementation status**: **Not yet implemented**. This spec describes the intended design. See [Known Gaps and Limitations](#known-gaps-and-limitations) for the current state.
> **Planned entity**: `src/modules/cpq/data/entities.ts` — `CpqPriceRule`
> **Planned validators**: `src/modules/cpq/data/validators.ts` — `cpqPriceRuleCreateSchema`, `cpqPriceRuleUpdateSchema`
> **Planned API**: `src/modules/cpq/api/price-rules/route.ts`
> **Planned service**: `src/modules/cpq/services/cpqPricingService.ts` — `applyPriceRules()`
> **Planned registration**: `src/modules/cpq/ce.ts` — add `cpq:cpq_price_rule` entry (required for MikroORM entity discovery)
> **ACL note**: `src/modules/cpq/acl.ts` — `cpq.pricing.view` and `cpq.pricing.manage` flags are reused. Consider updating their `title` fields from `'View Pricing Tables'` / `'Manage Pricing Tables'` to `'View Pricing'` / `'Manage Pricing'` to reflect that they now govern both pricing tables and price rules.

---

## Entity: CpqPriceRule

Stores one price adjustment rule. Rules are evaluated in `sortOrder` order after all charges for a product have been resolved from pricing tables.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | auto | Primary key |
| `organizationId` | UUID | yes | Tenant scope |
| `tenantId` | UUID | yes | Tenant scope |
| `code` | text | yes | Unique identifier within the tenant: `(organizationId, tenantId, code)` |
| `name` | text | yes | Human-readable label shown in the quoting UI |
| `description` | text | no | Optional explanation for the rule |
| `productOfferingId` | UUID | no | If set, rule applies only to this product offering. `null` = global rule applied to all product offerings |
| `ruleType` | text | yes | One of: `'discount_percent'`, `'discount_absolute'`, `'surcharge_percent'`, `'surcharge_absolute'`, `'price_override'` |
| `value` | numeric | yes | Magnitude of the adjustment. Constraints by `ruleType`: `discount_percent` → `> 0` and `≤ 100` (enforced by PE-5); `surcharge_percent` → `> 0` (no upper cap — surcharges above 100% are valid); `discount_absolute` and `surcharge_absolute` → `> 0`; `price_override` → `≥ 0` (zero is valid — it makes the charge free) |
| `chargeCodeFilter` | text | no | If set, rule applies only to charges whose `chargeCode` matches this value (exact). `null` = applies to all matching charges |
| `chargeTypeFilter` | text | no | If set, rule applies only to charges of this `chargeType`: `'nrc'`, `'mrc'`, or `'usage'`. `null` = applies regardless of charge type |
| `applicabilityCondition` | jsonb | no | Single-condition filter evaluated against the product configuration at resolution time. Same structure as `CpqProductCharge.applicabilityCondition` — see [Applicability Condition](#applicability-condition) |
| `sortOrder` | integer | yes | Ascending evaluation order. Lower numbers run first. Default `0` |
| `isActive` | boolean | yes | Soft-enable flag. Inactive rules are skipped at evaluation time |
| `createdAt` | timestamp | auto | |
| `updatedAt` | timestamp | auto | |
| `deletedAt` | timestamp | no | Soft-delete timestamp |

#### Database indexes

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_price_rules_scope_idx` | `organizationId, tenantId` | B-tree | Tenant scoping queries |
| `cpq_price_rules_code_unique` | `organizationId, tenantId, code` | Unique | Code uniqueness per tenant |
| `cpq_price_rules_product_idx` | `organizationId, tenantId, productOfferingId` | B-tree | Load rules by product offering |

---

## Key Concepts

### Rule Types

| `ruleType` | Formula | Effect |
|------------|---------|--------|
| `discount_percent` | `adjustedUnitPrice = unitPrice × (1 − value / 100)` | Reduces unit price by a percentage. `value = 10` → 10% off |
| `discount_absolute` | `adjustedUnitPrice = max(0, unitPrice − value)` | Reduces unit price by a fixed amount. Cannot go below zero |
| `surcharge_percent` | `adjustedUnitPrice = unitPrice × (1 + value / 100)` | Increases unit price by a percentage |
| `surcharge_absolute` | `adjustedUnitPrice = unitPrice + value` | Increases unit price by a fixed amount |
| `price_override` | `adjustedUnitPrice = value` | Replaces the unit price entirely, regardless of the pricing table value |

`totalPrice` is always recalculated from `adjustedUnitPrice`:

```
flat:     totalPrice = adjustedUnitPrice           (quantity stays 1)
per_unit: totalPrice = adjustedUnitPrice × quantity
tiered:   totalPrice = adjustedUnitPrice × quantity (see note below)
usage:    totalPrice = null                         (unchanged — quantity is unknown)
```

> **Tiered charges**: For tiered charges the engine computes `unitPrice` as the effective average rate (`totalPrice / quantity`). A percent or absolute rule is applied to this average rate. The `breakdown` field reflects the **pre-rule** per-tier rates; the final `totalPrice` in the response reflects the post-rule value. This approximation is a known simplification — see [G-RULE-4](#g-rule-4-tiered-charge-adjustment-is-approximate).

### Applicability Condition

An optional single-condition filter evaluated against the product `configuration` before applying the rule. Uses the same structure as `CpqProductCharge.applicabilityCondition`:

```typescript
{ attribute: string; operator: 'eq' | 'neq'; value: string }
```

Evaluation:
- `eq` — `String(configuration[attribute]) === value`
- `neq` — `String(configuration[attribute]) !== value`
- No condition — rule is always applicable

> **Note**: This is the same implementation convention as charges (see [`applicabilityCondition` in the Calculate Price API spec](calculate-price-api.md#step-2--filter-by-applicability)). The Zod schema will type this as `Record<string, unknown>` for consistency with the existing pattern.

> **Limitation**: Only a single condition per rule is supported. Complex conditionality must use separate rules or a dedicated configuration attribute encoding the combined case.

### Charge Filters

A rule can be narrowed to a subset of charges using optional filters. Both filters are applied in addition to `applicabilityCondition`:

| Filter field | Behaviour when set | Behaviour when `null` |
|---|---|---|
| `chargeCodeFilter` | Rule applies only to charges with this exact `chargeCode` | Rule applies to all charges |
| `chargeTypeFilter` | Rule applies only to charges with this `chargeType` | Rule applies to all charge types |

If both filters are set, both must match for the rule to apply to a charge.

### Rule Scoping (Product vs Global)

| `productOfferingId` | Scope |
|-------------|-------|
| Set to a UUID | Rule applies only when pricing the specified product offering |
| `null` | **Global rule** — applies to every product in the tenant |

When pricing a product, both product-scoped rules and global rules are loaded together and sorted into a **single combined list by `sortOrder` ascending**. There is no implicit priority between global and product-scoped rules — a global rule with `sortOrder: 1` runs before a product-scoped rule with `sortOrder: 10`. Administrators control execution order entirely through `sortOrder`.

> **Recommended practice**: Use product-scoped rules for product-specific promotions. Use global rules only for tenant-wide policies (e.g. a temporary 5% surcharge on all NRC charges during a migration period). Assign explicit `sortOrder` values to ensure deterministic ordering when both types co-exist.

### Rule Chaining

All applicable rules for a product are applied **in sequence**, in ascending `sortOrder`. Each rule operates on the `unitPrice` already adjusted by all previous rules — not on the original pricing table value. This means:

```
original unitPrice (from pricing table): 100.00

Rule 1 (sortOrder=1): discount_percent, value=10 → adjustedUnitPrice = 90.00
Rule 2 (sortOrder=2): discount_absolute, value=5  → adjustedUnitPrice = 85.00
```

If rules should be independent (not chained), the administrator must design them carefully or use `price_override` which replaces the value entirely.

### RuleAdjustment — Audit Trail

Each rule that fires appends a `RuleAdjustment` entry to the charge's `adjustments` array. This preserves a full audit trail of how the final price was reached.

```typescript
interface RuleAdjustment {
  ruleCode: string        // Matches CpqPriceRule.code
  ruleName: string        // Human-readable label
  ruleType: string        // 'discount_percent' | 'discount_absolute' | ...
  value: number           // Rule's value field
  unitPriceBefore: number // unitPrice before this rule
  unitPriceAfter: number  // unitPrice after this rule
  delta: number           // unitPriceAfter - unitPriceBefore (negative for discounts)
}
```

---

## Integration with the Calculate Price API

Price rules integrate as a **post-resolution step** in `DefaultCpqPricingService`. No change to pricing table lookups or applicability filtering is needed.

### Updated `resolveProductCharges()` algorithm

The charge resolution algorithm gains two new steps after all charges are calculated:

```
1. Load and sort active charges (by sortOrder)
2. Filter by applicabilityCondition
3. Calculate each applicable charge (via pricing table lookup)
4. NEW: Load active price rules — fetch all CpqPriceRule records where
        (productOfferingId = <current productOfferingId> OR productOfferingId IS NULL)
        AND organizationId = <tenant> AND tenantId = <tenant>
        AND isActive = true AND deletedAt IS NULL
        ORDER BY sortOrder ASC
5. NEW: For each rule in the sorted list:
        a. Evaluate rule.applicabilityCondition against configuration
        b. For each charge in the resolved list:
             - Check chargeCodeFilter (if set) against charge.chargeCode
             - Check chargeTypeFilter (if set) against charge.chargeType
             - If all filters pass: apply rule formula → update unitPrice/totalPrice
             - Append RuleAdjustment to charge.adjustments
6. Return ResolvedCharge[] with adjustments populated
```

Rules are loaded **once per product** (not per charge), then the filter loop iterates over the resolved charges. This avoids additional per-charge queries.

### Changes to `ResolvedCharge`

One optional field is added:

```typescript
interface ResolvedCharge {
  // ... existing fields unchanged ...
  adjustments?: RuleAdjustment[] | null  // null or absent when no rules fired
}
```

The `unitPrice` and `totalPrice` in the response **always reflect the post-rule values**. `adjustments` provides the before/after trail. The Calculate Price API totals (`nrcTotal`, `mrcTotal`) are calculated on the post-rule `totalPrice` values.

### Effect on `totals`

`nrcTotal` and `mrcTotal` aggregate post-rule `totalPrice` values. If a discount rule reduces a charge's `totalPrice`, the totals reflect the discounted price. No separate "discount summary" is added to `totals` in the initial implementation — that is Planned Enhancement 4.

### Feature flag

Rules are managed under the existing pricing feature flags:

| Operation | Feature flag |
|-----------|-------------|
| Read rules | `cpq.pricing.view` |
| Create / update / delete rules | `cpq.pricing.manage` |

---

## API — `/api/cpq/price-rules`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.pricing.view` | List rules (paginated) or fetch a single rule |
| `POST` | `cpq.pricing.manage` | Create a new rule |
| `PUT` | `cpq.pricing.manage` | Update an existing rule |
| `DELETE` | `cpq.pricing.manage` | Soft-delete a rule |

### GET — list

```
GET /api/cpq/price-rules?page=1&pageSize=50&productOfferingId=<uuid>
```

| Param | Required | Description |
|-------|----------|-------------|
| `page` | No | Default `1` |
| `pageSize` | No | Default `50`, max `100` |
| `productOfferingId` | No | Filter to rules scoped to this product offering UUID. Omit to list all rules (product-scoped and global combined) |
| `globalOnly` | No | `true` to list only global rules (`productOfferingId IS NULL`). Cannot be combined with `productOfferingId` |

Response: paginated list, sorted by `sortOrder` ascending.

```typescript
{
  items: Array<{
    id: string; code: string; name: string; description: string | null
    productOfferingId: string | null
    ruleType: string; value: number
    chargeCodeFilter: string | null; chargeTypeFilter: string | null
    applicabilityCondition: Record<string, unknown> | null
    sortOrder: number; isActive: boolean
    createdAt: string; updatedAt: string
  }>
  total: number; page: number; pageSize: number; totalPages: number
}
```

### GET — single (`?id=<uuid>`)

Returns the rule record (same shape as list item).

### POST — create rule

Validated by `cpqPriceRuleCreateSchema`. Body:

```typescript
{
  code: string                              // min 1 char, unique per tenant
  name: string                              // min 1 char
  description?: string | null
  productOfferingId?: string | null          // UUID of a product offering, or null (global)
  ruleType: 'discount_percent' | 'discount_absolute' | 'surcharge_percent' | 'surcharge_absolute' | 'price_override'
  value: number                             // > 0 for discount/surcharge types; >= 0 for price_override
  chargeCodeFilter?: string | null
  chargeTypeFilter?: 'nrc' | 'mrc' | 'usage' | null
  applicabilityCondition?: Record<string, unknown> | null
  sortOrder?: number                        // default 0
  isActive?: boolean                        // default true
}
```

Response: `201 Created` with the created rule.

### PUT — update rule

Body: `{ id: string } & Partial<CreateBody>`. Returns updated rule.

> **Warning**: Changing `ruleType` or `value` on a rule that is already wired to active products affects live price calculations immediately. Prefer deactivating the old rule and creating a new one for controlled rollout.

### DELETE — soft-delete rule

Body: `{ id: string }`. Sets `deletedAt`. Returns `{ success: true }`.

---

## Requirements

### R-RULE-1: Post-Calculation Application
Price rules must be applied **after** all charges have been resolved from pricing tables. The pricing table lookup result is the input to the rule engine, not the output.

### R-RULE-2: Ordered Rule Evaluation
Rules must be evaluated in ascending `sortOrder` order. Within the same `sortOrder` value, evaluation order is undefined. The administrator is responsible for using distinct `sortOrder` values when rule chaining order matters.

### R-RULE-3: Charge-Level Application
Rules are applied per charge, not per product aggregate. A rule with `chargeCodeFilter = 'setup_fee'` only modifies charges whose `chargeCode` is `'setup_fee'`.

### R-RULE-4: Zero Floor for Discounts
After a `discount_percent` or `discount_absolute` rule, `unitPrice` must not go below `0`. If the rule would produce a negative value, clamp to `0`.

### R-RULE-5: Usage Charge Rate Adjustment
Usage charges (`chargeType: 'usage'`) may have their `unitPrice` adjusted by a rule. `totalPrice` remains `null`. The adjusted rate appears in `totals.usageCharges`.

### R-RULE-6: Audit Trail Required
Every rule that fires must append a `RuleAdjustment` entry to `ResolvedCharge.adjustments`. The entry must record `ruleCode`, `ruleName`, `ruleType`, `value`, `unitPriceBefore`, `unitPriceAfter`, and `delta`. This field is absent (not an empty array) when no rules fired, to minimise response payload.

### R-RULE-7: Applicability Condition Semantics
Rule `applicabilityCondition` is evaluated against the product configuration using the same `eq`/`neq` semantics as `CpqProductCharge.applicabilityCondition`. A rule with no condition is always applicable (subject to charge filters).

### R-RULE-8: Global and Product-Scoped Rules Are Independent
Global rules (`productOfferingId: null`) and product-scoped rules for the same product are both evaluated for that product. They are sorted together by `sortOrder` and applied in that combined order.

### R-RULE-9: Tenant Isolation
All rule lookups filter by `organizationId` and `tenantId`. A rule from one tenant is never applied in another tenant's price calculation.

### R-RULE-10: Stateless Application
Rule evaluation must not persist data. The engine applies rules in-memory during the price preview request; no rule-application records are written to the database at preview time.

### R-RULE-11: DI-Overridable
The rule application logic must be part of `DefaultCpqPricingService` (or a collaborating service registered in Awilix), allowing downstream consumers to override the rule engine without modifying the route handler.

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Body fails `cpqPriceRuleCreateSchema` / `cpqPriceRuleUpdateSchema` | `{ "error": "Validation error", "details": [...] }` |
| `400 Bad Request` | DELETE body missing `id` | `{ "error": "Missing id" }` |
| `401 Unauthorized` | No valid session or missing feature flag | `{ "error": "Unauthorized" }` |
| `404 Not Found` | GET/PUT/DELETE with unknown or deleted `id` | `{ "error": "Not found" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

---

## Examples

### Example 1 — Global 10% NRC Discount

A tenant-wide discount of 10% applied to all NRC charges during a promotional period.

**Create rule**

```json
POST /api/cpq/price-rules
{
  "code": "promo-nrc-10",
  "name": "10% NRC Promotional Discount",
  "productOfferingId": null,
  "ruleType": "discount_percent",
  "value": 10,
  "chargeTypeFilter": "nrc",
  "sortOrder": 10,
  "isActive": true
}
```

**Effect on a charge**

Before rule: `chargeCode: "setup_fee"`, `chargeType: "nrc"`, `unitPrice: 500`, `totalPrice: 500`

After rule:

```json
{
  "chargeCode": "setup_fee",
  "chargeName": "Setup Fee",
  "chargeType": "nrc",
  "pricingMethod": "flat",
  "unitPrice": 450,
  "quantity": 1,
  "totalPrice": 450,
  "currencyCode": "USD",
  "adjustments": [
    {
      "ruleCode": "promo-nrc-10",
      "ruleName": "10% NRC Promotional Discount",
      "ruleType": "discount_percent",
      "value": 10,
      "unitPriceBefore": 500,
      "unitPriceAfter": 450,
      "delta": -50
    }
  ]
}
```

`nrcTotal` in the response `totals` reflects the discounted value: `450` instead of `500`.

---

### Example 2 — Product-Scoped Conditional Surcharge

A product that applies a $20/unit surcharge on MRC charges when the `service_tier` is `'premium'`.

**Create rule**

```json
POST /api/cpq/price-rules
{
  "code": "premium-mrc-surcharge",
  "name": "Premium Tier MRC Surcharge",
  "productOfferingId": "<product-offering-uuid>",
  "ruleType": "surcharge_absolute",
  "value": 20,
  "chargeTypeFilter": "mrc",
  "applicabilityCondition": {
    "attribute": "service_tier",
    "operator": "eq",
    "value": "premium"
  },
  "sortOrder": 5
}
```

**Before rules** (pricing table resolved `unitPrice: 120`, `quantity: 3`):

```
unitPrice: 120, totalPrice: 360
```

**After rule** (configuration has `service_tier: "premium"`):

```
unitPrice: 140, totalPrice: 420
adjustments: [{ ruleCode: "premium-mrc-surcharge", delta: +20, unitPriceBefore: 120, unitPriceAfter: 140 }]
```

When `service_tier: "standard"`, the applicabilityCondition fails — rule is skipped, charge is unchanged.

---

### Example 3 — Rule Chaining: Two Discounts

A product with two stacked discounts: a 10% loyalty discount followed by a $5 absolute discount on the setup fee.

**Rules**

| sortOrder | code | ruleType | value | chargeCodeFilter |
|-----------|------|----------|-------|-----------------|
| 10 | `loyalty-10` | `discount_percent` | 10 | `setup_fee` |
| 20 | `flat-5-off` | `discount_absolute` | 5 | `setup_fee` |

**Before rules**: `unitPrice: 500`

**After Rule 1** (`loyalty-10`): `unitPrice = 500 × 0.9 = 450`

**After Rule 2** (`flat-5-off`): `unitPrice = 450 − 5 = 445`

```json
"adjustments": [
  { "ruleCode": "loyalty-10",  "ruleType": "discount_percent",  "value": 10, "unitPriceBefore": 500, "unitPriceAfter": 450, "delta": -50 },
  { "ruleCode": "flat-5-off",  "ruleType": "discount_absolute", "value": 5,  "unitPriceBefore": 450, "unitPriceAfter": 445, "delta": -5 }
]
```

Final `unitPrice: 445`, `totalPrice: 445`.

---

### Example 4 — Usage Charge Rate Adjustment

A global 5% discount on all usage charge rates (e.g. overage rates are reduced for preferred customers — future: this will use customer context; for now it applies to all tenants).

**Create rule**

```json
POST /api/cpq/price-rules
{
  "code": "usage-rate-5pct-off",
  "name": "5% Usage Rate Reduction",
  "productOfferingId": null,
  "ruleType": "discount_percent",
  "value": 5,
  "chargeTypeFilter": "usage",
  "sortOrder": 50
}
```

**Before rule**: `chargeCode: "overage_fee"`, `chargeType: "usage"`, `unitPrice: 0.12`, `quantity: null`, `totalPrice: null`

**After rule**: `unitPrice: 0.114`, `quantity: null`, `totalPrice: null`

The adjusted rate appears in `totals.usageCharges`:
```json
{ "chargeCode": "overage_fee", "unitPrice": 0.114, "note": "Usage-based charge — billed on actual consumption." }
```

---

## Known Gaps and Limitations

### G-RULE-1: Not yet implemented
`DefaultCpqPricingService` does not currently call any price rule evaluation. The `CpqPriceRule` entity, schema, and API route do not exist in the codebase. This spec is a forward design. See [Planned Enhancements](#planned-enhancements) item 1.

### G-RULE-2: No quote or customer context
Rules are evaluated against the product `configuration` only. They cannot access the customer record, the quote total, the quote type, or any other line items. Cross-item discounts (e.g. "10% off MRC if NRC > 1000") require Enhancement 7 from the Calculate Price API spec.

### G-RULE-3: No promo code support
There is no `promoCode` field on price rules and no mechanism to activate a rule via a user-entered code. Promo codes are a future feature planned as a standalone promotional entity that references a `CpqPriceRule`.

### G-RULE-4: Tiered charge adjustment is approximate
For `tiered` charges, the rule adjusts the effective average `unitPrice` (not the per-tier rates). The `breakdown` in the response reflects the pre-rule tier rates, while `totalPrice` reflects the post-rule total. Adjusting individual tier rates would require rebuilding the tiered calculation — this is not supported in the simple rule engine.

### G-RULE-5: No discount summary in `totals`
The response `totals` section does not include a per-rule discount summary. To determine total savings, the UI must iterate `adjustments` across all charges. See Planned Enhancement 4.

### G-RULE-6: Zod schema requires per-type `value` validation
The spec requires per-type `value` constraints (`> 0` and `≤ 100` for percent types; `≥ 0` for `price_override`). The initial Zod schema implementation will use a single `z.number().min(0)` constraint on `value` without a cross-field check against `ruleType`. This means a `discount_percent` with `value = 150` is accepted at schema validation time but clamped to $0 at calculation time by R-RULE-4. Administrators must ensure percent discounts do not exceed 100 until Planned Enhancement 5 is applied.

---

## Planned Enhancements

| # | Enhancement | Requirement reference |
|---|-------------|----------------------|
| 1 | **Implement `CpqPriceRule` entity and API** - create entity, MikroORM migration, Zod schemas, CRUD route, and `applyPriceRules()` method in `DefaultCpqPricingService` | G-RULE-1, R-PRICE-5 |
| 2 | **`applyPriceRules()` integrated into `resolveProductCharges()`** - call after pricing table resolution; load global + product-scoped rules in a single query, apply in `sortOrder` order, populate `adjustments` on each affected charge | G-RULE-1 |
| 3 | **Quote context injection** - extend `applyPriceRules()` to accept a `quoteContext` object with customer ID, quote totals, and all resolved charges. Enables cross-item rules such as "10% off if nrcTotal > 1000" | G-RULE-2 |
| 4 | **Discount summary in `totals`** - add `discountTotal: number` and `surchargeTotal: number` to the response `totals` object, aggregated from all `adjustments` across all charges | G-RULE-5 |
| 5 | **Cap `discount_percent` at 100** - add `z.number().max(100)` to the Zod schema for `discount_percent` rule type | G-RULE-6 |
| 6 | **Promo code support** - add a `CpqPromoCode` entity that references a `CpqPriceRule` and can be activated by a user-entered code at quote time | G-RULE-3 |
| 7 | **Rule effective dates** - add `effectiveFrom` and `effectiveTo` date fields to `CpqPriceRule`. Rules outside their effective window are skipped, enabling time-bounded promotions without manual activation/deactivation | _(operational)_ |
| 8 | **Per-tier rate adjustment for tiered charges** - when a rule targets a tiered charge, recalculate the full tier breakdown with adjusted per-tier rates rather than applying the rule to the average unit price | G-RULE-4 |
