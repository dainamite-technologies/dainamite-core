# Commit plans per workflow — CPQ Cost-Plus Pricing

One line per atomic commit, in build order within each phase. Source of truth for estimates: App Spec §4 / §6.

## Phase 1 — Cost-plus from known costs, margin, carry-through (26)
1. Toggle `cpq.cost_plus` + ACL `cpq.costs.view` / `cpq.costs.manage` + role defaults (`acl.ts`, `setup.ts`, defaults seeder).
2. `CpqProductCharge` cost-plus columns + validators + migration; markup redaction in charge responses.
3. `CpqPricingTable.purpose` + server-side guard on `pricing-tables` and `pricing-table-entries` routes.
4. `CpqChargeCostElement` entity + validators + API (`openApi`) + migration.
5. Charge editor: cost-plus fields + cost elements sub-table + dialog (offering / specification pages).
6. Engine refactor: table lookup decoupled from `CpqProductCharge` (table, column, model, dimensions).
7. Engine: cost resolution (fixed / table), cost-plus list price (R2), `NO_PRICE_BASIS_COST`, `COST_PENDING`.
8. `CpqQuoteLineCost` entity + migration + instantiation R1 (R1a, R1b value reset only, R1c skip on unreconfigured mirrors).
9. `computeQuoteMargin()` + `margin_hash` + bundle roll-up.
10. Cost-guarded read API (cost lines, margin) + cost preview endpoint.
11. Write API: manual costs (create / edit / delete), edit / confirm values, R10a.
11b. Write API: markup override, lock rules + exemptions + evidence notes (R11).
11a. `margin_changed` event (`margin_hash`, `approvalInvalidated`) + `status_changed` cost flags + approval recipe in the manual.
12. Confidential commands (audit / undo payloads without amounts); entities kept out of `ce.ts` / search.
13. Quote page: status badges + Costs sub-panel.
14. Quote page: Margin card (contract margin, coverage, flags).
14a. Dialogs: add / edit / confirm cost, override markup.
15. Calculate-price: cost-plus resolution, `priceOnRequest`, `indicative`.
16. Clone R16 + toggle-off behaviour R14 + usage endpoint `GET /api/cpq/cost-plus/usage`.
17. Conversion guard R7 + post-conversion price freeze of cost lines.
17b. `CpqOrderLineCost` + conversion copy (same transaction).
18. `CpqSubscriptionItemCost` (stable id per item + `cost_key`) + activation write (same transaction) + item costs in `snapshotSubscription` (change-log before / after) + change-log API redaction without `cpq.costs.view` + `item_cost_changed`.
19. Order / subscription UI (order costs, item costs + margin, cost before → after in the existing Change History).
20. ARC safety: Renew mirrors with cost-plus charges frozen + banner.
20a. ARC safety: minimal activation write-back (end on cancel / removal; in-place update on re-priced mirror).
21. Demo seed (GIX cost table, IP Transit with partner tail, quotes in each Phase 1 cost state, margin-approval recipe disabled) + manual `manuals/cpq-cost-plus-pricing.md`.

## Phase 2 — Supplier cost sourcing + FX (7)
22. Sourcing fields + request / answer / decline / cancel API with request ids (I-13), idempotent answers, R1b request cancellation, US-3.7 close-cancellation, `409 QUOTE_CONVERTED`.
22a. Locked-quote answers: `proposedAmount`, `COST_ANSWER_PENDING`, Apply supplier answer.
23. Events `cost_requested` / `cost_request_cancelled` / `cost_valued` (non-broadcast).
24. Cost requests page (list, row expansion, Answer / Decline dialogs).
25. Notifications (request opened → cost managers; answered / declined → quote owner).
26. FX conversion with dated rate snapshot (`ExchangeRateService`, `autoFetch: false`, 7-day look-back, provider rule, optional resolution).
28. Sourcing workflow recipe (seeded disabled) + demo quotes in `requested` / `declined` states + manual section.

## Phase 3 — Costs through ARC + re-confirmation (7)
29. Item-cost state hash helper + `COST_SOURCE_CHANGED` activation refusal.
30. Mirror carried costs + Renew reconciliation (R1c).
31. Price lock + Re-price from cost action.
32. Renew renegotiation due + Cancel supplier exposure.
33. ARC activation: update item costs in place (stable ids; history via the change-log snapshots), merge re-pointing, cost-only modify.
34. `ArcLineDiff` cost / margin before-after + banners; Phase 1 safety banner removed.
27. Post-conversion re-confirmation (Q-D13) on `CpqOrderLineCost` (lock-shared with activation).

## Phase 4 — Indexed costs + expiry (4)
35. `CpqCostIndex` / values entities + API + import (server-assigned revision).
36. Cost indices pages (list + detail with values).
37. Engine: `index` source + snapshot (R4) + Renew re-evaluation.
38. `cost_expiring` scheduled command (`SchedulerService`) + notification.

Phase 4 seed additions (a demo index) ride on 37. Total: 26 + 7 + 7 + 4 = 44.
