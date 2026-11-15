# Notify — 2026-11-15-cpq-cost-plus-arc-costs

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-15T15:03:07Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-arc-costs.md (App Spec cost-plus, feature 5 of 6), stacked on PR #96.
- Decision: spec PR 1 + PR 2 folded into one PR; step 22 (Re-price from cost) BLOCKED on `modifiedItems` (spec Q3) — not present in the codebase.

## 2026-11-15T15:15:02Z — steps 3-4 scope decisions
- Lock order as built: order row (existing, read for its status) -> source quote row -> target subscription rows by id. Step 13 (re-confirmation) must take the quote lock first and read the order row WITHOUT locking it, or it would invert the order and can deadlock with activation.
- COST_SOURCE_CHANGED covers only cost-managed, non-termination mirror lines (`_arcCostsCarried` + `_arcCarriedCostSetHash`); a cancel line carries no costs and its item costs end whatever they hold. `costKeys` come from comparing the line's carried quote cost lines (`carried_from_item_cost_id` / `carried_from_hash`) with the live open item costs; with no carried rows the keys list is empty but the 409 stands.
- The activate and status routes now return the OrderError `details` (they used to drop them), so the 409 body carries `lines`.

## 2026-11-15T16:00:00Z — step 6 scope decisions
- Carry runs for Amend mirrors only (standalone targets). Renew mirrors carry nothing until step 14 (reconciliation); Cancel and merge-renew never carry. An item with no open costs gets no carried rows and NO `_arcCostsCarried` markers (nothing to guard; the line follows the unmarked activation rules). Markers are server-owned and sticky across `updateQuoteItem` (resubmission and reconfiguration).
- `costResolution`: `carried` counts as an entered origin (survives recalculation until R1b). An unreconfigured mirror drops its non-carried rows only. Known gap: a carried row has `driver_hash = null` until the first reconfigured recalculation, so R1b cannot fire on that first change (the subscription item holds no baseline of the driving attributes); from the second change on it resets.
- Carried `value_status` is `confirmed` whenever the item cost has an amount (spec), else it keeps the item cost's status.

## 2026-11-15T16:30:00Z — step 7 scope decisions
- Q4 lives in `quoteCostService.updateCost` only: a cost change on a frozen mirror line (`isFrozenMirrorLine`) is never price-affecting for the lock, and the cost PATCH accepts any ARC mirror line for a `carried` cost (catalog costs on unreconfigured mirrors, cancel lines and structure writes stay LINE_NOT_ELIGIBLE). Carried lines refuse structural edits and deletion. The supplier answer path (`classifyAnswer`) is unchanged: an answer on a locked frozen carried price-basis line is still a proposal (revisit with the Renew renegotiation steps 14-15).

## 2026-11-15T16:45:00Z — step 7 review fix
- Supersedes the step 7 note on `classifyAnswer`: a supplier answer / decline on a frozen mirror line (`isFrozenMirrorLine`, the predicate `updateCost` uses) is now lock-exempt like a margin-only cost (applies, no proposal, no locked downgrade); a reconfigured (un-frozen) line keeps the lock.

## 2026-11-15T17:10:00Z — step 8 scope decisions (replace semantics vs review1-b)
- A cost-managed line (`_arcCostsCarried`) ALWAYS syncs in `replace` mode with `fullImage: true`, whatever the `cpq.cost_plus` toggle (its carried rows exist regardless). Full image: every open item cost whose key is missing from the seeds ends, whatever its origin (catalog, manual, carried) — a carried key removed on the quote ends that item cost.
- review1-b is unchanged for every other line: a reconfigured, non-carried line ends only missing CATALOG-origin costs, and is upsert-only with the toggle off; manual item costs are never ended there.
- Carried seeds carry `inventoryCostId` (from `orderCostCopy`); `replaceItemCosts` throws if it differs from (or no row matches) the row found by owner + key. The inventory row keeps its own `origin` (quote-side `carried` is not an inventory provenance) and keeps its `value_origin` while the seed's is still `carried`; no inventory CHECK constrains origin (only owner and status), so nothing needs widening. Known nit: a carried `confirmed` status over an `estimated` margin-only item cost with an amount counts as a change.
