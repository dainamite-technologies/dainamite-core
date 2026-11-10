# Commit plans — CPQ Quote Price Adjustments

Atomic commits per App Spec §4 / §6 / §7 (after architect checkpoints #1 and #2). One commit = one
self-contained, testable increment with its unit tests. Paths under `packages/cpq/src/modules/cpq/`
unless noted; connector = `packages/cpq-billing-connector/src/modules/cpq_billing_connector/`.

## Phase 1 — Negotiated prices on new deals, safe ARC behaviour (20)

Delivered as two feature specs: `quote-pricing-integrity` (#5b, #11–12, #19) and `manual-adjustments` (the rest).

| # | Commit | Stories |
|---|---|---|
| 1 | Waterfall capture: list / standard fields, `origin: 'rule'`, legacy read helper (`cpqPricingService`, `services/types.ts`) | US-1.5 |
| 2 | `CpqQuotePriceAdjustment` + `pricing_revision`; Zod validators (level × type × charge model × window); `yarn mercato db generate` | US-1.1, 1.2 |
| 3 | Resolution (pure): classes, specificity, bundle cascade, invalid detection + fallback | US-1.1, 1.2, 1.7 |
| 4 | Application + summary: quantity semantics, deal value, signed depth, snapshot hash | US-1.1, 4.1 |
| 5a | Transaction boundary: `em.transactional` + pessimistic lock on `CpqQuoteConfiguration` for every price-affecting write incl. conversion; post-commit events; DB-backed concurrency test | US-4.2 |
| 5 | Integration: one waterfall path in add / update / recalc; revision bump; invalid → `incomplete`; legacy hash baseline | US-1.1, 4.2 |
| 5b | Recalculate requires `cpq.quotes.manage`; `save:true` refused in terminal statuses | US-4.2 |
| 6 | Adjustments API (`api/quotes/[quoteId]/price-adjustments/...`): CRUD, `openApi`, `requireFeatures`, lock (+ order exists), delete-invalid exception, mutation guards | US-1.1, 1.2, 4.2 |
| 7 | Preview endpoint (draft adjustment; no save, no event) | US-1.6 |
| 8 | ACL `cpq.quotes.adjust_price` (admin, employee) + visible dictionary `cpq.price_adjustment_reason` | US-1.9, 0.1 |
| 9 | Clone copies adjustments; line removal soft-deletes; conversion refused on stored invalid adjustments | US-1.7, 1.8, 2.1 |
| 10 | Events `cpq.quote.pricing_changed` (hash-deduped) + `cpq.quote.status_changed` (manual + auto) | US-4.3 |
| 11–12 | Mutation guards + `openApi` on status, items, recalculate (`save:true` → `manage`), convert routes | US-4.3 |
| 13 | UI waterfall rows + badges | US-1.5, 4.1 |
| 14 | UI adjust dialog with preview, `409` reload | US-1.1, 1.2, 1.6 |
| 15 | UI panel, lock / read-only states, ARC re-apply banner, injection slot | US-1.7, 4.2 |
| 16 | Order / subscription read-only waterfall | US-2.1 |
| 17 | Manual `manuals/cpq-price-adjustments.md` (incl. approval-workflow recipe), `xd-188` manual, `MIGRATION.md` | US-4.3 |
| 18 | Demo seed (`demo_gix`, `demo_puffin`) | US-0.2 |
| 19 | Frozen Amend mirror lines (`_arcPriceFrozen`, unfreeze on any pricing-input change); ARC mirror lines not adjustable (`LINE_NOT_ELIGIBLE`) | US-3.1 |

## Phase 2 — Price continuity through ARC + billing integrity (8)

| # | Commit | Stories |
|---|---|---|
| 1 | Carry-over on re-priced Amend lines: original type / value / reason at charge level, `carried_from_item_hash`, `SOURCE_CHANGED`, activation refusal | US-3.1 |
| 2 | `modifiedItems` (diff-based, recurring-only, post-Phase-1 quotes only), `changeLogId`, `oldTermEnd`; Renew lines adjustable | US-3.2, 3.3 |
| 3 | Connector re-rate at the billing-effective date B (next unbilled cycle start ≥ E): end-date open recurring items at B − 1, create new items from B, `sourceRef` with `changeLogId`; renew E = max(`newTermStart`, `oldTermEnd` + 1) | US-3.2, 3.3 |
| 6 | Connector end-date rules: renew extends only items ending at `oldTermEnd`; amend never moves an end date later | US-3.2 |
| 7 | Connector cancel never moves an earlier end date later | US-2.3 |
| 8 | Per-cycle rate conversion in `chargeMapper` for new / re-rated items; existing items grandfathered (U12, decided) | WF2 |
| 9–10 | Reconciliation CLI (CPQ items vs billing items by `sourceRef` / rate) + `--replay`; no-account → throw | US-2.5 |

## Phase 3 — Time-based prices billed per schedule (11)

| # | Commit | Stories |
|---|---|---|
| 1 | Window validation (MRC only, one kind per charge, term cap, overlap) behind feature toggle `cpq.price_windows` | US-1.3 |
| 2 | Schedule computation (segments, regular price, item-schedule merge, deal value) | US-1.3 |
| 3 | Window UI (period field, schedule table, promo badge) + demo promo seed | US-1.3, 0.2 |
| 4 | `price_start_date` on subscription items + schedule date materialisation at activation / ARC apply | US-2.2 |
| 5 | Activation / added payload item schedules (cpq) | US-2.2 |
| 6 | Connector: one billing item per segment, boundaries at billing-effective dates, `sourceRef` `-s<n>` | US-2.2 |
| 8 | Connector cancel: delete future never-billed segment items | US-2.3 |
| 9 | Subscription current / regular price + promo end display | US-2.4 |
| 10 | Absolute-window carry-over + clip at activation | US-3.1 |
| 11 | Connector `modifiedItems` schedules | US-3.3 |
| 12 | Reconciliation understands segments | US-2.5 |

## Phase 4 — Quote-wide discounts (2)

| # | Commit | Stories |
|---|---|---|
| 1 | `quote` level in resolution + API (eligible lines, charge-type filter, window) | US-1.4 |
| 2 | Discount quote dialog on the summary card | US-1.4 |
