# Product Inventory Domain

## Objective

Define what customers have already purchased from us — their active products and services. Inventory provides context for quoting (e.g. which parent items exist for attaching child services) and represents the post-order state of CPQ products.

---

## Key Entities

### Customer
- Reference to the customer record from the customers module.
- Inventory is queried per customer.

### Subscription
- Represents a running subscription — an active commercial relationship with a customer for a product.
- Created when a quote is converted to an order and provisioned.

| Property | Description |
|----------|-------------|
| `customerId` | FK to customer |
| `productId` | FK to catalog product |
| `status` | `pending`, `active`, `suspended`, `terminated` |
| `configuration` | JSONB snapshot of attribute values at time of purchase |
| `charges` | JSONB snapshot of resolved charges at time of purchase |
| `activatedAt` | When the subscription went live |
| `terminatedAt` | When terminated (nullable) |
| `sourceQuoteId` | FK to originating quote |
| `sourceOrderId` | FK to originating order |

### Subscription Item
- Represents a specific service element within a subscription.
- Enables parent/child relationships: a parent subscription item (e.g. access port) can have child items (e.g. peering services).

| Property | Description |
|----------|-------------|
| `parentItemId` | Self-referencing FK for parent/child hierarchy |
| `configuration` | Per-item attribute values |
| `charges` | Per-item charge snapshot |
| `dataCentreId` | Location reference (nullable) |
| `currencyCode` | Currency |

### Asset
- A physical or logical resource associated with an inventory item.
- Future scope: track serial numbers, IP addresses, circuit IDs, etc.

---

## Requirements

### R-INV-1: Customer Inventory View
Inventory must be visible as a tab on the customer detail page (injection widget into `customers.detail:tabs`). Shows active items in a tree view (parent items with children nested underneath).

### R-INV-2: Dedicated Inventory Page
A standalone inventory list page with filtering by customer, product, status, location. Supports tree-like parent/child display.

### R-INV-3: Configuration Snapshot
Each inventory item must store a full snapshot of its attribute values and resolved charges at the time of purchase. This is immutable — changes to pricing tables or product definitions do not retroactively affect existing inventory.

### R-INV-4: Parent/Child Hierarchy
Items must support self-referencing parent/child relationships. A parent item tracks its capacity; child items consume capacity.

### R-INV-5: Capacity Tracking
For parent items, the system must calculate remaining capacity (e.g. total port bandwidth minus sum of children's bandwidth). Used by the quoting domain to validate new child items.

### R-INV-6: Event-Driven Provisioning
Inventory items are created by subscribing to `sales.order.created` events. The CPQ module is not directly coupled to order creation code.

### R-INV-7: Status Lifecycle
Items follow the lifecycle: `pending` -> `active` -> `suspended` / `terminated`. Status transitions should be tracked.

---

## Service API

| Operation | Description |
|-----------|-------------|
| `getCustomerInventory(customerId, filters?)` | List all inventory items for a customer, with optional status/product filters |
| `getCustomerParentItems(customerId, productId?)` | List active parent items — used by quoting wizard for "add child" flow |
| `getChildItems(parentItemId)` | List child items under a parent |
| `getParentRemainingCapacity(parentItemId)` | Calculate remaining capacity on a parent item |
| `provisionFromOrder(orderId)` | Create inventory items from an order's CPQ configuration |
