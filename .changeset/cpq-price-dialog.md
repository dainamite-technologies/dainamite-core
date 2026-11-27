---
'@dainamite/cpq': minor
---

One Price dialog per quote line, and one atomic write per adjustment target (spec 2026-11-27 CPQ / billing phases UX feedback, items 1–8).

- **API**: `PUT /api/cpq/quotes/{quoteId}/price-adjustments/target` replaces every adjustment on one target (whole line
  recurring / one-time / all charges, or one charge) in one undoable command (`cpq.quote_price_adjustment.replace_target`):
  phases back to back from month 1 (with `regular` gaps), then the price after them, or one price. Unchanged rows keep
  their id, author and date. `POST …/target/preview` prices the same body without a write and reports overlaps.
  The per-row POST / PATCH / DELETE are unchanged.
- **Reads** (additive): list items carry `createdByName` / `createdByEmail`; `GET /api/cpq/orders/{orderId}` returns
  `priceAdjustments` (the source quote's, read-only, with `reasonLabel`). New AI read tool `cpq.list_price_adjustments`;
  price-adjustment writes stay out of the AI tools.
- **UI**: a wide Price dialog (current prices with "Priced by", Applies to, One price / Price phases with Regular price
  steps and a Then row, suggested phase names, live preview, one save) opened by one icon-only **%** button on the line
  and on each charge; the separate Phases dialog and buttons are gone. The quote panel shows one row per target with
  author names; the order's Line items tab shows the same table read-only (spot `data-table:cpq.order_price_adjustments`).
- No schema change, no migration.
