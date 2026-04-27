# Price Engine — Calculate Price API

## Objective

Provide a **stateless, real-time price calculation endpoint** that resolves all applicable charges for one or more configured product items. The endpoint is used primarily during the quoting wizard as a live preview — it does not persist any data. Persisting a priced configuration is handled separately by the `/api/cpq/quotes/configure` endpoint.

The engine is **product-agnostic**: it has no knowledge of what a product is or what its attributes mean. Pricing logic is expressed entirely through `CpqProductCharge` records, `CpqPricingTable` dimensions, and charge applicability conditions — all of which are data.

> **Domain parent**: [Pricing Engine](pricing-engine.md)
> **Related spec**: [Quoting](quoting.md)
> **Implementation**: `src/modules/cpq/api/quotes/price/route.ts`
> **Service**: `src/modules/cpq/services/cpqPricingService.ts`

---

## Endpoint

```
POST /api/cpq/quotes/price
```

| Property | Value |
|----------|-------|
| Auth required | Yes (`requireAuth: true`) |
| Feature flag | `cpq.quotes.view` |
| Side effects | None — read-only, no database writes |
| Typical consumer | Quoting wizard Step 5 (Review), `ChargePreviewPanel`, `fetchPricePreview()` |

---

## Request Schema

Defined in `src/modules/cpq/data/validators.ts` as `cpqPricePreviewSchema`.

```typescript
{
  primaryItem?: {
    offeringId?: string                     // UUID of the offering (v2, preferred)
    productId?: string                      // UUID of the product (v1 fallback; one of offeringId / productId required)
    configuration: Record<string, unknown>  // Attribute key-value pairs for this item
  }
  childItems: Array<{
    offeringId?: string                     // UUID of the offering (v2, preferred)
    productId?: string                      // UUID of the product (v1 fallback; one of offeringId / productId required)
    configuration: Record<string, unknown>
  }>
  currencyCode?: string                     // ISO 4217 currency code (e.g. 'USD', 'EUR'). Default: 'USD'. Passed from quote-level currency.
}
```

### Field Notes

| Field | Required | Description |
|-------|----------|-------------|
| `primaryItem` | No | Omit when only child pricing is needed (e.g. pricing a child add-on with no primary item in scope) |
| `primaryItem.offeringId` | Conditional | Preferred identifier (v2). One of `offeringId` / `productId` required when `primaryItem` is present. |
| `primaryItem.productId` | Conditional | v1 fallback. Used when `offeringId` is not yet available. |
| `childItems` | Yes (may be `[]`) | One entry per child item being priced; order is not significant |
| `childItems[].offeringId` | Conditional | Same as `primaryItem.offeringId` — preferred identifier. |
| `currencyCode` | No | Quote-level currency passed by the quoting domain. Propagated to all resolved charges. Default: `'USD'`. |

> **v2 context propagation**: Parent-to-child attribute enrichment is the **quoting domain's responsibility** (see [XD-201 — Quote Context](xd-201-quoting.md#quote-context)). The quoting domain merges `quoteContext`, `designTimeValues`, and the user's run-time configuration before calling the pricing engine. The pricing engine receives a flat, pre-merged configuration bag — it has no knowledge of parent products, customers, or deals.

---

## Response Schema

```typescript
{
  primaryCharges: ResolvedCharge[]      // Charges for the primary item; empty array if no primaryItem
  childItems: Array<{
    offeringId: string | null           // Echo of request offeringId (if provided)
    productId: string | null            // Echo of request productId (if provided; v1 compat)
    charges: ResolvedCharge[]
  }>
  totals: {
    nrcTotal: number                    // Sum of all NRC totalPrice values where totalPrice ≠ null
    mrcTotal: number                    // Sum of all MRC totalPrice values where totalPrice ≠ null
    usageCharges: Array<{
      chargeCode: string
      unitPrice: number
      note: string                      // Human-readable description of the usage rate
      // chargeName is intentionally absent — known gap, see Planned Enhancement 10
    }>
  }
  currencyCode: string                  // Echoes request currencyCode; defaults to 'USD' if omitted
}
```

### ResolvedCharge Type

Defined in `src/modules/cpq/services/cpqPricingService.ts`.

```typescript
interface ResolvedCharge {
  chargeCode: string                    // Matches CpqProductCharge.code
  chargeName: string                    // Human-readable label
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod: 'flat' | 'tiered' | 'per_unit'  // current code; add 'volume' to this union when implementing PE-1
  unitPrice: number                     // Per-unit rate, or flat price when quantity = 1; post-rule value once rules are implemented
  quantity: number | null               // null for usage charges
  totalPrice: number | null             // null for usage charges; post-rule value once rules are implemented
  currencyCode: string
  breakdown?: TierBreakdown | null      // Populated when pricingMethod = 'tiered' (MRC, NRC, or usage once Gap B is fixed)
  note?: string | null                  // Populated for usage charges
  adjustments?: RuleAdjustment[] | null // Absent (not null) when no rules fired. Populated once XD-188 price rules are implemented (Planned Enhancement 2). RuleAdjustment type defined in price-rules.md.
}
```

### TierBreakdown Type

```typescript
interface TierBreakdown {
  tiers: Array<{
    tier: number          // Tier ordinal (1-based)
    from: number          // Range start (inclusive)
    to: number            // Range end (inclusive; last tier uses from + qty - 1)
    pricePerUnit: number  // Rate applied to units in this tier
    quantity: number      // Units consumed from this tier
    subtotal: number      // quantity × pricePerUnit
  }>
}
```

> **Note when price rules are active**: `breakdown` always reflects **pre-rule** per-tier rates. Once [Simple Price Rules](price-rules.md) are implemented, `sum(tiers[].subtotal)` will not equal `totalPrice` for tiered charges that have had a rule applied. The `totalPrice` on the parent `ResolvedCharge` is the authoritative post-rule value; `breakdown` is informational only. See [G-RULE-4](price-rules.md#g-rule-4-tiered-charge-adjustment-is-approximate).

### RuleAdjustment Type

Defined in [Simple Price Rules](price-rules.md#ruleadjustment--audit-trail). Referenced on `ResolvedCharge.adjustments`.

```typescript
interface RuleAdjustment {
  ruleCode: string        // Matches CpqPriceRule.code
  ruleName: string        // Human-readable label
  ruleType: string        // 'discount_percent' | 'discount_absolute' | 'surcharge_percent' | 'surcharge_absolute' | 'price_override'
  value: number           // Rule's value field
  unitPriceBefore: number // unitPrice before this rule
  unitPriceAfter: number  // unitPrice after this rule
  delta: number           // unitPriceAfter - unitPriceBefore (negative for discounts, positive for surcharges)
}
```

---

## Usage Charges — Concepts

Usage charges model consumption that cannot be known at quote time — the quantity only exists after the service is delivered. The engine handles them as a special case across three dimensions: rate resolution, response representation, and totals aggregation.

> This section covers the *concept*. The algorithmic detail (how `calculatePerUnit` and `calculateTiered` detect the usage path) is in [Charge Resolution Algorithm](#charge-resolution-algorithm).

### What makes a charge a usage charge

A `CpqProductCharge` with `chargeType: 'usage'` — regardless of its `pricingMethod`. The `chargeType` drives the usage path; the `pricingMethod` determines how the unit rate is looked up.

### Rate resolution still happens

Even though the total cannot be calculated, the engine **always** attempts to resolve a `unitPrice` from the pricing table using the same dimension-matching logic as for MRC/NRC charges. The resolved rate is the quoted unit price displayed to the customer — it is the price they will pay per consumed unit when the service bills.

If no matching entry exists, `unitPrice` defaults to `0` (subject to [R-CPRICE-6](#r-cprice-6-graceful-missing-entry)).

### Common usage charge patterns

| Pattern | How it is modelled | Example |
|---------|-------------------|---------|
| **Simple rate** | One usage charge, `pricingMethod: 'per_unit'`. Rate looked up by configuration dimensions. | $0.05 per API call |
| **Commit + overage** | Two charges on the same product: one MRC for the committed quantity, one usage charge for consumption above the commit. | 100 units/month MRC + $0.12/unit overage |
| **Event-based** | Usage charge with `pricingMethod: 'per_unit'`, no `quantityAttributeCode`. Rate looked up by dimensions. *(Intended method is `flat`, but see Gap A — use `per_unit` until fixed.)* | $0.01 per notification sent |
| **Tiered overage rate** | Usage charge with `pricingMethod: 'tiered'` — the overage rate itself varies by consumption band. | *(see implementation gap below)* |

### Implementation gaps

> **Gap A — Flat + usage**: `calculateFlat` does not check `chargeType`. A charge with `pricingMethod: 'flat'` + `chargeType: 'usage'` would incorrectly set `quantity: 1` and `totalPrice: unitPrice`. Until fixed, event-based usage charges should use `pricingMethod: 'per_unit'` with no `quantityAttributeCode`.

> **Gap B — Tiered + usage**: `calculateTiered` does not check `chargeType`. A charge with `pricingMethod: 'tiered'` + `chargeType: 'usage'` would incorrectly calculate a non-null `totalPrice`. Until fixed, tiered usage charges must use `pricingMethod: 'per_unit'` with the appropriate rate tier pre-selected via an applicability condition.

See [Planned Enhancements](#planned-enhancements-v2) items 8 and 9.

### Response representation

Usage charges appear in **two places** in the response:

1. **Inside `primaryCharges` / `childItems[].charges`** — the full `ResolvedCharge` object with `quantity: null`, `totalPrice: null`, resolved `unitPrice`, and `note`.

2. **Inside `totals.usageCharges`** — a condensed summary used by the pricing summary panel:
   ```typescript
   { chargeCode: string; unitPrice: number; note: string }
   ```
   > **Known gap**: `chargeName` is absent from the `totals.usageCharges` summary. The UI must cross-reference `primaryCharges` or `childItems[].charges` by `chargeCode` to obtain the human-readable label. See Planned Enhancement 10.

Usage charges are never added to `nrcTotal` or `mrcTotal`.

### Applicability conditions apply normally

Usage charges are filtered by `applicabilityCondition` identically to all other charges. An overage charge can be conditional (e.g. only present when `pricing_model = 'burstable'`), so it appears only when the configuration activates it.

---

## Business Logic

### Step 1 — Authenticate & Scope

The request is authenticated via `resolveCpqRouteContext`. `organizationId` and `tenantId` are extracted from the session. All subsequent database queries are scoped to this tenant/org pair.

### Step 2 — Resolve Primary Item Charges

If `primaryItem` is present, call `DefaultCpqPricingService.resolveProductCharges()` with `primaryItem.offeringId` (falling back to `primaryItem.productId`) and `primaryItem.configuration`. See [Charge Resolution Algorithm](#charge-resolution-algorithm).

### Step 3 — Resolve Child Item Charges

For each entry in `childItems`, call `resolveProductCharges()` with the item's `offeringId` / `productId` and its `configuration`.

> **Context propagation is the caller's responsibility.** Any context values the child pricing needs (e.g. attributes derived from the parent item, customer segment, deal tier) must already be merged into `childItems[].configuration` by the caller **before** the request is sent. The pricing engine receives a flat, pre-merged configuration bag — it does not look up parent products, customer records, or other context. In the quoting flow, this merging is performed by the [quoting domain](xd-201-quoting.md#quote-context).

### Step 4 — Aggregate Totals

All charges from the primary item and every child item are first merged into one flat list before aggregation:

```
allCharges   = primaryCharges + childItems[0].charges + childItems[1].charges + ...

nrcTotal     = Σ charge.totalPrice  for charge in allCharges where chargeType = 'nrc' and totalPrice ≠ null
mrcTotal     = Σ charge.totalPrice  for charge in allCharges where chargeType = 'mrc' and totalPrice ≠ null
usageCharges = [ { chargeCode, unitPrice, note } ]  for charge in allCharges where chargeType = 'usage'
```

Usage charges are never included in `nrcTotal` or `mrcTotal`.

### Step 5 — Return

Compose the response with `primaryCharges`, `childItems`, `totals`, and `currencyCode`.

---

## Charge Resolution Algorithm (`resolveProductCharges`)

Inputs: `offeringId` (preferred) or `productId` (v1 fallback), `configuration: Record<string, unknown>`, `currencyCode: string`, `tenantId`, `organizationId`.

**1. Load and sort active charges**

Fetch all `CpqProductCharge` records where:
- `offeringId = <input offeringId>` (v2 path), **or** `productId = <input productId>` when `offeringId` is not supplied (v1 fallback)
- `tenantId = <tenant>`, `organizationId = <org>`
- `isActive = true`, `deletedAt = null`

Sort ascending by `sortOrder`. The sort order determines the sequence of charges in the response, which affects display order in the quoting UI.

> **Performance note**: The current implementation issues a separate database query per charge to load its `CpqPricingTable` and entries (N+1 pattern). For products with many charges this is a known bottleneck. A future optimisation should batch-load all pricing tables and entries for a product in one query before iterating charges.

**2. Filter by applicability**

Each charge may define an `applicabilityCondition`:

```typescript
{ attribute: string; operator: 'eq' | 'neq'; value: string }
```

> **Note**: The Zod validator (`validators.ts`) types `applicabilityCondition` as `Record<string, unknown>` (a loose JSONB field). The structured `{ attribute, operator, value }` shape is an **implementation convention** enforced by the service layer, not by schema validation. A future migration should tighten the Zod type to match.

Evaluate the condition against the configuration:
- `eq` — `String(configuration[attribute]) === value`
- `neq` — `String(configuration[attribute]) !== value`
- No condition — charge is always applicable

Only applicable charges proceed to price calculation.

> **Limitation**: Only a single condition per charge is supported. There is no AND/OR compound logic. Complex conditionality (e.g. "apply when region = 'eu' AND tier = 'premium'") must currently be modelled as separate charges with separate applicability conditions, or by adding a dedicated attribute whose value encodes the combined case.

**3. Calculate each applicable charge**

For each applicable charge:

- If `charge.pricingTableId` is `null`, return the base charge immediately with `unitPrice: 0`, `quantity: 1`, `totalPrice: 0`. This covers charges that have no pricing table assigned yet (misconfiguration or in-progress setup). The `resolved: boolean` enhancement (item 11) will make this state explicit.
- If `charge.pricingTableId` is set but the table record is not found (deleted or cross-tenant), treat the same as null: return zeros.
- Otherwise, load the pricing table and its non-deleted entries (`deletedAt: null`), then evaluate using the matching pricing method:

#### Flat (`pricingMethod = 'flat'`)

The price does not depend on quantity. A single entry must match all table dimensions against the configuration (case-insensitive exact match).

```
entry     = matchEntry(tableEntries, table.dimensions, configuration)
unitPrice = entry.prices[charge.priceColumnKey]
quantity  = 1
totalPrice = unitPrice
```

#### Per-Unit (`pricingMethod = 'per_unit'`)

The price scales linearly with a quantity attribute. The dimension match works identically to flat pricing; only the final calculation differs.

```
entry     = matchEntry(tableEntries, table.dimensions, configuration)
unitPrice = entry.prices[charge.priceColumnKey]

if charge.chargeType = 'usage':
  quantity   = null
  totalPrice = null
  note       = 'Usage-based charge — billed on actual consumption.'
else:
  quantity   = Number(configuration[charge.quantityAttributeCode])
  totalPrice = unitPrice × quantity
```

#### Tiered (`pricingMethod = 'tiered'`)

The quantity is split across progressive tiers. Each tier is priced at its own rate. The total is the sum across all tiers.

> **Known limitation**: `tableEntries` is the full set of active entries for the table. The tiered algorithm does **not** pre-filter entries by matching `dimensionValues` against the configuration before distributing the quantity. As a result, tiered tables must contain entries with uniform (or empty) `dimensionValues` — mixing entries for different dimension groups (e.g. multiple regions) in one tiered table will produce incorrect results. See [Pricing Tables — G-PT-6](pricing-tables.md#g-pt-6-tiered-algorithm-ignores-dimension-values) and Planned Enhancement 16.

```
quantity  = Number(configuration[charge.quantityAttributeCode])
entries   = sort(tableEntries, ascending by tierNumber)

remaining = quantity
total     = 0

for each tier entry:
  from         = entry.rangeFrom
  to           = entry.rangeTo ?? ∞
  tierCapacity = (to = ∞) ? remaining : (to − from + 1)
  qty          = min(remaining, tierCapacity)
  if qty ≤ 0: stop

  price    = entry.prices[charge.priceColumnKey]
  subtotal = qty × price
  total   += subtotal
  remaining -= qty

unitPrice  = total / quantity    // effective average rate across all tiers
totalPrice = total
breakdown  = { tiers: [...per-tier records...] }
```

#### Volume (`pricingMethod = 'volume'`)

> **Not yet implemented** in `DefaultCpqPricingService`. Defined in [R-PRICE-3](pricing-engine.md): total quantity determines the tier, and that tier's rate applies to all units.
>
> **Implementation checklist when adding volume pricing**: (1) add `'volume'` to `ResolvedCharge.pricingMethod` union in `cpqPricingService.ts`; (2) add `'volume'` to `cpqProductChargeCreateSchema`'s `pricingMethod` enum in `validators.ts`; (3) implement `calculateVolume()` in `DefaultCpqPricingService`; (4) generate and run a migration if the DB column is constrained.

**4. Apply price rules (planned — not yet implemented)**

Once [Simple Price Rules](price-rules.md) are implemented, two additional steps run after step 3:

- Load all active `CpqPriceRule` records for this `productOfferingId` plus global rules (`productOfferingId IS NULL`), filtered by `isActive = true` and `deletedAt IS NULL`, sorted by `sortOrder` ascending.
- For each rule: evaluate its `applicabilityCondition` against `configuration`, then apply its formula to any charge that passes its `chargeCodeFilter` / `chargeTypeFilter`. Record a `RuleAdjustment` entry on the charge. After this step, `unitPrice` and `totalPrice` on all affected charges reflect the post-rule values, and `totals` aggregate those post-rule values.

See [Planned Enhancement 2](#planned-enhancements-v2) and the [Simple Price Rules spec](price-rules.md) for the full design.

### Charge Type × Pricing Method Matrix

Quick reference for all valid combinations and their current behaviour. Gaps are flagged.

| `chargeType` \ `pricingMethod` | `flat` | `per_unit` | `tiered` | `volume` |
|-------------------------------|--------|------------|----------|----------|
| **`nrc`** | ✅ `qty=1`, `total=unitPrice` | ✅ `qty` from config attr, `total=unit×qty` | ✅ split across tiers, `breakdown` populated | ⬜ not implemented |
| **`mrc`** | ✅ `qty=1`, `total=unitPrice` | ✅ `qty` from config attr, `total=unit×qty` | ✅ split across tiers, `breakdown` populated | ⬜ not implemented |
| **`usage`** | ⚠️ **Gap A** — sets `qty=1`, `total=unitPrice` (wrong) | ✅ `qty=null`, `total=null`, `note` set | ⚠️ **Gap B** — calculates non-null `total` (wrong) | ⬜ not implemented |

Legend: ✅ implemented and correct · ⚠️ implemented but incorrect (see [Usage Charges — Concepts](#usage-charges--concepts)) · ⬜ not yet implemented

---

## Requirements

### R-CPRICE-1: Stateless Execution
The endpoint must not write to the database. Identical inputs must always produce identical outputs. It is safe to call repeatedly during wizard interaction.

### R-CPRICE-2: Tenant Isolation
All charge and pricing table lookups must be scoped to the authenticated `organizationId` + `tenantId`. Cross-tenant data must never be accessible.

### R-CPRICE-3: Partial Input Support
The request is valid with `primaryItem: null` and an empty `childItems` array. The response must return empty arrays and zero totals. No error is thrown for missing items.

### R-CPRICE-4: Applicability Filtering
Only charges that pass their `applicabilityCondition` against the given configuration are included in the response. Charges with no condition are always included.

### R-CPRICE-5: Usage Charge Representation
Usage charges (`chargeType: 'usage'`) must be returned with `quantity: null` and `totalPrice: null` regardless of the `pricingMethod`. They must appear both in the charge list (inside `primaryCharges` or `childItems[].charges`) and in `totals.usageCharges`. They must be excluded from `nrcTotal` / `mrcTotal`.

### R-CPRICE-6: Graceful Missing Entry
If no pricing table entry matches the configuration dimensions for a charge, return that charge with `unitPrice: 0` and `totalPrice: 0`. Do not throw an error. The UI is responsible for surfacing the issue to the user.

> **Known ambiguity**: `unitPrice: 0` is indistinguishable from a genuine $0 charge. A future version should add a `resolved: boolean` field to `ResolvedCharge` so the UI can differentiate a failed lookup from a legitimately zero-priced charge. See Planned Enhancement 11.

### R-CPRICE-7: Context is Caller-Provided
The pricing engine receives a flat, pre-merged `configuration` bag per item. Any attribute values derived from parent items, customer context, deal context, or other sources must be merged by the **caller** (the quoting domain) before the request is sent. The pricing engine does not resolve, look up, or inject any context on behalf of the caller. See [XD-201 — Quote Context](xd-201-quoting.md#quote-context).

### R-CPRICE-8: Currency Consistency
All charges within a single request must use the same currency as specified in the request `currencyCode`. The response `currencyCode` echoes the request value (defaulting to `'USD'` if omitted). Mixed-currency results within one price preview call are not supported.

### R-CPRICE-9: Feature Flag Enforcement
The endpoint requires the `cpq.quotes.view` feature flag. Sessions without this flag must receive `401 Unauthorized`.

### R-CPRICE-10: DI-Overridable Pricing Service
`DefaultCpqPricingService` is registered in Awilix as `cpqPricingService`. The endpoint should source it from the DI container so that downstream consumers can substitute a custom implementation without modifying the route.

### R-CPRICE-11: Usage Rate Always Resolved
The engine must always attempt to resolve a `unitPrice` for usage charges using the same pricing table dimension-matching logic as for MRC/NRC charges. The resolved rate is the quoted unit price shown to the customer. Returning `unitPrice: 0` is permitted only when no matching pricing table entry exists (R-CPRICE-6).

### R-CPRICE-12: Multiple Usage Charges per Product
A product may define more than one usage charge (e.g. an overage charge and an event-based charge). Each must appear as a separate entry in the charge list and as a separate entry in `totals.usageCharges`. They must not be merged or aggregated.

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Request body fails `cpqPricePreviewSchema` Zod validation | `{ "error": "Validation error", "details": [...ZodIssue] }` |
| `401 Unauthorized` | No valid session or missing `cpq.quotes.view` feature | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | Unexpected exception (DB error, unhandled edge case) | `{ "error": "Internal error" }` |

---

## Examples

The examples below use generic product and attribute names. They are illustrative — any product domain can be modelled using the same charge + pricing table structure.

### Example 1 — Flat NRC + Per-Unit MRC

A standalone product with a one-time setup fee (flat NRC) and a monthly fee that scales with quantity (per-unit MRC).

**Request**

```json
{
  "primaryItem": {
    "productId": "<product-uuid>",
    "configuration": {
      "service_tier": "standard",
      "quantity": 3
    }
  },
  "childItems": []
}
```

**Response**

```json
{
  "primaryCharges": [
    {
      "chargeCode": "setup_fee",
      "chargeName": "Setup Fee",
      "chargeType": "nrc",
      "pricingMethod": "flat",
      "unitPrice": 500,
      "quantity": 1,
      "totalPrice": 500,
      "currencyCode": "USD"
    },
    {
      "chargeCode": "monthly_fee",
      "chargeName": "Monthly Service Fee",
      "chargeType": "mrc",
      "pricingMethod": "per_unit",
      "unitPrice": 120,
      "quantity": 3,
      "totalPrice": 360,
      "currencyCode": "USD"
    }
  ],
  "childItems": [],
  "totals": {
    "nrcTotal": 500,
    "mrcTotal": 360,
    "usageCharges": []
  },
  "currencyCode": "USD"
}
```

---

### Example 2 — Tiered MRC

A product whose monthly fee is calculated by splitting the quantity across progressive pricing tiers.

**Request**

```json
{
  "primaryItem": {
    "productId": "<product-uuid>",
    "configuration": {
      "region": "eu-west",
      "units": 150
    }
  },
  "childItems": []
}
```

**Response**

```json
{
  "primaryCharges": [
    {
      "chargeCode": "tiered_monthly_fee",
      "chargeName": "Monthly Fee (Tiered)",
      "chargeType": "mrc",
      "pricingMethod": "tiered",
      "unitPrice": 2.83,
      "quantity": 150,
      "totalPrice": 425,
      "currencyCode": "USD",
      "breakdown": {
        "tiers": [
          { "tier": 1, "from": 1,   "to": 100, "pricePerUnit": 3.00, "quantity": 100, "subtotal": 300 },
          { "tier": 2, "from": 101, "to": 500, "pricePerUnit": 2.50, "quantity": 50,  "subtotal": 125 }
        ]
      }
    }
  ],
  "childItems": [],
  "totals": { "nrcTotal": 0, "mrcTotal": 425, "usageCharges": [] },
  "currencyCode": "USD"
}
```

---

### Example 3 — Commit + Overage (MRC + Usage on the same product)

A product with a committed quantity billed monthly (MRC, per-unit) and an overage charge for consumption above the commit (usage). Both charges are defined on the same product. The MRC charge contributes to `mrcTotal`; the overage charge appears only in `totals.usageCharges`.

**Product charge configuration (data)**

| Charge code | chargeType | pricingMethod | quantityAttributeCode | applicabilityCondition |
|-------------|------------|---------------|-----------------------|------------------------|
| `commit_fee` | `mrc` | `per_unit` | `committed_units` | _(none)_ |
| `overage_fee` | `usage` | `per_unit` | _(none — usage)_ | _(none)_ |

**Request**

```json
{
  "primaryItem": {
    "productId": "<product-uuid>",
    "configuration": {
      "region": "eu-west",
      "committed_units": 100
    }
  },
  "childItems": []
}
```

**Response**

```json
{
  "primaryCharges": [
    {
      "chargeCode": "commit_fee",
      "chargeName": "Committed Monthly Fee",
      "chargeType": "mrc",
      "pricingMethod": "per_unit",
      "unitPrice": 10.00,
      "quantity": 100,
      "totalPrice": 1000.00,
      "currencyCode": "USD"
    },
    {
      "chargeCode": "overage_fee",
      "chargeName": "Overage Rate",
      "chargeType": "usage",
      "pricingMethod": "per_unit",
      "unitPrice": 0.12,
      "quantity": null,
      "totalPrice": null,
      "currencyCode": "USD",
      "note": "Usage-based charge — billed on actual consumption."
    }
  ],
  "childItems": [],
  "totals": {
    "nrcTotal": 0,
    "mrcTotal": 1000.00,
    "usageCharges": [
      {
        "chargeCode": "overage_fee",
        "unitPrice": 0.12,
        "note": "Usage-based charge — billed on actual consumption."
      }
    ]
  },
  "currencyCode": "USD"
}
```

The unit rate for `overage_fee` (`0.12`) is resolved from the pricing table using the `region` dimension — the same lookup as for the MRC charge — but no total is calculated because the actual overage quantity is only known post-billing.

---

### Example 4 — Multiple Usage Charges (event-based + overage)

A product that has two independent usage charges: one per-event fee and one overage rate. Each appears as a separate entry in the charge list and in `totals.usageCharges`.

**Request**

```json
{
  "primaryItem": {
    "productId": "<product-uuid>",
    "configuration": {
      "service_tier": "professional",
      "committed_units": 50
    }
  },
  "childItems": []
}
```

**Response**

```json
{
  "primaryCharges": [
    {
      "chargeCode": "monthly_base",
      "chargeName": "Monthly Base Fee",
      "chargeType": "mrc",
      "pricingMethod": "flat",
      "unitPrice": 299.00,
      "quantity": 1,
      "totalPrice": 299.00,
      "currencyCode": "USD"
    },
    {
      "chargeCode": "event_fee",
      "chargeName": "Per-Event Fee",
      "chargeType": "usage",
      "pricingMethod": "per_unit",
      "unitPrice": 0.01,
      "quantity": null,
      "totalPrice": null,
      "currencyCode": "USD",
      "note": "Usage-based charge — billed on actual consumption."
    },
    {
      "chargeCode": "overage_fee",
      "chargeName": "Overage per Unit",
      "chargeType": "usage",
      "pricingMethod": "per_unit",
      "unitPrice": 0.08,
      "quantity": null,
      "totalPrice": null,
      "currencyCode": "USD",
      "note": "Usage-based charge — billed on actual consumption."
    }
  ],
  "childItems": [],
  "totals": {
    "nrcTotal": 0,
    "mrcTotal": 299.00,
    "usageCharges": [
      { "chargeCode": "event_fee",   "unitPrice": 0.01, "note": "Usage-based charge — billed on actual consumption." },
      { "chargeCode": "overage_fee", "unitPrice": 0.08, "note": "Usage-based charge — billed on actual consumption." }
    ]
  },
  "currencyCode": "USD"
}
```

---

### Example 5 — Parent + Child Items with Context Propagation

A parent product with one or more child add-ons. A derived attribute from the parent (looked up by the engine) is injected into child configurations as a pricing dimension.

**Request**

```json
{
  "primaryItem": {
    "productId": "<parent-product-uuid>",
    "configuration": {
      "location_code": "LOC-A",
      "service_tier": "premium"
    }
  },
  "childItems": [
    {
      "productId": "<child-product-uuid>",
      "configuration": {
        "addon_type": "enhanced-support"
      }
    }
  ]
}
```

**What happens internally (Step 3):**
The engine resolves `location_code: "LOC-A"` to a derived attribute (e.g. a region or zone label) from the relevant reference entity, then injects that value into the child configuration before looking up the child's pricing table. The child's pricing table has that derived attribute as a dimension, so the lookup succeeds without the UI needing to know how to resolve it.

**Response**

```json
{
  "primaryCharges": [
    {
      "chargeCode": "primary_mrc",
      "chargeName": "Premium Monthly Fee",
      "chargeType": "mrc",
      "pricingMethod": "flat",
      "unitPrice": 500,
      "quantity": 1,
      "totalPrice": 500,
      "currencyCode": "USD"
    }
  ],
  "childItems": [
    {
      "productId": "<child-product-uuid>",
      "charges": [
        {
          "chargeCode": "addon_mrc",
          "chargeName": "Enhanced Support",
          "chargeType": "mrc",
          "pricingMethod": "flat",
          "unitPrice": 200,
          "quantity": 1,
          "totalPrice": 200,
          "currencyCode": "USD"
        }
      ]
    }
  ],
  "totals": {
    "nrcTotal": 0,
    "mrcTotal": 700,
    "usageCharges": []
  },
  "currencyCode": "USD"
}
```

Note: `mrcTotal: 700` is the sum of all MRC charges across both primary (`500`) and child (`200`) items.

---

## Planned Enhancements (v2)

| # | Enhancement | Requirement reference |
|---|-------------|----------------------|
| 1 | **Volume pricing model** - single rate determined by total quantity tier, applied to all units | R-PRICE-3 |
| 2 | **Post-calculation pricing rules** - DI-registered rule classes modify charges after initial resolution. Design and data model specified in [Simple Price Rules](price-rules.md) | R-PRICE-5 |
| 3 | **Promotions / promo codes** - apply time-based or code-triggered discounts | Pricing Engine domain |
| 4 | **Versioned table lookup** - resolve pricing table version by `effectiveFrom/To` at quote creation time | R-PRICE-6 |
| 5 | **DI-sourced pricing service** - route reads `cpqPricingService` from Awilix container instead of direct instantiation | R-CPRICE-10 |
| 7 | **Quote context injection into rules** - pass full quote context (customer, totals, all items) to pricing rules for cross-item discounts. See [Simple Price Rules — G-RULE-2](price-rules.md#g-rule-2-no-quote-or-customer-context) and [Planned Enhancement 3](price-rules.md#planned-enhancements) | R-PRICE-5 |
| 8 | **Tiered usage charges (Gap B)** - `calculateTiered` must detect `chargeType: 'usage'` and return `quantity: null`, `totalPrice: null`, `unitPrice: tier-1 rate` with a `breakdown` showing the rate schedule without consumed quantities | R-CPRICE-11 |
| 9 | **Flat usage charges (Gap A)** - `calculateFlat` must detect `chargeType: 'usage'` and return `quantity: null`, `totalPrice: null` instead of `quantity: 1, totalPrice: unitPrice` | R-CPRICE-11 |
| 10 | **`chargeName` in `totals.usageCharges`** - add `chargeName: string` to the summary entry so the UI does not need to cross-reference by `chargeCode` | R-CPRICE-12 |
| 11 | **`resolved` field on `ResolvedCharge`** - add `resolved: boolean` to distinguish a genuine $0 price from a failed pricing table lookup | R-CPRICE-6 |
| 12 | **Batch pricing table load** - replace the per-charge N+1 query with a single batch load of all pricing tables and entries for the product before iterating charges | _(performance)_ |
| 13 | **Configurable usage note** - allow `CpqProductCharge.note` to override the default usage description per charge, rather than using the hard-coded string | R-CPRICE-5 |
| 15 | **Typed `applicabilityCondition`** - tighten the Zod schema from `Record<string, unknown>` to `{ attribute: string; operator: 'eq' or 'neq'; value: string }` to match the service implementation | R-CPRICE-4 |
| 16 | **Tiered dimension pre-filter** - before distributing quantity across tier entries, filter entries to only those whose `dimensionValues` match the configuration (same case-insensitive exact match used in flat/per-unit). Enables multi-dimension tiered tables without separate table-per-region workaround | G-PT-6 |
