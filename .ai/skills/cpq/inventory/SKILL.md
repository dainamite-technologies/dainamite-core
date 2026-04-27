---
name: cpq-inventory
description: Customer inventory work in CPQ — what survives after a quote becomes an order. Subscriptions (commercial wrappers), subscription items (concrete services), and assets (the physical/intangible thing the customer ends up owning). Load when modifying `cpq_inventory_*` tables, the inventory backend, or any flow that mutates installed-base data after order activation.
---

# CPQ — Customer Inventory

## Mental model

```
CpqInventorySubscription          commercial wrapper (contract terms, billing cycle)
        │
        └─ CpqInventorySubscriptionItem    one per service/product the customer pays for
                │
                └─ CpqInventoryAsset        the actual thing (hardware unit, license,
                                            allocation, fee — assets can also stand alone)
```

> **Naming note.** This is *customer* inventory — not warehouse stock. It
> tracks the installed base / running services per customer. There is no
> address-inventory module in this repo.

## Canonical files

| Concern | File |
|---|---|
| Inventory service | [`src/modules/cpq/services/cpqInventoryService.ts`](../../../../src/modules/cpq/services/cpqInventoryService.ts) (~870 lines) |
| Entities | `data/entities.ts` — `CpqInventorySubscription`, `CpqInventorySubscriptionItem`, `CpqInventoryAsset` |
| API | `api/inventory/subscriptions/`, `api/inventory/subscription-items/`, `api/inventory/assets/`, `api/inventory/customer/[customerId]/`, `api/inventory/customer/[customerId]/parent-items/` |
| Backend pages | `backend/cpq/inventory/`, `backend/cpq/inventory/subscriptions/[id]/`, `backend/cpq/inventory/assets/[id]/` |
| Customer-page widget | `widgets/injection/customer-inventory/` (drops a tab onto the customer detail page) |
| Status enums | `services/types.ts` — `INVENTORY_SUBSCRIPTION_STATUSES`, `INVENTORY_ASSET_STATUSES` |

## Mandatory reading

1. [`manuals/xd-215-customer-inventory.md`](../../../../manuals/xd-215-customer-inventory.md) — operator-facing model
2. [`specs/implementation/xd-215-customer-inventory.md`](../../../../specs/implementation/xd-215-customer-inventory.md) — long-form spec

## Domain rules

- **Inventory rows are written by order activation, not by quoting.** When a
  CPQ order is activated (`api/orders/[orderId]/activate/route.ts` →
  `cpqOrderService`), `cpqInventoryService` materialises subscriptions,
  items, and assets keyed off the order line configuration.
- **Subscriptions group items.** Same billing cycle, same contract term,
  same renewal policy. Splitting a quote across multiple billing cycles
  produces multiple subscriptions on activation.
- **Items can survive their parent.** Status transitions on a subscription
  (suspended, terminated) propagate to items by default but item statuses
  can override (e.g. an item is replaced mid-contract).
- **Assets are independent.** An asset can be re-pointed to a different
  subscription item over time (hardware swap, license re-allocation).
- **Cross-customer joins are by `customer_id` string.** No ORM relation
  to the `customers` module — the customer-inventory widget uses a
  Response Enricher / dedicated API path to surface the data.

## Common tasks

### Add a new asset kind

1. Extend the `kind` discriminator on `CpqInventoryAsset` (jsonb `config`
   schema if needed).
2. Update validators.
3. Surface it in the asset detail page (`backend/cpq/inventory/assets/[id]/`).
4. Add the activation rule in `cpqInventoryService` so order activation
   creates the asset.

### Add a new subscription status

1. Add the constant to `INVENTORY_SUBSCRIPTION_STATUSES` in
   `services/types.ts`.
2. Update the state-machine in `cpqInventoryService` (allowed transitions).
3. Update the status badge styling in `backend/cpq/inventory/`.

### Show inventory on a non-customer page

Use the existing widget pattern from
`widgets/injection/customer-inventory/widget.ts` — register an injection
with `InjectionPosition` at the target slot, fetch via
`api/inventory/customer/[customerId]/`. Don't directly import the
inventory service from outside CPQ.

## Anti-patterns to flag in review

- Writing inventory rows from a quote-side flow — only order activation
  should create them.
- Reading `cpq_inventory_*` from the sales/customers module directly —
  surface via Response Enricher or REST.
- Letting an asset point at a deleted subscription item without status
  reconciliation.

## Required detail pages

| Entity | List | Detail |
|---|---|---|
| `CpqInventorySubscription` | [`backend/cpq/inventory/page.tsx`](../../../../src/modules/cpq/backend/cpq/inventory/page.tsx) | [`subscriptions/[id]/page.tsx`](../../../../src/modules/cpq/backend/cpq/inventory/subscriptions/[id]/page.tsx) — must show items + assets + lifecycle timeline |
| `CpqInventorySubscriptionItem` | inline on subscription detail | inline editor with asset drilldown |
| `CpqInventoryAsset` | listed inline on customer / subscription | [`assets/[id]/page.tsx`](../../../../src/modules/cpq/backend/cpq/inventory/assets/[id]/page.tsx) — must show owning subscription, history, status |

The customer-facing widget [`widgets/injection/customer-inventory/`](../../../../src/modules/cpq/widgets/injection/customer-inventory/)
is part of the "detail page experience" too — when you change subscription /
asset shape, verify the widget still renders without breaking the customer
detail page.

## Required tests

Place under `src/modules/cpq/services/__tests__/`:

| Test file | Asserts |
|---|---|
| `cpqInventoryService.materialise.test.ts` | Order activation creates one subscription per billing cycle, items mirror order lines, assets created per asset-yielding line |
| `cpqInventoryService.statemachine.test.ts` | Every legal subscription/item/asset transition allowed; every illegal one throws; status propagation respects per-item overrides |
| `cpqInventoryService.idempotency.test.ts` | Re-activating an already-activated order does NOT create duplicate inventory rows (regression guard for the future idempotency work flagged in `orders/SKILL.md`) |
| `cpqInventoryService.reassignment.test.ts` | Re-pointing an asset to a different subscription item updates history + clears stale FK; old subscription item's asset reference is removed |
| `data/validators.inventory.test.ts` | Zod schemas for status enums match `INVENTORY_*_STATUSES` exactly (catches drift) |

## Self-review checklist

- [ ] OpenAPI updated for any `api/inventory/*` change
- [ ] Inventory writes happen only on order activation paths
- [ ] Status transitions go through the state-machine in
      `cpqInventoryService`, not direct property writes
- [ ] All cross-module references (`customer_id`, `quote_id`,
      `order_id`) are FK strings
- [ ] New status added to `services/types.ts` enum, not hardcoded
- [ ] Customer detail widget still renders after schema change
- [ ] Detail pages: subscriptions/`[id]` and assets/`[id]` updated for new
      fields; inline editors for subscription-items current
- [ ] Unit tests cover materialise, state machine, idempotency, and asset
      reassignment
- [ ] User-facing strings translated
- [ ] `yarn generate` re-run after touching widget/injection-table
