# XD-223: Bundled Offerings — Implementation Spec

## Summary

Extend the **Product Specification & Offering** model (XD-187) to support **bundled products** — offerings that group multiple component offerings into a single sellable package. This builds on the existing spec/offering separation: a **bundle specification** defines the structural blueprint (what slots exist, what component specs can fill them), while a **bundle offering** defines the commercial package (which specific component offerings are available in each slot, with bundle-level pricing).

The bundle concept is recursive: a component offering within a bundle can itself be a bundle, enabling multi-level hierarchies (e.g. TV Channel Packs → TV Plan → Triple Play).

Additionally, this spec introduces the **`is_assetizable`** flag on `CpqProductSpecification`, indicating whether a product creates an asset record during fulfilment. This enables decomposition of a single bundled quote line into a mix of subscription items and assets.

> **Domain parent**: Product (see `specs/domains/product.md`)
> **Blueprint ref**: `specs/blueprint.md` — Domain #1
> **Dependencies**: XD-187 (Product Specification & Offering), XD-201 (Quoting), XD-215 (Customer Inventory)
> **Existing implementation**: `src/modules/cpq/data/entities.ts`, `src/modules/cpq/services/cpqProductSpecificationService.ts`, `src/modules/cpq/services/cpqProductOfferingService.ts`
> **Out of scope**: Bundle-level wizard UI (Workflow domain concern), bundle pricing optimization (e.g. automatic best-price selection across slot alternatives), bundle-to-order conversion logic

---

## Motivation

### Current State

The product model supports **structural relationships** between specifications (`parent_child`, `requires`, `excludes` via `CpqProductRelationship`) and **individual offerings** as sellable configurations of a single specification. However, there is no way to:

1. **Package multiple offerings into a single sellable unit** — a sales rep must manually add each component product to a quote and rely on relationships for validation. There is no catalog-level concept of "this is a package you can sell."

2. **Define slot-based composition** — the current `parent_child` relationship says "product A can contain product B" but doesn't express "this bundle has an internet slot where you pick one of three options." The selection logic is implicit.

3. **Apply bundle-level commercial terms** — bundle discounts, setup fees, or special pricing that applies to the package as a whole (not to individual components) has no home in the current model.

4. **Control asset vs subscription decomposition** — when a bundle contains both service components (subscription items) and physical/logical components (assets), there is no flag to drive this distinction during fulfilment.

### Why This Matters

| Capability | Telco (Triple Play) | ISP (Internet + Device) | CPaaS (Communication Suite) |
|---|---|---|---|
| **Bundle composition** | Internet + TV + Phone as one offer | Internet plan + Router/Mesh as one offer | Voice API + SMS API + Phone Numbers as one offer |
| **Slot alternatives** | Pick 1 of 3 TV packages | Pick 1 of 2 router models | Pick 1-N phone number types |
| **Multi-level nesting** | TV Plan itself bundles base + add-on channel packs | — | Communication Suite bundles individual API products |
| **Asset decomposition** | Set-top box → asset; Internet line → subscription item | Router → asset; Internet plan → subscription item | Phone numbers → subscription items; SIM cards → assets |
| **Bundle pricing** | Bundle discount: -15% when all three components selected | Free router with 24-month commitment | Volume discount across all APIs in the suite |

Without bundled offerings, each of these scenarios requires custom quoting logic. With them, they are purely configuration.

---

## Data Model

### Extended Entities

#### 1. CpqProductSpecification (extended)

Add `spec_type` and `is_assetizable` fields.

**New columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `spec_type` | text | no | `'simple'` | Enum: `simple`, `bundle`. Determines whether this spec has bundle slots. |
| `is_assetizable` | boolean | no | `false` | Whether fulfilment creates an asset record for products of this spec. When `false`, fulfilment creates a subscription item. |

**Migration**: All existing specifications get `spec_type = 'simple'` and `is_assetizable = false`.

---

#### 2. CpqProductOffering (extended)

Add `offering_type` field.

**New columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `offering_type` | text | no | `'simple'` | Enum: `simple`, `bundle`. Must match the referenced specification's `spec_type`. |

**Changed columns**:

| Column | Change | Description |
|--------|--------|-------------|
| `spec_id` | Remains required | For `bundle` offerings, references a `bundle`-type specification. |
| `design_time_values` | No change | Bundle offerings can have their own design-time values (e.g. bundle tier, contract term). |

**Migration**: All existing offerings get `offering_type = 'simple'`.

---

### New Entities

#### 3. CpqBundleSlot

Defines a **slot** within a bundle specification — a structural position that must be filled by a component from a specific target specification. Slots are the blueprint-level building blocks of a bundle; they define what goes into the bundle, not how it's sold.

**Table**: `cpq_bundle_slots`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `spec_id` | uuid | no | | FK to `CpqProductSpecification.id` (must be `spec_type = 'bundle'`) |
| `target_spec_id` | uuid | no | | FK to `CpqProductSpecification.id` — which spec can fill this slot |
| `component_group` | text | no | | Slot group identifier (e.g. `internet`, `tv`, `phone`, `device`). Slots with the same `component_group` on the same spec form an alternative set. |
| `name` | text | no | | Display name (e.g. "Internet Component", "TV Package") |
| `description` | text | yes | null | |
| `cardinality_min` | integer | no | 0 | Minimum selections required from this slot group |
| `cardinality_max` | integer | yes | null | Maximum selections from this slot group (null = unlimited) |
| `sort_order` | integer | no | 0 | Display ordering |
| `is_active` | boolean | no | true | Soft toggle |
| `metadata` | jsonb | yes | null | Extensibility bag |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_bundle_slot_spec_idx` | `organization_id, tenant_id, spec_id` | B-tree | All slots for a bundle spec |
| `cpq_bundle_slot_target_idx` | `organization_id, tenant_id, target_spec_id` | B-tree | Find which bundles accept a given spec |
| `cpq_bundle_slot_group_idx` | `organization_id, tenant_id, spec_id, component_group` | B-tree | Group-level queries |

**Cardinality semantics**: Cardinality is defined **per component group**, not per individual slot row. When multiple slots share the same `component_group`, the cardinality applies across the group. For example:

```
Spec: "Triple Play" (bundle)
  Slot A: component_group="tv", target_spec="TV Basic Spec",    cardinality_min=1, max=1
  Slot B: component_group="tv", target_spec="TV Premium Spec",  cardinality_min=1, max=1
```

This means: from the "tv" group, pick exactly 1 offering (from either the TV Basic or TV Premium spec). The cardinality values must be consistent across slots in the same group — validation enforces this (V-SLOT-3).

---

#### 4. CpqOfferingComponent

Links a **bundle offering** to the specific **component offerings** available in each slot. This is the commercial layer — it narrows the blueprint-level slots to concrete purchasable offerings.

**Table**: `cpq_offering_components`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `offering_id` | uuid | no | | FK to `CpqProductOffering.id` (must be `offering_type = 'bundle'`) |
| `slot_id` | uuid | no | | FK to `CpqBundleSlot.id` — ties back to the structural blueprint |
| `child_offering_id` | uuid | no | | FK to `CpqProductOffering.id` — the specific component offering. Can itself be a bundle offering (recursive). |
| `is_default` | boolean | no | false | Whether this component is pre-selected when the bundle is added to a quote |
| `sort_order` | integer | no | 0 | Display ordering within the slot group |
| `is_active` | boolean | no | true | Soft toggle |
| `metadata` | jsonb | yes | null | Extensibility bag |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_off_comp_offering_idx` | `organization_id, tenant_id, offering_id` | B-tree | All components for a bundle offering |
| `cpq_off_comp_slot_idx` | `organization_id, tenant_id, offering_id, slot_id` | B-tree | Components for a specific slot |
| `cpq_off_comp_child_idx` | `organization_id, tenant_id, child_offering_id` | B-tree | Find which bundles include a given offering |
| `cpq_off_comp_unique` | `organization_id, tenant_id, offering_id, child_offering_id` | Unique | No duplicate child offerings in the same bundle |

---

### Entity Relationship Diagram

```
CpqProductSpecification
  │
  ├── spec_type: 'simple'                      (existing — leaf product)
  │     └── is_assetizable: true/false          (NEW — drives fulfilment decomposition)
  │
  └── spec_type: 'bundle'                       (NEW — container product)
        │
        ├── 1:N → CpqBundleSlot                (NEW — structural blueprint)
        │           ├── component_group: "internet"
        │           ├── target_spec_id → CpqProductSpecification (what spec fills this slot)
        │           └── cardinality_min/max (per group)
        │
        └── 1:N → CpqProductOffering (offering_type: 'bundle')
                    │
                    ├── design_time_values       (bundle-level design-time attributes)
                    ├── 1:N → CpqProductCharge   (bundle-level charges — discounts, fees)
                    │
                    └── 1:N → CpqOfferingComponent  (NEW — commercial composition)
                              ├── slot_id → CpqBundleSlot
                              ├── child_offering_id → CpqProductOffering (simple or bundle — recursive)
                              └── is_default, sort_order
```

**Full hierarchy example — Triple Play**:

```
CpqProductSpecification: "Triple Play" (bundle)
  ├── CpqBundleSlot: group="internet", target_spec="Internet Service",  min=1, max=1
  ├── CpqBundleSlot: group="tv",       target_spec="TV Plan",          min=1, max=1
  └── CpqBundleSlot: group="phone",    target_spec="Phone Line",       min=0, max=1
                                                      │
CpqProductSpecification: "TV Plan" (bundle)            │ (target_spec for "tv" slot)
  ├── CpqBundleSlot: group="base",  target_spec="TV Base Package",    min=1, max=1
  └── CpqBundleSlot: group="addon", target_spec="TV Channel Pack",    min=0, max=null

CpqProductSpecification: "Internet Service" (simple, is_assetizable=false)
CpqProductSpecification: "TV Base Package"  (simple, is_assetizable=false)
CpqProductSpecification: "TV Channel Pack"  (simple, is_assetizable=false)
CpqProductSpecification: "Phone Line"       (simple, is_assetizable=false)
CpqProductSpecification: "Router"           (simple, is_assetizable=true)  ← creates asset

CpqProductOffering: "Triple Play Gold" (bundle, spec="Triple Play")
  ├── charges: [ { code: "bundle_discount", chargeType: "mrc", fixedPrice: -15.00 } ]
  ├── CpqOfferingComponent: slot="internet" → "Internet 500Mbps" (isDefault=true)
  ├── CpqOfferingComponent: slot="internet" → "Internet 1Gbps"
  ├── CpqOfferingComponent: slot="tv"       → "TV Premium Plan" (bundle offering, isDefault=true)
  ├── CpqOfferingComponent: slot="phone"    → "Phone Basic"
  └── CpqOfferingComponent: slot="phone"    → "Phone Unlimited" (isDefault=true)

CpqProductOffering: "TV Premium Plan" (bundle, spec="TV Plan")
  ├── CpqOfferingComponent: slot="base"  → "Premium Base Channels" (isDefault=true)
  ├── CpqOfferingComponent: slot="addon" → "Sports Pack"
  ├── CpqOfferingComponent: slot="addon" → "Movie Pack"
  └── CpqOfferingComponent: slot="addon" → "Kids Pack"
```

---

## Quote Integration

### Hierarchical Quote Lines

When a bundle offering is added to a quote, it produces a **tree of quote lines**: one parent line for the bundle, plus child lines for each selected component. This uses the existing `parent_line_id` field on `CpqQuoteLineConfiguration` (XD-201).

```
SalesQuoteLine: "Triple Play Gold"                    ← bundle line
  CpqQuoteLineConfiguration:
    offering_id: "Triple Play Gold" (bundle)
    parent_line_id: null
    charges: [ bundle_discount: -$15.00/mo ]
    nrc_total: 0, mrc_total: -15.00
    │
    ├── SalesQuoteLine: "Internet 500Mbps"            ← component line
    │   CpqQuoteLineConfiguration:
    │     offering_id: "Internet 500Mbps"
    │     parent_line_id: → "Triple Play Gold" line
    │     configuration: { bandwidth: "500", region: "eu-west" }
    │     charges: [ mrc: $49.99/mo ]
    │     nrc_total: 0, mrc_total: 49.99
    │
    ├── SalesQuoteLine: "TV Premium Plan"             ← nested bundle line
    │   CpqQuoteLineConfiguration:
    │     offering_id: "TV Premium Plan" (bundle)
    │     parent_line_id: → "Triple Play Gold" line
    │     charges: []
    │     nrc_total: 0, mrc_total: 0
    │     │
    │     ├── SalesQuoteLine: "Premium Base Channels"
    │     │   CpqQuoteLineConfiguration:
    │     │     parent_line_id: → "TV Premium Plan" line
    │     │     charges: [ mrc: $29.99/mo ]
    │     │
    │     └── SalesQuoteLine: "Sports Pack"
    │         CpqQuoteLineConfiguration:
    │           parent_line_id: → "TV Premium Plan" line
    │           charges: [ mrc: $9.99/mo ]
    │
    └── SalesQuoteLine: "Phone Unlimited"             ← component line
        CpqQuoteLineConfiguration:
          offering_id: "Phone Unlimited"
          parent_line_id: → "Triple Play Gold" line
          charges: [ mrc: $19.99/mo ]
```

**Total roll-up**: Bundle line totals are the sum of own charges plus all descendant line totals.
- TV Premium Plan MRC: $29.99 + $9.99 = $39.98
- Triple Play Gold MRC: -$15.00 (own) + $49.99 + $39.98 + $19.99 = **$94.96**

### New Column on CpqQuoteLineConfiguration

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `slot_id` | uuid | yes | null | FK to `CpqBundleSlot.id`. Set on component lines to identify which slot they fill. `null` for top-level or non-bundle lines. |

This enables validation: the quoting domain can check that all required slots are filled and cardinality constraints are met.

### Add-to-Quote Flow

When a user adds a bundle offering to a quote:

1. **Create bundle line** — a `SalesQuoteLine` + `CpqQuoteLineConfiguration` for the bundle offering itself.
2. **Auto-expand defaults** — for each slot group, create component lines for offerings marked `isDefault = true`. Each component line gets `parent_line_id` pointing to the bundle line and `slot_id` pointing to the relevant slot.
3. **Recursive expansion** — if a default component is itself a bundle, repeat steps 1-2 for that nested bundle (its line becomes child of the parent bundle line).
4. **User customisation** — the user can swap component offerings within a slot (replace "Internet 500Mbps" with "Internet 1Gbps"), add optional components, or remove optional components. Each swap/add/remove updates the relevant child lines.
5. **Validate slot constraints** — after any change, validate that all slot group cardinality constraints are met across the bundle hierarchy.
6. **Price** — each component line is priced independently via its offering's charges. Bundle-level charges are priced on the bundle line. Totals roll up.

### Bundle Validation Rules (Quote-Time)

| Rule | Description |
|------|-------------|
| V-QBUN-1 | Every required slot group (`cardinality_min >= 1`) in the bundle spec must have at least `cardinality_min` component lines. |
| V-QBUN-2 | No slot group may have more than `cardinality_max` component lines (if `cardinality_max` is set). |
| V-QBUN-3 | Each component line's `offering_id` must be listed as a `CpqOfferingComponent` of the parent bundle offering for the corresponding slot. |
| V-QBUN-4 | Nested bundles must independently satisfy their own slot constraints (recursive validation). |
| V-QBUN-5 | Component lines cannot exist without their parent bundle line. Deleting a bundle line cascades to all descendant lines. |

---

## Inventory / Fulfilment Integration

When a quote containing a bundle is accepted and provisioned, the bundle decomposes into inventory records based on `is_assetizable`:

```
CpqInventorySubscription: "SUB-2026-00123"
  │
  ├── CpqInventorySubscriptionItem: "Triple Play Gold"     ← bundle item (grouping)
  │     offering_id: "Triple Play Gold"
  │     parent_item_id: null
  │     charges: [ bundle_discount ]
  │     │
  │     ├── CpqInventorySubscriptionItem: "Internet 500Mbps"   ← is_assetizable=false → subscription item
  │     │     parent_item_id: → "Triple Play Gold" item
  │     │     configuration: { bandwidth: "500", region: "eu-west" }
  │     │     mrc_amount: 49.99
  │     │
  │     ├── CpqInventorySubscriptionItem: "TV Premium Plan"    ← nested bundle item
  │     │     parent_item_id: → "Triple Play Gold" item
  │     │     │
  │     │     ├── CpqInventorySubscriptionItem: "Premium Base Channels"
  │     │     │     parent_item_id: → "TV Premium Plan" item
  │     │     │
  │     │     └── CpqInventorySubscriptionItem: "Sports Pack"
  │     │           parent_item_id: → "TV Premium Plan" item
  │     │
  │     └── CpqInventorySubscriptionItem: "Phone Unlimited"
  │           parent_item_id: → "Triple Play Gold" item
  │
  └── CpqInventoryAsset: "Router Model A"                  ← is_assetizable=true → asset
        offering_id: "Router Model A"
        subscription_id: → "SUB-2026-00123"
        subscription_item_id: → relevant parent subscription item (if applicable)
        asset_type: "physical"
        status: "pending"
```

**Decomposition rules**:
- `is_assetizable = false` (default): component becomes a `CpqInventorySubscriptionItem` with `parent_item_id` mirroring the quote hierarchy.
- `is_assetizable = true`: component becomes a `CpqInventoryAsset`, linked to the subscription and optionally to the parent subscription item.
- Bundle offerings themselves (the grouping nodes) always become subscription items — they carry bundle-level charges and serve as hierarchy anchors.

---

## API Design

### Bundle Slot APIs

#### `GET /api/cpq/bundle-slots`

List bundle slots with filtering.

| Param | Type | Description |
|-------|------|-------------|
| `specId` | string | **Required**. Filter by bundle specification. |
| `componentGroup` | string | Filter by slot group. |

#### `GET /api/cpq/bundle-slots/:id`

Get a single slot with resolved target spec info.

**Response**:

```typescript
{
  id: string
  specId: string
  targetSpecId: string
  targetSpec: { id: string, code: string, name: string, specType: string }
  componentGroup: string
  name: string
  description: string | null
  cardinalityMin: number
  cardinalityMax: number | null
  sortOrder: number
}
```

#### `POST /api/cpq/bundle-slots`

Create a bundle slot.

```typescript
{
  specId: string                // Must reference a spec with spec_type='bundle'
  targetSpecId: string          // The spec that can fill this slot
  componentGroup: string        // Slot group identifier
  name: string
  description?: string
  cardinalityMin?: number       // Default: 0
  cardinalityMax?: number | null // Default: null (unlimited)
  sortOrder?: number
}
```

**Feature**: `cpq.specifications.manage`

#### `PUT /api/cpq/bundle-slots/:id`

Update. Cannot change `specId` or `targetSpecId` after creation.

#### `DELETE /api/cpq/bundle-slots/:id`

Soft-delete. Cannot delete if active offering components reference this slot.

---

### Offering Component APIs

#### `GET /api/cpq/offering-components`

List offering components with filtering.

| Param | Type | Description |
|-------|------|-------------|
| `offeringId` | string | **Required**. Filter by bundle offering. |
| `slotId` | string | Filter by slot. |

#### `POST /api/cpq/offering-components`

Add a component offering to a bundle.

```typescript
{
  offeringId: string            // Must reference an offering with offering_type='bundle'
  slotId: string                // Must reference a CpqBundleSlot belonging to the offering's spec
  childOfferingId: string       // The component offering (simple or bundle)
  isDefault?: boolean           // Default: false
  sortOrder?: number
}
```

**Validation**:
- `childOfferingId` must reference an offering whose spec matches the slot's `target_spec_id` (V-COMP-2)
- No circular references: a bundle offering cannot appear as its own descendant (V-COMP-4)

**Feature**: `cpq.offerings.manage`

#### `PUT /api/cpq/offering-components/:id`

Update `isDefault`, `sortOrder`, `isActive`. Cannot change `offeringId`, `slotId`, or `childOfferingId`.

#### `DELETE /api/cpq/offering-components/:id`

Soft-delete.

---

### Extended Existing APIs

#### `GET /api/cpq/product-specifications/:id` (extended response)

Add to existing response:

```typescript
{
  // ... existing fields ...
  specType: 'simple' | 'bundle'
  isAssetizable: boolean

  // Only for bundle specs:
  slots?: Array<{
    id: string
    componentGroup: string
    name: string
    targetSpecId: string
    targetSpec: { id: string, code: string, name: string, specType: string }
    cardinalityMin: number
    cardinalityMax: number | null
    sortOrder: number
  }>
}
```

#### `GET /api/cpq/product-offerings/:id` (extended response)

Add to existing response:

```typescript
{
  // ... existing fields ...
  offeringType: 'simple' | 'bundle'

  // Only for bundle offerings:
  components?: Array<{
    id: string
    slotId: string
    slot: { id: string, componentGroup: string, name: string, cardinalityMin: number, cardinalityMax: number | null }
    childOfferingId: string
    childOffering: { id: string, code: string, name: string, offeringType: string, specId: string }
    isDefault: boolean
    sortOrder: number
  }>
}
```

#### `POST /api/cpq/product-specifications` (extended input)

Accept optional `specType` and `isAssetizable`:

```typescript
{
  // ... existing fields ...
  specType?: 'simple' | 'bundle'       // Default: 'simple'
  isAssetizable?: boolean              // Default: false
}
```

#### `POST /api/cpq/product-offerings` (extended input)

Accept optional `offeringType`:

```typescript
{
  // ... existing fields ...
  offeringType?: 'simple' | 'bundle'   // Default: 'simple'
}
```

**Validation**: `offeringType` must match the referenced spec's `specType` (V-OFF-7).

---

## Service Layer

### CpqBundleService

New service registered as `cpqBundleService` in the Awilix DI container (scoped lifetime).

```typescript
interface CpqBundleService {
  // --- Bundle Slots ---

  /** List slots for a bundle specification. */
  getSlots(specId: string, scope: TenantScope): Promise<BundleSlotResult[]>

  /** Get a single slot with resolved target spec. */
  getSlot(slotId: string, scope: TenantScope): Promise<BundleSlotResult>

  /** Create a bundle slot. Validates spec is bundle type. */
  createSlot(input: CreateBundleSlotInput, scope: TenantScope): Promise<BundleSlotResult>

  /** Update a bundle slot. */
  updateSlot(slotId: string, input: UpdateBundleSlotInput, scope: TenantScope): Promise<BundleSlotResult>

  /** Delete a bundle slot. Validates no active components reference it. */
  deleteSlot(slotId: string, scope: TenantScope): Promise<void>

  // --- Offering Components ---

  /** List components for a bundle offering, grouped by slot. */
  getComponents(offeringId: string, scope: TenantScope): Promise<OfferingComponentResult[]>

  /** Add a component offering to a bundle. Validates slot/spec compatibility. */
  addComponent(input: AddOfferingComponentInput, scope: TenantScope): Promise<OfferingComponentResult>

  /** Update a component (isDefault, sortOrder). */
  updateComponent(componentId: string, input: UpdateOfferingComponentInput, scope: TenantScope): Promise<OfferingComponentResult>

  /** Remove a component from a bundle. */
  removeComponent(componentId: string, scope: TenantScope): Promise<void>

  // --- Bundle Resolution ---

  /** Resolve the full bundle tree for an offering (recursive). Used by quoting to expand defaults. */
  resolveBundleTree(offeringId: string, scope: TenantScope): Promise<BundleTreeNode>

  /** Validate that a bundle offering has valid components for all required slots. */
  validateBundleCompleteness(offeringId: string, scope: TenantScope): Promise<ValidationResult>

  /** Check for circular references in bundle hierarchy. */
  detectCircularReference(offeringId: string, childOfferingId: string, scope: TenantScope): Promise<boolean>
}

interface BundleTreeNode {
  offeringId: string
  offeringCode: string
  offeringName: string
  offeringType: 'simple' | 'bundle'
  specId: string
  specType: 'simple' | 'bundle'
  isAssetizable: boolean
  charges: CpqProductCharge[]
  slots: Array<{
    slotId: string
    componentGroup: string
    name: string
    cardinalityMin: number
    cardinalityMax: number | null
    components: Array<{
      componentId: string
      childOffering: BundleTreeNode  // Recursive
      isDefault: boolean
      sortOrder: number
    }>
  }>
}
```

### Changes to Existing Services

#### CpqQuotingService (extended)

- **`addBundleToQuote(quoteId, offeringId, options?)`**: New method. Calls `resolveBundleTree()`, creates the bundle line + default component lines (recursive), returns the full line tree.
- **`swapComponent(quoteLineId, newOfferingId)`**: New method. Replaces a component line within a bundle. Validates the new offering is a valid component for the slot. Re-prices.
- **`addOptionalComponent(parentLineId, slotId, offeringId)`**: New method. Adds an optional component to a bundle. Validates cardinality.
- **`removeComponent(quoteLineId)`**: New method. Removes a component from a bundle. Validates cardinality_min is still satisfied.
- **`validateQuote()`**: Extended to recursively validate bundle slot constraints (V-QBUN-1 through V-QBUN-5).
- **`priceQuote()`**: Extended to roll up totals from component lines to bundle lines.

#### CpqInventoryService (extended)

- **`provisionFromOrder()`**: Extended to decompose bundle quote lines into subscription items and assets based on `is_assetizable`. Maintains parent-child hierarchy via `parent_item_id`.

---

## Validation Rules

### Specification Validation (extended)

| Rule | Description |
|------|-------------|
| V-SPEC-5 | `spec_type` cannot be changed after creation if offerings or slots exist. |
| V-SPEC-6 | A `simple` spec cannot have bundle slots. |

### Bundle Slot Validation

| Rule | Description |
|------|-------------|
| V-SLOT-1 | `spec_id` must reference a spec with `spec_type = 'bundle'`. |
| V-SLOT-2 | `target_spec_id` must reference an active `CpqProductSpecification`. |
| V-SLOT-3 | All slots in the same `component_group` on the same spec must have identical `cardinality_min` and `cardinality_max` values. |
| V-SLOT-4 | `cardinality_min` must be >= 0. |
| V-SLOT-5 | `cardinality_max` must be >= `cardinality_min` if set. |
| V-SLOT-6 | `target_spec_id` must not equal `spec_id` (no self-referencing slots). |
| V-SLOT-7 | No circular slot chains: if spec A has a slot targeting spec B (bundle), and spec B has a slot targeting spec A, validation fails. |

### Offering Component Validation

| Rule | Description |
|------|-------------|
| V-COMP-1 | `offering_id` must reference an offering with `offering_type = 'bundle'`. |
| V-COMP-2 | `child_offering_id`'s spec must match the slot's `target_spec_id`. |
| V-COMP-3 | `slot_id` must belong to the bundle offering's specification (`offering.spec_id = slot.spec_id`). |
| V-COMP-4 | No circular references: the `child_offering_id` (and its descendants if it's a bundle) must not include the parent `offering_id`. |
| V-COMP-5 | No duplicate: same `(offering_id, child_offering_id)` pair cannot exist twice. |

### Offering Validation (extended)

| Rule | Description |
|------|-------------|
| V-OFF-7 | `offering_type` must match the spec's `spec_type`. A `bundle` offering must reference a `bundle` spec. |
| V-OFF-8 | A bundle offering should have components for all required slot groups (`cardinality_min >= 1`) before it can transition to `active` lifecycle status. |

---

## ACL / Feature Flags

No new feature flags required. Bundle slots use `cpq.specifications.manage` (they're part of the spec blueprint). Offering components use `cpq.offerings.manage` (they're part of the offering's commercial configuration). This is consistent with the spec/offering separation principle.

---

## Migration Strategy

### Phase 1: Schema (non-breaking)

1. Add `spec_type` column to `cpq_product_specifications` (default `'simple'`)
2. Add `is_assetizable` column to `cpq_product_specifications` (default `false`)
3. Add `offering_type` column to `cpq_product_offerings` (default `'simple'`)
4. Create `cpq_bundle_slots` table
5. Create `cpq_offering_components` table
6. Add `slot_id` column to `cpq_quote_line_configurations` (nullable)

### Phase 2: Service + API deployment

1. Deploy `CpqBundleService` + registration in DI
2. Deploy bundle slot and offering component APIs
3. Extend specification and offering APIs with new fields
4. Extend quoting service with bundle operations

### Phase 3: Inventory integration

1. Extend `provisionFromOrder()` with `is_assetizable` decomposition logic

No data backfill is needed — all existing data is `simple` type by default.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/modules/cpq/data/entities.ts` | Modify | Add `CpqBundleSlot`, `CpqOfferingComponent`. Extend `CpqProductSpecification` (specType, isAssetizable) and `CpqProductOffering` (offeringType). Add `slotId` to `CpqQuoteLineConfiguration`. |
| `src/modules/cpq/data/validators.ts` | Modify | Add Zod schemas for new entities. Extend existing spec/offering schemas. |
| `src/modules/cpq/services/cpqBundleService.ts` | Create | Bundle slot CRUD, offering component CRUD, bundle tree resolution, circular reference detection. |
| `src/modules/cpq/api/bundle-slots.ts` | Create | Bundle slot CRUD APIs. |
| `src/modules/cpq/api/offering-components.ts` | Create | Offering component CRUD APIs. |
| `src/modules/cpq/api/product-specifications.ts` | Modify | Extend responses with `specType`, `isAssetizable`, `slots`. |
| `src/modules/cpq/api/product-offerings.ts` | Modify | Extend responses with `offeringType`, `components`. |
| `src/modules/cpq/services/cpqQuotingService.ts` | Modify | Add bundle-to-quote expansion, component swap/add/remove, bundle validation, total roll-up. |
| `src/modules/cpq/services/cpqInventoryService.ts` | Modify | Extend provisioning with `is_assetizable` decomposition. |
| `src/modules/cpq/di.ts` | Modify | Register `cpqBundleService`. |
| `src/modules/cpq/migrations/Migration_...bundled_offerings.ts` | Create | Schema changes (new tables + new columns). |

---

## Design Decisions

### DD-BUN-1: Bundle concept lives on both specification and offering

A `bundle` is not just an offering concern — it's a structural concept that spans both layers:
- **Specification** (blueprint): defines the slots — what types of products belong in the bundle and their cardinality.
- **Offering** (commercial): selects specific offerings for each slot and adds bundle-level charges.

This mirrors the existing pattern: specification defines *what* (attributes, relationships), offering defines *how it's sold* (design-time values, charges). Bundles extend this same separation.

### DD-BUN-2: Single `targetSpecId` per slot

Each slot references one target specification. If a slot should accept products from multiple specs (e.g. both "Router" and "Mesh System"), model them as separate optional slots within the same or different component groups. Use existing `CpqProductRelationship.excludes` for mutual exclusion if needed. This keeps the slot model simple; a many-to-many (slot ↔ spec) can be introduced later as a non-breaking enhancement if required.

### DD-BUN-3: Cardinality is per component group, not per slot row

Multiple slots can share the same `component_group`. The cardinality applies to the group as a whole: "pick 1-3 from this group of alternatives." This avoids needing a separate grouping entity while supporting the common "pick one from N options" pattern.

### DD-BUN-4: Recursive bundles via self-referencing offerings

A `CpqOfferingComponent.child_offering_id` can point to another bundle offering. This enables multi-level composition (Triple Play → TV Plan → Channel Packs) without any special-case handling — the same resolution and validation logic applies at every level. Circular reference detection (V-COMP-4, V-SLOT-7) prevents infinite recursion.

### DD-BUN-5: Bundle line + component lines in quotes (hierarchical)

When added to a quote, a bundle creates a parent `SalesQuoteLine` for itself and child lines for each selected component. This provides:
- Full visibility into bundle composition on the quote document.
- Per-component pricing, configuration, and validation.
- Clean decomposition into subscription items and assets during fulfilment.
- Bundle-level charges (discounts, fees) on the parent line.

The alternative (single line with components as nested JSONB) was rejected because it loses per-component granularity needed for `is_assetizable` decomposition and individual component pricing.

### DD-BUN-6: `is_assetizable` on specification, not offering

The asset/subscription distinction is a characteristic of *what the product is* (blueprint concern), not *how it's sold* (commercial concern). A router is always a physical asset regardless of which offering bundles it. Therefore `is_assetizable` lives on `CpqProductSpecification`.

### DD-BUN-7: No bundle-level `CpqProductRelationship` changes

The existing `CpqProductRelationship` entity remains unchanged. Bundle composition is modelled via slots + components, not via relationships. Relationships continue to express structural constraints (`requires`, `excludes`, `parent_child`) that apply regardless of bundling. The two mechanisms are complementary:
- Slots define "what's inside the bundle."
- Relationships define "what else is needed/excluded across the broader quote."

---

## Examples

### Example 1: Triple Play (Telco)

**Specifications**:

| Spec | Type | Assetizable | Description |
|------|------|-------------|-------------|
| `triple-play` | bundle | false | Top-level bundle |
| `internet-service` | simple | false | Broadband internet |
| `tv-plan` | bundle | false | TV plan (itself a bundle) |
| `tv-base-package` | simple | false | Base channel package |
| `tv-channel-pack` | simple | false | Add-on channel pack |
| `phone-line` | simple | false | Landline phone |
| `set-top-box` | simple | **true** | Physical set-top box → asset |

**Bundle slots**:

| Bundle Spec | Group | Target Spec | Min | Max |
|---|---|---|---|---|
| `triple-play` | `internet` | `internet-service` | 1 | 1 |
| `triple-play` | `tv` | `tv-plan` | 1 | 1 |
| `triple-play` | `phone` | `phone-line` | 0 | 1 |
| `triple-play` | `hardware` | `set-top-box` | 0 | 3 |
| `tv-plan` | `base` | `tv-base-package` | 1 | 1 |
| `tv-plan` | `addon` | `tv-channel-pack` | 0 | null |

**Offerings & components**: Triple Play Gold bundles Internet 500, TV Premium Plan, and optionally Phone + set-top boxes. TV Premium Plan bundles Premium Base + optional Sports/Movie/Kids packs.

### Example 2: Internet + Device (ISP)

**Specifications**:

| Spec | Type | Assetizable | Description |
|------|------|-------------|-------------|
| `internet-device-bundle` | bundle | false | Internet + device package |
| `internet-plan` | simple | false | Internet subscription |
| `router` | simple | **true** | Router hardware → asset |
| `mesh-system` | simple | **true** | Mesh WiFi system → asset |

**Bundle slots**:

| Bundle Spec | Group | Target Spec | Min | Max |
|---|---|---|---|---|
| `internet-device-bundle` | `internet` | `internet-plan` | 1 | 1 |
| `internet-device-bundle` | `device` | `router` | 0 | 1 |
| `internet-device-bundle` | `device` | `mesh-system` | 0 | 1 |

Note: Router and Mesh System are separate optional slots in the same `device` group. Since cardinality on the group is 0:1, the user can pick at most one device. If mutual exclusion is needed (must pick exactly one), adjust to min=1, max=1 or add an `excludes` relationship between the two specs.

### Example 3: Communication Suite (CPaaS)

**Specifications**:

| Spec | Type | Assetizable | Description |
|------|------|-------------|-------------|
| `comm-suite` | bundle | false | Communication API bundle |
| `voice-api` | simple | false | Voice API service |
| `sms-api` | simple | false | SMS API service |
| `phone-numbers` | simple | false | Phone number allocation |
| `sim-card` | simple | **true** | Physical SIM → asset |

**Bundle slots**:

| Bundle Spec | Group | Target Spec | Min | Max |
|---|---|---|---|---|
| `comm-suite` | `voice` | `voice-api` | 0 | 1 |
| `comm-suite` | `sms` | `sms-api` | 0 | 1 |
| `comm-suite` | `numbers` | `phone-numbers` | 1 | null |
| `comm-suite` | `hardware` | `sim-card` | 0 | null |

**Bundle offering**: "Enterprise Communication Suite" — includes Voice API, SMS API, at least 1 phone number allocation, optional SIM cards. Bundle-level charge: -10% volume discount on all component MRCs.

---

## Open Questions

1. **Bundle-level attributes**: Should bundle specifications support their own attributes (e.g. "bundle tier", "contract commitment")? The current design allows this via the existing `CpqProductAttribute` with `spec_id` pointing to the bundle spec. Design-time bundle attributes would flow into `CpqProductOffering.designTimeValues`, and run-time bundle attributes would be configured on the bundle's quote line. Is this sufficient, or do bundle attributes need special treatment? → Leaning towards: existing mechanism is sufficient.

2. **Component quantity override**: Should the quoting domain allow overriding the `quantity` of individual component lines within a bundle (e.g. 3× phone numbers within a Triple Play)? The current model supports this since each component is its own quote line with its own `quantity`. The question is whether the bundle spec should constrain component quantities separately from cardinality. → Leaning towards: defer, use cardinality for now.

3. **Bundle pricing strategies**: Beyond simple bundle-level charges (fixed discounts/fees), should we support percentage-based bundle discounts that automatically apply to component totals? This could be a price rule concern rather than a bundle concern. → Leaning towards: use `CpqPriceRule` with an `offeringId` scope for bundle-level pricing rules.
