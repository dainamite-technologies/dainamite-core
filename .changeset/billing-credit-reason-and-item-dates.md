---
'@dainamite/billing': minor
---

Credit reasons and item date guards (spec `2026-11-16-billing-operator-polish-and-bill-cycle-day`, Part 2).

- **Credit reason.** An item ended inside its billed window (price change, earlier end date) with proration on credits the billed days. `PUT /api/billing/items` and `POST /api/billing/items/change-price` then require a reason: `creditReason` (operator text, at most 500 characters) or `creditReasonCode` + `creditReasonParams` (generated). Without one they return 422 `billing.item.credit_reason_required`. The reason is stored on the item (`credit_reason` jsonb, migration `Migration20261122000000_billing_item_credit_reason`), frozen into the credit line's `metadata.credit_reason`, and printed under the line on the PDF (in the invoice language) and on the invoice page.
- **The price-change dialog and item form** show how far the item is billed and warn before a credit. They ask for the reason only when one is needed.
- **Breaking: an item can no longer end before it starts.** An end date more than one day before the start returns 422 `billing.item.end_before_start` on create, bulk create and update. `end = start − 1` is allowed: the item was cancelled before it started and never bills.
- **A new item state, "Cancelled before start"**, appears on the account Items tab.
