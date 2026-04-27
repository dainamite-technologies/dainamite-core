---
name: cpq-orders
description: Quote → Order conversion and order lifecycle in CPQ. Load when modifying the conversion path, order activation, order status transitions, the `cpq_order_*` tables, or the order-tab widget injected into the sales order page.
---

# CPQ — Orders & Quote-to-Order

## Canonical files

| Concern | File |
|---|---|
| Order service | [`src/modules/cpq/services/cpqOrderService.ts`](../../../../src/modules/cpq/services/cpqOrderService.ts) |
| Inventory service (called on activation) | `services/cpqInventoryService.ts` |
| Entities | `data/entities.ts` — `CpqOrderConfiguration`, `CpqOrderLineConfiguration` |
| APIs | `api/orders/`, `api/orders/[orderId]/`, `api/orders/[orderId]/status/`, `api/orders/[orderId]/activate/` |
| Backend pages | `backend/cpq/orders/`, `backend/cpq/orders/[id]/` |
| Order tab widget on sales order detail | `widgets/injection/order-cpq-tab/` |
| Status enum | `services/types.ts` — `CPQ_ORDER_STATUSES` |

## Mandatory reading

1. [`manuals/cpq-quote-to-order-conversion.md`](../../../../manuals/cpq-quote-to-order-conversion.md) — happy path & edge cases

## Domain rules

- **Order = sales.Order + CpqOrderConfiguration**, mirroring the quote
  pattern. CPQ does not own the order header — sales does. CPQ owns the
  configuration that travelled from the quote.
- **Conversion copies, doesn't move.** When a quote becomes an order, CPQ
  duplicates `CpqQuoteLineConfiguration` rows into
  `CpqOrderLineConfiguration` so the original quote stays auditable.
  `salesDocumentNumberGenerator` (injected via DI) issues the order
  number.
- **Activation is irreversible by default.** `api/orders/[orderId]/activate/`
  triggers `cpqInventoryService` to materialise subscriptions / items /
  assets. Don't make activation idempotent unless you also make inventory
  creation idempotent — currently it's not.
- **Status transitions live in `CPQ_ORDER_STATUSES`.** Don't introduce
  ad-hoc statuses inline.
- **The order tab widget is injected into the sales order detail page**
  (`widgets/injection/order-cpq-tab/`). It must keep working when CPQ is
  later extracted to `@dainamite/cpq` — the injection mechanism is
  framework-level and survives the package boundary.

## Common tasks

### Add a new order status

1. Extend `CPQ_ORDER_STATUSES` in `services/types.ts`.
2. Update the transition map in `cpqOrderService`.
3. Update the order detail page status badge.
4. If activation behavior changes for the new status, update
   `api/orders/[orderId]/activate/route.ts`.

### Make activation idempotent

This is a bigger change — see the domain rule above. Required:

- Tag the order configuration with an `activated_at` timestamp.
- Make `cpqInventoryService` activation methods upsert by deterministic
  keys instead of always inserting.
- Add a regression test that calls activate twice and asserts no
  duplicate inventory rows.

### Cancel a pending order without activating inventory

`api/orders/[orderId]/status/route.ts` — transitions to
`cancelled`/`rejected` should short-circuit before activation logic. Test
that no `cpq_inventory_*` rows are written.

## Anti-patterns to flag in review

- Mutating `sales_orders` directly from CPQ — go through the sales
  module's command layer.
- Activation paths that bypass `cpqInventoryService` (writing inventory
  rows ad-hoc).
- Hardcoded status strings (`'activated'`, `'pending'`, …) outside
  `services/types.ts`.

## Self-review checklist

- [ ] Quote-to-order conversion copies CPQ rows; doesn't repurpose the
      quote rows.
- [ ] Activation goes through `cpqInventoryService` only.
- [ ] Status transitions validated against `CPQ_ORDER_STATUSES`.
- [ ] Order tab widget still renders after schema change.
- [ ] All cross-module references are FK strings.
- [ ] Updated [`manuals/cpq-quote-to-order-conversion.md`](../../../../manuals/cpq-quote-to-order-conversion.md)
      if the flow changed.
