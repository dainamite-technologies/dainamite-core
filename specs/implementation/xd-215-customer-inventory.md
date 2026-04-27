# XD-215: Customer Inventory — Implementation Spec

## Summary

Implement the **Product Inventory** domain — the post-order layer that records what products and services a customer has purchased. Inventory consists of three entity types: **subscriptions** (commercial wrappers grouping recurring services), **subscription items** (concrete products/services within a subscription), and **assets** (tangible/intangible things the customer owns — hardware, licenses, setup fees). All three have direct relationships to the customer account for unified listing. The module provides a customer-facing tab, a dedicated admin page, and a REST API. It is designed as an extensible foundation that future client-specific specifications can build upon.

> **Domain parent**: [Product Inventory](../domains/product-inventory.md)
> **Blueprint ref**: `specs/blueprint.md` — Domain #6
> **Dependencies**: XD-201 (Quoting), XD-187 (Product Specification & Offering), XD-186 (Pricing Tables)
> **Existing implementation**: None — greenfield domain within the CPQ module
> **Entities**: `src/modules/cpq/data/entities.ts` — `CpqInventorySubscription`, `CpqInventorySubscriptionItem`, `CpqInventoryAsset`
> **Validators**: `src/modules/cpq/data/validators.ts` — `cpqInventorySubscriptionCreateSchema`, `cpqInventoryAssetCreateSchema`, etc.
> **APIs**: `src/modules/cpq/api/inventory/`
> **Service**: `src/modules/cpq/services/cpqInventoryService.ts`
> **Out of scope**: Automated provisioning from orders (event subscriber defined but not wired), advanced capacity management, typed asset subtypes (serial numbers as structured fields)

---

## Motivation

### Why Inventory?

The CPQ engine currently covers product definition, pricing, and quoting. Once a quote is accepted and converted to an order, there is no system of record for what the customer actually has. This creates several problems:

1. **No customer context during quoting** — when a sales rep creates a new quote, they cannot see existing subscriptions. They have no way to know which parent items (e.g. access ports) are available for attaching child services (e.g. peering).

2. **No MACD foundation** — future Modify/Add/Change/Delete flows (`action: 'modify'` and `action: 'cancel'` on `CpqQuoteLineConfiguration`) require an inventory record to reference. Without inventory, these quote actions have nothing to target.

3. **No visibility for account managers** — there is no dashboard or customer tab showing what a customer is currently paying for, their active services, or their subscription lifecycle status.

4. **No capacity tracking** — the quoting domain cannot validate whether a parent item has remaining capacity for new child items (R-INV-5 in the domain spec).

### What This Spec Covers

- Three new entities: `CpqInventorySubscription` (commercial wrapper), `CpqInventorySubscriptionItem` (product/service records), `CpqInventoryAsset` (tangible/intangible customer assets)
- REST API for CRUD and status management
- Injection widget: "Inventory" tab on both company and person customer detail views
- Dedicated backend page: `/backend/cpq/inventory` in the Customers navigation group
- Service layer: `CpqInventoryService` registered in Awilix DI
- Extensibility points for client-specific customisation

### What Is Deferred

- **Event-driven provisioning** — the `provisionFromOrder(orderId)` service method is defined but the `sales.order.created` event subscriber is not wired. Manual API creation is supported.
- **Capacity tracking** — `capacityTotal` / `capacityUsed` fields are present on subscription items but calculation logic is deferred.
- **Billing integration** — no connection to invoicing or payment systems.
- **Asset structured fields** — serial numbers, circuit IDs, IP addresses are stored in `metadata` JSONB for now. Typed asset subtypes with dedicated fields are future scope.

---

## Data Model

All entities follow established CPQ patterns: UUID primary keys with `gen_random_uuid()`, multi-tenant scoping via `organizationId` + `tenantId`, soft-delete via `deletedAt`, JSONB for flexible data, no MikroORM relation decorators (UUID columns only).

### Entity 1: CpqInventorySubscription

A **commercial wrapper** that groups one or more subscription items under shared contractual terms. The subscription manages the billing cycle, contract term, renewal policy, and lifecycle status. It does **not** reference a product directly — all product/offering/spec references live on items (see DD-INV-7).

Every subscription contains at least one item. Renewal applies to the entire subscription. Amendments (adding services) are modelled by adding new items to an existing subscription.

**Table**: `cpq_inventory_subscriptions`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `customer_id` | uuid | no | | FK to `CustomerEntity.id` |
| `code` | text | no | | Unique subscription identifier within the tenant (e.g. `SUB-2026-00042`) |
| `name` | text | no | | Display name (e.g. "GIX Access — Equinix LD5") |
| `description` | text | yes | null | Optional description |
| `status` | text | no | `'pending'` | Lifecycle status. See [Subscription Lifecycle](#subscription-lifecycle). |
| `billing_cycle` | text | no | `'monthly'` | Billing frequency: `monthly`, `quarterly`, `annually` |
| `currency_code` | text | no | `'USD'` | ISO 4217 currency code |
| `mrc_amount` | numeric(18,4) | no | `0` | Aggregate MRC — sum of all item MRCs (denormalized for query performance) |
| `nrc_amount` | numeric(18,4) | no | `0` | Aggregate NRC — sum of one-time charges from items |
| `start_date` | date | yes | null | Service start date |
| `current_term_end` | date | yes | null | Current billing term end date |
| `term_months` | integer | yes | null | Contract term in months |
| `auto_renew` | boolean | no | `true` | Whether the subscription auto-renews at term end |
| `activated_at` | timestamptz | yes | null | When the subscription went live |
| `suspended_at` | timestamptz | yes | null | When the subscription was suspended (nullable) |
| `terminated_at` | timestamptz | yes | null | When the subscription was terminated (nullable) |
| `pricing_summary` | jsonb | yes | null | `PricingSummary`-shaped aggregate (NRC total, MRC total, discounts, surcharges). Recomputed when items change. |
| `source_quote_id` | uuid | yes | null | FK to `SalesQuote.id` — originating quote |
| `source_order_id` | uuid | yes | null | FK to `SalesOrder.id` — originating order |
| `metadata` | jsonb | yes | null | Extensibility bag for client-specific data |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_inv_sub_scope_idx` | `organization_id, tenant_id` | B-tree | Tenant scoping |
| `cpq_inv_sub_code_unique` | `organization_id, tenant_id, code` | Unique | Code uniqueness per tenant |
| `cpq_inv_sub_customer_idx` | `organization_id, tenant_id, customer_id` | B-tree | Customer inventory lookup |
| `cpq_inv_sub_status_idx` | `organization_id, tenant_id, status` | B-tree | Status filtering |
| `cpq_inv_sub_source_quote_idx` | `organization_id, tenant_id, source_quote_id` | B-tree | Traceability lookup |

---

### Entity 2: CpqInventorySubscriptionItem

Represents a **concrete product or service** within a subscription. This is where all product references live — `productId`, `offeringId`, `specId`. Each item stores its own configuration snapshot, charge data, and MRC independently.

Items support parent/child hierarchy via `parentItemId`: a parent item (e.g. access port) can have child items (e.g. peering services attached to that port). This enables capacity tracking and the quoting wizard's "add child to existing parent" flow.

**Table**: `cpq_inventory_subscription_items`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `subscription_id` | uuid | no | | FK to `CpqInventorySubscription.id` |
| `customer_id` | uuid | no | | FK to `CustomerEntity.id` — denormalized from subscription for direct account-level listing |
| `parent_item_id` | uuid | yes | null | Self-referencing FK for parent/child hierarchy |
| `product_id` | uuid | yes | null | FK to `CatalogProduct.id` |
| `offering_id` | uuid | yes | null | FK to `CpqProductOffering.id` |
| `spec_id` | uuid | yes | null | FK to `CpqProductSpecification.id` |
| `name` | text | no | | Display name for the item |
| `status` | text | no | `'pending'` | Item-level status. Can differ from subscription (e.g. child suspended while parent active). |
| `configuration` | jsonb | no | `'{}'` | Attribute values snapshot for this item. Immutable. |
| `charges` | jsonb | yes | null | Charge snapshot for this item. Immutable. |
| `mrc_amount` | numeric(18,4) | no | `0` | Item-level MRC |
| `nrc_amount` | numeric(18,4) | no | `0` | Item-level NRC (e.g. setup fee for this specific service) |
| `currency_code` | text | no | `'USD'` | ISO 4217 currency code |
| `quantity` | integer | no | `1` | Number of instances |
| `capacity_total` | numeric(18,4) | yes | null | Total capacity of this item (e.g. total port bandwidth in MB). Used for parent items. |
| `capacity_used` | numeric(18,4) | yes | null | Capacity consumed by child items. Future: auto-calculated. |
| `capacity_unit` | text | yes | null | Unit label for capacity (e.g. `'MB'`, `'ports'`, `'connections'`) |
| `source_quote_line_id` | uuid | yes | null | FK to `SalesQuoteLine.id` |
| `metadata` | jsonb | yes | null | Extensibility bag |
| `sort_order` | integer | no | `0` | Display ordering within the subscription |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_inv_sub_item_scope_idx` | `organization_id, tenant_id, subscription_id` | B-tree | Items by subscription |
| `cpq_inv_sub_item_customer_idx` | `organization_id, tenant_id, customer_id` | B-tree | Items by customer (account-level listing) |
| `cpq_inv_sub_item_parent_idx` | `organization_id, tenant_id, parent_item_id` | B-tree | Child item lookup |
| `cpq_inv_sub_item_status_idx` | `organization_id, tenant_id, status` | B-tree | Status filtering |

---

### Entity 3: CpqInventoryAsset

Represents a **tangible or intangible thing** the customer owns or is entitled to — hardware, setup fees, circuit IDs, licenses, professional services, or any other deliverable. Assets always belong to a customer (account) and can optionally be linked to a subscription and/or a specific subscription item (see DD-INV-8).

**Linking model**: An asset always has `customerId`. It can optionally be linked to a `subscriptionId` (e.g. setup fee for a subscription) and/or a `subscriptionItemId` (e.g. the physical NIC for a port item). This enables three listing contexts:

1. **Account view**: all assets for customer X (`WHERE customerId = X`)
2. **Subscription view**: assets linked to subscription Y (`WHERE subscriptionId = Y`)
3. **Item view**: assets linked to subscription item Z (`WHERE subscriptionItemId = Z`)

**Table**: `cpq_inventory_assets`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | no | | Tenant scope |
| `tenant_id` | uuid | no | | Tenant scope |
| `customer_id` | uuid | no | | FK to `CustomerEntity.id` — **always set** for account-level listing |
| `subscription_id` | uuid | yes | null | FK to `CpqInventorySubscription.id` — set when asset belongs to a subscription |
| `subscription_item_id` | uuid | yes | null | FK to `CpqInventorySubscriptionItem.id` — set when asset belongs to a specific item |
| `product_id` | uuid | yes | null | FK to `CatalogProduct.id` |
| `offering_id` | uuid | yes | null | FK to `CpqProductOffering.id` |
| `spec_id` | uuid | yes | null | FK to `CpqProductSpecification.id` |
| `code` | text | no | | Unique asset identifier within the tenant (e.g. `AST-2026-00015`) |
| `name` | text | no | | Display name (e.g. "GIX Access Port Setup — Equinix LD5") |
| `description` | text | yes | null | Optional description |
| `status` | text | no | `'pending'` | Lifecycle status. See [Asset Lifecycle](#asset-lifecycle). |
| `asset_type` | text | no | `'one_time'` | Classification: `one_time` (setup fee, hardware), `license`, `physical`, `logical`. Extensible via metadata. |
| `currency_code` | text | no | `'USD'` | ISO 4217 currency code |
| `purchase_price` | numeric(18,4) | no | `0` | One-time purchase/charge amount |
| `quantity` | integer | no | `1` | Number of units |
| `purchase_date` | date | yes | null | Date of purchase |
| `delivery_date` | date | yes | null | Date of delivery/fulfilment |
| `configuration` | jsonb | no | `'{}'` | Attribute values snapshot. Immutable. |
| `charges` | jsonb | yes | null | Charge snapshot. Immutable. |
| `source_quote_id` | uuid | yes | null | FK to `SalesQuote.id` |
| `source_order_id` | uuid | yes | null | FK to `SalesOrder.id` |
| `source_quote_line_id` | uuid | yes | null | FK to `SalesQuoteLine.id` |
| `metadata` | jsonb | yes | null | Extensibility bag (serial numbers, warranty dates, circuit IDs, IP addresses, etc.) |
| `created_at` | timestamptz | no | now | |
| `updated_at` | timestamptz | no | now | |
| `deleted_at` | timestamptz | yes | | Soft delete |

**Indexes**:

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `cpq_inv_asset_scope_idx` | `organization_id, tenant_id` | B-tree | Tenant scoping |
| `cpq_inv_asset_code_unique` | `organization_id, tenant_id, code` | Unique | Code uniqueness per tenant |
| `cpq_inv_asset_customer_idx` | `organization_id, tenant_id, customer_id` | B-tree | All assets for a customer |
| `cpq_inv_asset_status_idx` | `organization_id, tenant_id, status` | B-tree | Status filtering |
| `cpq_inv_asset_sub_idx` | `organization_id, tenant_id, subscription_id` | B-tree | Assets for a subscription |
| `cpq_inv_asset_item_idx` | `organization_id, tenant_id, subscription_item_id` | B-tree | Assets for a subscription item |

---

## Status Lifecycle

### Subscription Lifecycle

Subscriptions follow a defined status progression stored on `CpqInventorySubscription.status`.

| Status | Description |
|--------|-------------|
| `pending` | Subscription created from order but not yet provisioned/activated |
| `active` | Subscription is live and billing |
| `suspended` | Temporarily paused (e.g. non-payment, customer request). Can be reactivated. |
| `terminated` | Permanently ended. Terminal state. |
| `expired` | Term ended without renewal. Terminal state. |

**Allowed transitions**:

```
pending    → active                  (provisioned and activated)
pending    → terminated              (cancelled before activation)
active     → suspended               (temporarily paused)
active     → terminated              (permanently ended)
active     → expired                 (term ended, no renewal)
suspended  → active                  (reactivated)
suspended  → terminated              (permanently ended while suspended)
terminated → (terminal)
expired    → (terminal)
```

**Timestamp tracking**: when a transition occurs, the corresponding timestamp field is set:
- `pending → active`: sets `activatedAt`
- `active → suspended`: sets `suspendedAt`
- `suspended → active`: clears `suspendedAt`
- `* → terminated`: sets `terminatedAt`

### Asset Lifecycle

Assets follow a progression stored on `CpqInventoryAsset.status`.

| Status | Description |
|--------|-------------|
| `pending` | Asset created but not yet delivered/fulfilled |
| `delivered` | Asset has been delivered/fulfilled |
| `active` | Asset is in use / active in the customer's environment |
| `returned` | Asset was returned (for physical goods) or reversed |
| `cancelled` | Asset was cancelled before delivery |

**Allowed transitions**:

```
pending   → delivered                (fulfilled)
pending   → active                   (directly activated — e.g. digital/logical assets)
pending   → cancelled               (cancelled before delivery)
delivered → active                   (put into service)
delivered → returned                 (returned/reversed)
active    → returned                 (returned after use)
returned  → (terminal)
cancelled → (terminal)
```

### Subscription Item Status

`CpqInventorySubscriptionItem.status` mirrors the subscription lifecycle statuses (`pending`, `active`, `suspended`, `terminated`, `expired`) but can differ from the parent subscription. For example, a parent subscription may be `active` while an individual child item is `suspended`. When a parent subscription is terminated, all child items must also be terminated.

---

## Service Layer

### CpqInventoryService

Orchestrates inventory operations. Registered as `cpqInventoryService` in the Awilix DI container (scoped lifetime).

```typescript
interface CpqInventoryService {
  // --- Subscriptions ---

  /** List subscriptions with filtering and pagination. */
  listSubscriptions(
    filters: SubscriptionListFilters,
    scope: TenantScope,
  ): Promise<PaginatedResult<InventorySubscriptionResult>>

  /** Get a single subscription with its items (tree structure). */
  getSubscription(
    subscriptionId: string,
    scope: TenantScope,
  ): Promise<InventorySubscriptionDetailResult>

  /** Create a new subscription (manual or from order provisioning). */
  createSubscription(
    input: CreateSubscriptionInput,
    scope: TenantScope,
  ): Promise<InventorySubscriptionResult>

  /** Transition subscription status. Validates allowed transitions. */
  transitionSubscriptionStatus(
    subscriptionId: string,
    targetStatus: string,
    scope: TenantScope,
  ): Promise<InventorySubscriptionResult>

  /** Add an item to an existing subscription. Recomputes subscription aggregate MRC/NRC/pricingSummary. */
  addSubscriptionItem(
    subscriptionId: string,
    input: CreateSubscriptionItemInput,
    scope: TenantScope,
  ): Promise<InventorySubscriptionItemResult>

  /** Update a subscription item's mutable fields (not configuration/charges — snapshots are immutable). Recomputes parent subscription aggregates. */
  updateSubscriptionItem(
    itemId: string,
    input: UpdateSubscriptionItemInput,
    scope: TenantScope,
  ): Promise<InventorySubscriptionItemResult>

  // --- Assets ---

  /** List assets with filtering and pagination. */
  listAssets(
    filters: AssetListFilters,
    scope: TenantScope,
  ): Promise<PaginatedResult<InventoryAssetResult>>

  /** Get a single asset. */
  getAsset(
    assetId: string,
    scope: TenantScope,
  ): Promise<InventoryAssetResult>

  /** Create a new asset (standalone, or linked to subscription/item). */
  createAsset(
    input: CreateAssetInput,
    scope: TenantScope,
  ): Promise<InventoryAssetResult>

  /** Update asset mutable fields (not configuration/charges — snapshots are immutable). */
  updateAsset(
    assetId: string,
    input: UpdateAssetInput,
    scope: TenantScope,
  ): Promise<InventoryAssetResult>

  /** Transition asset status. Validates allowed transitions. */
  transitionAssetStatus(
    assetId: string,
    targetStatus: string,
    scope: TenantScope,
  ): Promise<InventoryAssetResult>

  // --- Combined Customer View ---

  /** Get full inventory for a customer (subscriptions, subscription items, assets). */
  getCustomerInventory(
    customerId: string,
    filters: CustomerInventoryFilters,
    scope: TenantScope,
  ): Promise<CustomerInventoryResult>

  /** Get active parent subscription items for a customer — used by quoting wizard "add child" flow. */
  getCustomerParentItems(
    customerId: string,
    filters: { productId?: string; offeringId?: string },
    scope: TenantScope,
  ): Promise<InventorySubscriptionItemResult[]>

  // --- Provisioning ---

  /**
   * Create inventory records from a completed order's CPQ configuration.
   * Reads CpqQuoteLineConfiguration data and creates subscriptions/fixed items.
   * Defined for future event-driven provisioning (R-INV-6).
   */
  provisionFromOrder(
    orderId: string,
    scope: TenantScope,
  ): Promise<ProvisioningResult>
}
```

### Input Types

```typescript
interface SubscriptionListFilters {
  customerId?: string
  status?: string | string[]
  productId?: string           // Matches subscriptions containing items with this productId
  page?: number
  pageSize?: number
}

interface AssetListFilters {
  customerId?: string
  status?: string | string[]
  productId?: string
  assetType?: string
  subscriptionId?: string
  subscriptionItemId?: string
  page?: number
  pageSize?: number
}

interface CustomerInventoryFilters {
  status?: string | string[]
  productId?: string           // Matches subscriptions/items containing this productId
  includeTerminated?: boolean   // Default false — excludes terminated/expired/cancelled
}

interface CreateSubscriptionInput {
  customerId: string
  code?: string                 // Auto-generated if not provided
  name: string
  description?: string
  billingCycle?: 'monthly' | 'quarterly' | 'annually'
  currencyCode?: string
  startDate?: string            // ISO date
  termMonths?: number
  autoRenew?: boolean
  sourceQuoteId?: string
  sourceOrderId?: string
  metadata?: Record<string, unknown>
  items: CreateSubscriptionItemInput[]   // At least one item required
}

interface CreateSubscriptionItemInput {
  parentItemId?: string
  productId?: string
  offeringId?: string
  specId?: string
  name: string
  configuration?: Record<string, unknown>
  charges?: Array<Record<string, unknown>>
  mrcAmount?: number
  nrcAmount?: number
  currencyCode?: string
  quantity?: number
  capacityTotal?: number
  capacityUnit?: string
  sourceQuoteLineId?: string
  metadata?: Record<string, unknown>
  sortOrder?: number
}

interface UpdateSubscriptionItemInput {
  name?: string
  metadata?: Record<string, unknown>
  capacityTotal?: number
  capacityUsed?: number
  capacityUnit?: string
  sortOrder?: number
}

interface CreateAssetInput {
  customerId: string
  subscriptionId?: string           // Link to subscription (optional)
  subscriptionItemId?: string       // Link to subscription item (optional)
  productId?: string
  offeringId?: string
  specId?: string
  code?: string                     // Auto-generated as AST-{YYYY}-{seq} if not provided
  name: string
  description?: string
  assetType?: 'one_time' | 'license' | 'physical' | 'logical'
  currencyCode?: string
  purchasePrice?: number
  quantity?: number
  purchaseDate?: string
  deliveryDate?: string
  configuration?: Record<string, unknown>
  charges?: Array<Record<string, unknown>>
  sourceQuoteId?: string
  sourceOrderId?: string
  sourceQuoteLineId?: string
  metadata?: Record<string, unknown>
}

interface UpdateAssetInput {
  name?: string
  description?: string
  assetType?: string
  deliveryDate?: string
  metadata?: Record<string, unknown>
}
```

### Result Types

```typescript
interface InventorySubscriptionResult {
  id: string
  customerId: string
  code: string
  name: string
  description: string | null
  status: string
  billingCycle: string
  currencyCode: string
  mrcAmount: number            // Aggregate: sum of item MRCs
  nrcAmount: number            // Aggregate: sum of item NRCs
  startDate: string | null
  currentTermEnd: string | null
  termMonths: number | null
  autoRenew: boolean
  activatedAt: string | null
  suspendedAt: string | null
  terminatedAt: string | null
  pricingSummary: Record<string, unknown> | null
  sourceQuoteId: string | null
  sourceOrderId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

interface InventorySubscriptionDetailResult extends InventorySubscriptionResult {
  items: InventorySubscriptionItemResult[]
}

interface InventorySubscriptionItemResult {
  id: string
  subscriptionId: string
  parentItemId: string | null
  productId: string | null
  offeringId: string | null
  specId: string | null
  name: string
  status: string
  configuration: Record<string, unknown>
  charges: Array<Record<string, unknown>> | null
  mrcAmount: number
  nrcAmount: number
  currencyCode: string
  quantity: number
  capacityTotal: number | null
  capacityUsed: number | null
  capacityUnit: string | null
  metadata: Record<string, unknown> | null
  sortOrder: number
  children: InventorySubscriptionItemResult[]   // Recursive tree
}

interface InventoryAssetResult {
  id: string
  customerId: string
  subscriptionId: string | null
  subscriptionItemId: string | null
  productId: string | null
  offeringId: string | null
  specId: string | null
  code: string
  name: string
  description: string | null
  status: string
  assetType: string
  currencyCode: string
  purchasePrice: number
  quantity: number
  purchaseDate: string | null
  deliveryDate: string | null
  configuration: Record<string, unknown>
  charges: Array<Record<string, unknown>> | null
  sourceQuoteId: string | null
  sourceOrderId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

interface CustomerInventoryResult {
  customerId: string
  subscriptions: InventorySubscriptionResult[]
  subscriptionItems: InventorySubscriptionItemResult[]   // Flat list of all items for this customer
  assets: InventoryAssetResult[]
  summary: {
    activeSubscriptions: number
    totalMrc: number
    activeAssets: number
    pendingItems: number
    currencyCode: string
  }
}

interface ProvisioningResult {
  orderId: string
  subscriptionsCreated: string[]    // IDs of new subscriptions
  assetsCreated: string[]           // IDs of new assets
  errors: Array<{ lineId: string; message: string }>
}
```

---

## API Design

All APIs are scoped by `organizationId` + `tenantId` from auth context. All follow existing patterns in `src/modules/cpq/api/`.

### Subscriptions — `/api/cpq/inventory/subscriptions`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.inventory.view` | List subscriptions (paginated, filtered) or fetch a single subscription with items |
| `POST` | `cpq.inventory.manage` | Create a new subscription (with optional initial items) |
| `PUT` | `cpq.inventory.manage` | Update subscription metadata (not immutable snapshots) |
| `DELETE` | `cpq.inventory.manage` | Soft-delete a subscription |

#### GET — list (no `?id`)

```
GET /api/cpq/inventory/subscriptions?customerId=<uuid>&status=active&page=1&pageSize=50
```

| Param | Required | Description |
|-------|----------|-------------|
| `customerId` | No | Filter by customer |
| `status` | No | Comma-separated list of statuses (e.g. `active,suspended`) |
| `productId` | No | Filter by catalog product — matches subscriptions that contain at least one item with this `productId` |
| `page` | No | Default `1` |
| `pageSize` | No | Default `50`, max `100` |

Response:

```typescript
{
  items: InventorySubscriptionResult[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
```

#### GET — single with items (`?id=<uuid>`)

```
GET /api/cpq/inventory/subscriptions?id=<uuid>
```

Returns the subscription record plus all its items as a nested tree in `items`.

Response: `InventorySubscriptionDetailResult`

#### POST — create subscription

```
POST /api/cpq/inventory/subscriptions
```

Request: `CreateSubscriptionInput` (validated by `cpqInventorySubscriptionCreateSchema`).

The `items` array is **required** and must contain at least one item. Subscription and items are created atomically. The subscription's `mrcAmount`, `nrcAmount`, and `pricingSummary` are computed from the items.

If `code` is not provided, it is auto-generated as `SUB-{YYYY}-{sequential}`.

Response: `201 Created` with `InventorySubscriptionDetailResult`.

#### PUT — update subscription

```
PUT /api/cpq/inventory/subscriptions
```

Body: `{ id: string } & Partial<{ name, description, billingCycle, autoRenew, termMonths, currentTermEnd, metadata }>`.

`mrcAmount`, `nrcAmount`, and `pricingSummary` are recomputed from items — they cannot be set directly.

#### DELETE — soft-delete

Body: `{ id: string }`. Sets `deletedAt`. Returns `{ success: true }`.

### Subscription Status — `/api/cpq/inventory/subscriptions/status`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `POST` | `cpq.inventory.manage` | Transition subscription status |

```
POST /api/cpq/inventory/subscriptions/status
```

Request:

```typescript
{
  id: string
  targetStatus: string
}
```

Validates that the transition is allowed per [Subscription Lifecycle](#subscription-lifecycle). Sets the corresponding timestamp field. If transitioning to `terminated`, also terminates all active child items.

Response: `InventorySubscriptionResult`

### Subscription Items — `/api/cpq/inventory/subscription-items`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.inventory.view` | List items for a subscription |
| `POST` | `cpq.inventory.manage` | Add item to a subscription |
| `PUT` | `cpq.inventory.manage` | Update item metadata |
| `DELETE` | `cpq.inventory.manage` | Soft-delete an item |

#### GET — list items

```
GET /api/cpq/inventory/subscription-items?subscriptionId=<uuid>&parentItemId=<uuid>
```

| Param | Required | Description |
|-------|----------|-------------|
| `subscriptionId` | Yes* | Filter by subscription. Required unless `parentItemId` is provided. |
| `parentItemId` | No | Filter by parent item — returns direct children only (covers domain API `getChildItems`). When provided, `subscriptionId` is optional (inferred from parent). |
| `status` | No | Filter by item status |

\* Either `subscriptionId` or `parentItemId` must be provided.

Returns items as a flat list (the client builds the tree using `parentItemId`).

#### POST — add item

```
POST /api/cpq/inventory/subscription-items
```

Request: `CreateSubscriptionItemInput` with required `subscriptionId`.

If `parentItemId` is provided, validates that the parent item exists and belongs to the same subscription.

Response: `201 Created` with `InventorySubscriptionItemResult`.

### Assets — `/api/cpq/inventory/assets`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.inventory.view` | List assets (paginated, filtered) or fetch a single asset |
| `POST` | `cpq.inventory.manage` | Create a new asset (standalone or linked to subscription/item) |
| `PUT` | `cpq.inventory.manage` | Update asset mutable fields |
| `DELETE` | `cpq.inventory.manage` | Soft-delete an asset |

#### GET — list assets

```
GET /api/cpq/inventory/assets?customerId=<uuid>&status=active&assetType=physical&page=1
```

| Param | Required | Description |
|-------|----------|-------------|
| `customerId` | No | Filter by customer — primary use case for account-level asset listing |
| `status` | No | Comma-separated list of statuses |
| `assetType` | No | Filter by type: `one_time`, `license`, `physical`, `logical` |
| `productId` | No | Filter by catalog product |
| `subscriptionId` | No | Assets linked to a specific subscription |
| `subscriptionItemId` | No | Assets linked to a specific subscription item |
| `page` | No | Default `1` |
| `pageSize` | No | Default `50`, max `100` |

#### GET — single (`?id=<uuid>`)

Returns `InventoryAssetResult`.

#### POST — create asset

Request: `CreateAssetInput` (validated by `cpqInventoryAssetCreateSchema`).

If `subscriptionId` or `subscriptionItemId` is provided, validates that the referenced record exists and belongs to the same customer. `customerId` is always required.

If `code` is not provided, it is auto-generated as `AST-{YYYY}-{sequential}`.

Response: `201 Created` with `InventoryAssetResult`.

### Asset Status — `/api/cpq/inventory/assets/status`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `POST` | `cpq.inventory.manage` | Transition asset status |

Same pattern as subscription status. Validates transitions per [Asset Lifecycle](#asset-lifecycle).

### Customer Inventory — `/api/cpq/inventory/customer/[customerId]`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.inventory.view` | Combined inventory view for a customer |

```
GET /api/cpq/inventory/customer/<customerId>?status=active&includeTerminated=false
```

Returns `CustomerInventoryResult` — combined subscriptions, subscription items, and assets with summary counts.

### Customer Parent Items — `/api/cpq/inventory/customer/[customerId]/parent-items`

| Method | Feature flag | Description |
|--------|-------------|-------------|
| `GET` | `cpq.inventory.view` | Active parent subscription items for quoting |

```
GET /api/cpq/inventory/customer/<customerId>/parent-items?productId=<uuid>
```

Returns active subscription items that have no `parentItemId` (top-level items). Includes capacity information (`capacityTotal`, `capacityUsed`, `capacityUnit`). Used by the quoting wizard when adding child services to an existing parent item (R-INV-5).

The quoting wizard should compute remaining capacity as `capacityTotal - capacityUsed` before allowing child additions. Until automated capacity tracking is implemented (G-INV-1), `capacityUsed` reflects the last manually-set value.

Response: `InventorySubscriptionItemResult[]` (without recursive `children` — flat list of parents only).

---

## UI Integration

### Customer Detail Tab — Injection Widget

The inventory tab is injected into both company and person customer detail views using the injection widget pattern established by the quote configurator.

**Injection table entries** (added to `src/modules/cpq/widgets/injection-table.ts`):

```typescript
'detail:customers.company:tabs': [
  {
    widgetId: 'cpq.injection.customer-inventory',
    kind: 'tab',
    groupLabel: 'Inventory',
    groupDescription: 'Products and services purchased by this customer',
    priority: 60,
  },
],
'detail:customers.person:tabs': [
  {
    widgetId: 'cpq.injection.customer-inventory',
    kind: 'tab',
    groupLabel: 'Inventory',
    groupDescription: 'Products and services purchased by this customer',
    priority: 60,
  },
],
```

**Widget module** (`src/modules/cpq/widgets/injection/customer-inventory/widget.ts`):

```typescript
const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'cpq.injection.customer-inventory',
    title: 'Customer Inventory',
    description: 'Products and services purchased by this customer',
    features: ['cpq.inventory.view'],
    priority: 60,
    enabled: true,
  },
  Widget: CustomerInventoryWidget,
}
```

**Tab UI layout**:

The widget renders two sections within the tab:

1. **Subscriptions** — a table showing active/pending subscriptions with columns: Code, Name, Status, MRC (aggregate), Billing Cycle, Start Date, Term End. Each row is expandable to show subscription items in a tree view (parent items with nested children, each showing its product name and individual MRC).

2. **Subscription Items** — a flat table showing all subscription items directly owned by the customer with columns: Name, Product, Status, Subscription (link), MRC, NRC. Grouped by subscription or displayed as a flat sortable list.

3. **Assets** — a table showing all assets for the customer with columns: Code, Name, Type, Status, Product, Purchase Price, Linked To (subscription/item name or "Standalone"). Filterable by asset type and status.

All three sections include a status filter (default: hide terminated/expired/cancelled) and a link to the full inventory page.

### Dedicated Inventory Page

Backend page at `/backend/cpq/inventory` placed under the **Customers** navigation group.

**Page metadata** (`src/modules/cpq/backend/cpq/inventory/page.meta.ts`):

```typescript
export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.inventory.view'],
  pageTitle: 'Customer Inventory',
  pageTitleKey: 'cpq.inventory.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pageOrder: 85,
  icon: inventoryIcon,
  breadcrumb: [{ label: 'Customer Inventory', labelKey: 'cpq.inventory.title' }],
} as const
```

**Page layout**:

- Full-width list view with tabs: "Subscriptions" | "Subscription Items" | "Assets"
- Filters: customer search, status multi-select, product filter, date range, asset type
- Subscription list supports expanding rows to show items tree
- Subscription Items tab shows flat list with customer and subscription columns
- Assets tab shows flat list with linkage info (subscription/item or standalone)
- Row actions: view details, transition status
- "New Subscription" / "New Asset" buttons (requires `cpq.inventory.manage`)
- Click-through to customer detail page

---

## Requirements Traceability

| Domain Requirement | Implementation |
|-------------------|----------------|
| R-INV-1: Customer Inventory View | Injection widget on `detail:customers.company:tabs` and `detail:customers.person:tabs`. Shows subscriptions (tree), subscription items (flat list), and assets (table with linkage info) within a single "Inventory" tab. |
| R-INV-2: Dedicated Inventory Page | Backend page at `/backend/cpq/inventory` under the Customers navigation group with filtering by customer, product, status. |
| R-INV-3: Configuration Snapshot | `configuration` and `charges` JSONB fields on subscription items and assets are immutable — set at creation time and never modified via update APIs. Subscription is a wrapper and does not carry its own configuration. |
| R-INV-4: Parent/Child Hierarchy | `CpqInventorySubscriptionItem.parentItemId` self-reference. Items are loaded as a tree in the detail view. |
| R-INV-5: Capacity Tracking | `capacityTotal`, `capacityUsed`, and `capacityUnit` fields on subscription items. Auto-calculation deferred (see G-INV-1). Manual values supported via API. `getCustomerParentItems` endpoint supports quoting wizard "add child" flow. |
| R-INV-6: Event-Driven Provisioning | `provisionFromOrder(orderId)` method defined on `CpqInventoryService`. Event subscriber wiring deferred (see G-INV-2). Manual provisioning via API supported. |
| R-INV-7: Status Lifecycle | Defined state machines for subscriptions and fixed items with explicit allowed transitions and timestamp tracking. |
| R-GEN-1: Product Agnostic | Inventory stores product/offering/spec references but has no product-specific logic. All domain knowledge lives in configuration snapshots. |
| R-GEN-2: Open-Close Principle | No modifications to `@open-mercato/*` packages. Customer tab added via injection widgets. |
| R-GEN-3: Multi-Tenancy | All queries scoped by `organizationId` + `tenantId`. |
| R-GEN-4: Standard Integration | Inventory references standard `SalesQuote` / `SalesOrder` IDs for traceability. Uses `CustomerEntity.id` for customer linkage. |
| R-GEN-5: Extensibility via DI | `CpqInventoryService` registered in Awilix, overridable by downstream consumers. |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Request body fails Zod validation | `{ "error": "Validation error", "details": [...ZodIssue] }` |
| `400 Bad Request` | GET missing required query param | `{ "error": "<param> is required" }` |
| `401 Unauthorized` | No valid session or missing feature flag | `{ "error": "Unauthorized" }` |
| `404 Not Found` | Subscription, item, or fixed item not found | `{ "error": "Not found" }` |
| `409 Conflict` | Invalid status transition | `{ "error": "Cannot transition from '<current>' to '<target>'" }` |
| `409 Conflict` | Parent item not in same subscription | `{ "error": "Parent item does not belong to this subscription" }` |
| `422 Unprocessable Entity` | Attempting to modify immutable field on item/fixed item | `{ "error": "Field '<field>' is immutable after creation" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

---

## ACL / Feature Flags

New flags added to `setup.ts` `defaultRoleFeatures`:

| Feature | Description |
|---------|-------------|
| `cpq.inventory.view` | View inventory: list subscriptions, fixed items, customer inventory tab, parent items |
| `cpq.inventory.manage` | Create, update, delete inventory records. Transition statuses. |

Role assignments:

| Role | Features |
|------|----------|
| `admin` | `cpq.inventory.view`, `cpq.inventory.manage` |
| `employee` | `cpq.inventory.view` |

---

## Extensibility Points

### DD-INV-6: Client-Specific Extensions

The inventory model is designed as a generic foundation. Client-specific implementations can extend it through several mechanisms:

1. **`metadata` JSONB** — every entity carries a `metadata` field for arbitrary key-value data. Client specs can define their own metadata schemas (e.g. warranty dates, SLA tiers, circuit IDs) without schema changes.

2. **DI override** — `CpqInventoryService` is registered in Awilix and can be replaced or wrapped by a client-specific implementation that adds validation rules, custom provisioning logic, or integration hooks.

3. **Event hooks** — the `provisionFromOrder` method is the designated integration point. Client implementations can subscribe to order events and call this method, or implement their own provisioning logic by overriding the service.

4. **Injection widgets** — additional customer detail tab content can be injected alongside the inventory tab via the standard injection widget pattern.

5. **Custom entity specs** — the `ce.ts` entity specs can be extended with client-specific fields via the Open Mercato custom fields system.

6. **Capacity tracking** — `capacityTotal`, `capacityUsed`, and `capacityUnit` fields are present but not auto-calculated. Client specs can implement capacity logic by overriding the inventory service or adding a capacity calculation enricher.

### Future: Typed Asset Subtypes

The `CpqInventoryAsset` entity uses `assetType` and `metadata` JSONB to classify and extend asset records. A future spec can introduce typed asset subtypes (e.g. `CpqInventoryPhysicalAsset` with serial number, warranty, location fields; `CpqInventoryLogicalAsset` with circuit ID, IP range) if structured querying on these fields becomes a requirement. The current model covers all use cases via `metadata`.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/modules/cpq/data/entities.ts` | Modify | Add `CpqInventorySubscription`, `CpqInventorySubscriptionItem`, `CpqInventoryAsset` entity classes |
| `src/modules/cpq/data/validators.ts` | Modify | Add Zod schemas: `cpqInventorySubscriptionCreateSchema`, `cpqInventorySubscriptionUpdateSchema`, `cpqInventoryAssetCreateSchema`, `cpqInventoryAssetUpdateSchema`, `cpqInventoryStatusTransitionSchema`, `cpqInventorySubscriptionItemCreateSchema`, `cpqInventorySubscriptionItemUpdateSchema` |
| `src/modules/cpq/services/cpqInventoryService.ts` | Create | `DefaultCpqInventoryService` implementing `CpqInventoryService` interface |
| `src/modules/cpq/services/types.ts` | Modify | Add inventory status constants (`INVENTORY_SUBSCRIPTION_STATUSES`, `INVENTORY_ASSET_STATUSES`, `INVENTORY_ALLOWED_TRANSITIONS`), input/result types |
| `src/modules/cpq/di.ts` | Modify | Register `cpqInventoryService` as scoped Awilix factory |
| `src/modules/cpq/ce.ts` | Modify | Add entity specs: `cpq:cpq_inventory_subscription`, `cpq:cpq_inventory_subscription_item`, `cpq:cpq_inventory_asset` |
| `src/modules/cpq/setup.ts` | Modify | Add `cpq.inventory.view` and `cpq.inventory.manage` to `defaultRoleFeatures` |
| `src/modules/cpq/api/inventory/subscriptions/route.ts` | Create | CRUD endpoints for subscriptions |
| `src/modules/cpq/api/inventory/subscriptions/status/route.ts` | Create | Status transition endpoint for subscriptions |
| `src/modules/cpq/api/inventory/subscription-items/route.ts` | Create | CRUD endpoints for subscription items |
| `src/modules/cpq/api/inventory/assets/route.ts` | Create | CRUD endpoints for assets |
| `src/modules/cpq/api/inventory/assets/status/route.ts` | Create | Status transition endpoint for assets |
| `src/modules/cpq/api/inventory/customer/[customerId]/route.ts` | Create | Combined customer inventory endpoint |
| `src/modules/cpq/api/inventory/customer/[customerId]/parent-items/route.ts` | Create | Parent items endpoint for quoting |
| `src/modules/cpq/widgets/injection-table.ts` | Modify | Add `detail:customers.company:tabs` and `detail:customers.person:tabs` entries |
| `src/modules/cpq/widgets/injection/customer-inventory/widget.ts` | Create | Injection widget module for customer inventory tab |
| `src/modules/cpq/widgets/injection/customer-inventory/CustomerInventoryWidget.tsx` | Create | React component for the customer inventory tab |
| `src/modules/cpq/backend/cpq/inventory/page.tsx` | Create | Dedicated inventory list page |
| `src/modules/cpq/backend/cpq/inventory/page.meta.ts` | Create | Page metadata (Customers nav group, pageOrder 85) |
| `src/modules/cpq/backend/cpq/inventory/[id]/page.tsx` | Create | Subscription/item detail page |
| `src/modules/cpq/migrations/Migration_..._cpq_inventory.ts` | Create | Database migration: create `cpq_inventory_subscriptions`, `cpq_inventory_subscription_items`, `cpq_inventory_assets` tables with all indexes |
| `src/i18n/en.json` | Modify | Add `cpq.inventory.*` translation keys |

---

## Migration Strategy

### Phase 1: Schema + Service (this spec)

1. Create database migration with all three tables and indexes (`IF NOT EXISTS` for idempotency)
2. Add entity classes to `entities.ts`
3. Register custom entity specs in `ce.ts`
4. Implement `DefaultCpqInventoryService`
5. Register in DI container
6. Create API routes
7. Add feature flags to `setup.ts`
8. Run `yarn generate` to update generated files

### Phase 2: UI

1. Add injection table entries for customer tabs
2. Create injection widget module + React component
3. Create backend inventory list page + detail page
4. Add i18n translation keys

### Phase 3: Integration (future)

1. Wire `sales.order.created` event subscriber to call `provisionFromOrder`
2. Implement capacity auto-calculation on subscription items
3. Integrate with quoting domain: `action: 'modify'` / `action: 'cancel'` referencing inventory items
4. Auto-create assets when provisioning subscriptions (e.g. setup fee → asset linked to subscription)

---

## Design Decisions

### DD-INV-1: Three Entities — Subscription, Subscription Item, Asset

**Decision**: Use three separate tables: `cpq_inventory_subscriptions` (commercial wrapper), `cpq_inventory_subscription_items` (recurring product/service records), and `cpq_inventory_assets` (tangible/intangible things the customer owns).

**Rationale**: Each entity has fundamentally different semantics, lifecycle, fields, and query patterns. Subscriptions manage billing/term/renewal. Subscription items hold product references and recurring pricing within a subscription context. Assets represent deliverables (hardware, licenses, setup fees) with a fulfillment lifecycle. Separate tables allow each to evolve independently and avoid null columns. All three link to the customer account for unified listing.

### DD-INV-2: Subscription Items as a Separate Entity

**Decision**: Introduce `CpqInventorySubscriptionItem` rather than embedding items in the subscription's JSONB.

**Rationale**: Items need their own lifecycle (individual suspension), parent/child hierarchy (self-referencing FK), capacity tracking, and independent querying. A separate entity supports the quoting wizard's "add child to existing parent" flow (R-INV-5) which requires querying parent items across subscriptions.

### DD-INV-3: Immutable Configuration Snapshots

**Decision**: `configuration` and `charges` fields on **subscription items** and **assets** are set at creation time and cannot be modified via update APIs (R-INV-3). The subscription wrapper does not carry configuration or charges — those live exclusively on items and assets.

**Rationale**: Inventory items and assets represent the state at time of purchase. If pricing tables or product definitions change, existing records must not be retroactively affected. This ensures billing accuracy and audit compliance. If a subscription is renegotiated, the approach is to add new items (amendment) or create a new subscription (future MACD flow) rather than modify existing snapshots.

### DD-INV-4: Code Auto-Generation

**Decision**: `code` fields are auto-generated if not provided (e.g. `SUB-2026-00042`, `FI-2026-00015`).

**Rationale**: Provides a human-readable, sequential identifier for each inventory record without requiring the API caller to manage numbering. Uses the Open Mercato `SalesDocumentNumberGenerator` pattern. Callers can override with a custom code if their system has its own numbering scheme.

### DD-INV-5: Inventory Page in Customers Group

**Decision**: Place the inventory list page under the `Customers` navigation group rather than the `CPQ` group.

**Rationale**: Inventory is customer-centric — users typically browse inventory per customer, not per product. Placing it alongside other customer-facing pages (companies, people, deals) matches the mental model of "what does this customer have?" The CPQ navigation group remains focused on quote-time activities (quotes, pricing, specifications, offerings).

### DD-INV-7: Subscription as Pure Wrapper (Steelbrick Model)

**Decision**: `CpqInventorySubscription` does not carry `productId`, `offeringId`, `specId`, `configuration`, or `charges`. All product references and configuration snapshots live exclusively on `CpqInventorySubscriptionItem`. The subscription is a commercial wrapper managing shared contractual terms (billing cycle, term, renewal, status).

**Rationale**: Having product references at both the subscription and item level creates ambiguity — is the "product" the one on the subscription or the one on the item? The wrapper model eliminates this inconsistency:

- **Subscription** = commercial container: *who* (customer), *when* (term, billing cycle), *how much* (aggregate MRC/NRC), *lifecycle* (status, renewal)
- **Item** = product record: *what* (product, offering, spec), *configured how* (configuration snapshot), *priced how* (charges snapshot)

This mirrors the Salesforce CPQ (Steelbrick) model where `Subscription` groups `SubscriptionProduct` line items. Renewal applies to the entire subscription. Amendments are modelled by adding items to an existing subscription. Every subscription must have at least one item.

**Trade-off**: Businesses that sell single-product subscriptions must still create a subscription + 1 item (two records instead of one). This is acceptable because: (a) the item creation is atomic with the subscription via the POST API, (b) UI can hide the wrapper when there's only one item, and (c) it avoids the inconsistency of products appearing at two levels.

---

### DD-INV-8: Asset Linking Model

**Decision**: Assets link to subscriptions and subscription items via optional FKs on the asset (`subscriptionId`, `subscriptionItemId`), not via FKs on the subscription/item side. Assets always have a required `customerId` for account-level listing.

**Rationale**: The relationship is many-from-one: a subscription or subscription item can have multiple assets (e.g. a port item might have both a physical NIC asset and a logical circuit ID asset). Placing the FK on the asset side naturally supports one-to-many from subscription/item to assets. The `customerId` on every asset enables the primary use case: "show all assets for this customer" without joins. Assets can also be standalone (no subscription/item link) — e.g. hardware purchased outside of a subscription context.

Similarly, `CpqInventorySubscriptionItem` carries a denormalized `customerId` (copied from the parent subscription) so that subscription items can be listed directly under a customer account without joining through the subscription table.

---

### DD-INV-6: Metadata JSONB for Extensibility

**Decision**: Add `metadata` JSONB field to all inventory entities.

**Rationale**: Client specifications will need domain-specific fields (warranty dates for hardware, SLA tiers for services, circuit IDs for network products). Rather than adding nullable columns for every possible extension, the metadata bag provides a schema-free escape hatch. Client specs can define their own metadata shapes and validate them at the service layer.

---

## Known Gaps and Limitations

### G-INV-1: No automated capacity tracking

`capacityTotal`, `capacityUsed`, and `capacityUnit` fields exist on subscription items but the system does not auto-calculate `capacityUsed`. The quoting wizard's "add child" validation must manually check available capacity by summing child item quantities. Auto-calculation is a future enhancement.

### G-INV-2: No event-driven provisioning

The `provisionFromOrder` service method is defined but the `sales.order.created` event subscriber is not implemented. Inventory records must be created manually via the API. The event subscriber will be implemented when the order-to-inventory flow is fully specified.

### G-INV-3: No billing integration

Inventory records store MRC/NRC amounts as snapshots but there is no connection to invoicing or recurring billing systems. Billing integration is out of scope for this module.

### G-INV-4: No subscription renewal automation

`autoRenew` flag is stored but no scheduler or cron job extends the term automatically. Renewal must be triggered manually or by a future workflow.

### G-INV-5: No inventory history/audit trail

Status transitions set timestamps but there is no dedicated history table tracking who changed what and when. A future `CpqInventoryEvent` entity could provide a full audit trail.

### G-INV-6: No MACD integration with quoting

The quoting domain's `action: 'modify'` and `action: 'cancel'` (G-QUOTE-5 in XD-201) are not yet connected to inventory. Implementing MACD flows requires this inventory spec as a foundation, plus a follow-up spec defining how quotes reference and modify existing inventory items.

### G-INV-7: Assets have no parent/child hierarchy

Unlike subscription items, assets are flat. If a client needs hierarchical assets (e.g. hardware bundle with components), a `parentAssetId` field can be added in a future iteration.

---

## Planned Enhancements

| # | Enhancement | Requirement reference |
|---|-------------|----------------------|
| 1 | **Automated capacity tracking** — auto-calculate `capacityUsed` on parent items by summing child item quantities/bandwidth. Block child additions when capacity is exhausted. | R-INV-5, G-INV-1 |
| 2 | **Event-driven provisioning** — implement `sales.order.created` event subscriber that calls `provisionFromOrder`. Map order lines to subscription/fixed item records based on charge types. | R-INV-6, G-INV-2 |
| 3 | **MACD quoting integration** — enable `action: 'modify'` and `action: 'cancel'` on `CpqQuoteLineConfiguration` to reference existing inventory subscription items. Calculate deltas (prorated charges, cancellation fees). | G-QUOTE-5, G-INV-6 |
| 4 | **Subscription renewal automation** — scheduler that evaluates `autoRenew` subscriptions approaching `currentTermEnd` and extends the term or transitions to `expired`. | G-INV-4 |
| 5 | **Inventory audit trail** — `CpqInventoryEvent` entity tracking all status transitions, metadata changes, and capacity updates with actor, timestamp, and before/after snapshots. | G-INV-5 |
| 6 | **Typed asset subtypes** — dedicated entity subtypes (physical, logical) with structured fields for serial numbers, IP addresses, circuit IDs instead of JSONB metadata. | Domain spec: Asset |
| 7 | **Billing integration** — connect MRC amounts to a recurring billing engine. Track payment status and generate invoices. | G-INV-3 |
| 8 | **Inventory search** — full-text and filtered search across all inventory types, integrated with the Open Mercato search module. | _(usability)_ |
| 9 | **Bulk provisioning** — batch-create inventory records from multiple orders in a single API call. | _(efficiency)_ |
| 10 | **Inventory reports** — aggregate views: MRR by product, churn rate, customer lifetime value based on inventory data. | _(analytics)_ |
