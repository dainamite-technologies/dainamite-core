# CPQ supplier costs through Amend / Renew / Cancel, with renegotiation and price lock

Extends: .ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md
Extends: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
Extends: .ai/specs/2026-11-10-cpq-manual-price-adjustments.md
Extends: .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md
Extends: specs/implementation/xd-250-arc-spec.md
Extends: specs/implementation/xd-215-customer-inventory.md
Extends: specs/implementation/xd-249-billing-spec.md

App Spec: `.ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md` is the source of truth (§1.3 price lock / renegotiation due / keep current cost; §1.4 R1c, R7, R11 Q-D13 exemption, R12, R13, I-3, I-5, I-9–I-12; §3 WF6; §5 US-5.2, US-6.1–6.4; §7 Phase 3; §8).
Brief: `.ai/specs/briefs/2026-11-11-cpq-cost-plus-arc-costs.md`.
Stories: US-5.2, US-6.1, US-6.2, US-6.3, US-6.4 (and the forward-compatibility criterion for US-6.5).
Commit plan: `.ai/specs/app-spec-notes/cost-plus-commits-WF.md` #29, #30, #31, #32, #33, #34, #27 (App Spec §7 Phase 3).
Depends on:
- `.ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md` (PR #87): `cpq_quote_line_costs` (its `carried_from_*`, sourcing, FX and index columns already exist as nullable), `costService`, `costResolution`, `withQuotePricingWrite` + `marginTracker`, `cpq.quote.margin_changed`, the redaction helper, error-code style.
- `.ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md` (the "sibling"): `CpqOrderLineCost` (`inventory_cost_id`, `total_amount`, `reconfirmed_at`, `reconfirmed_by_user_id`), `CpqInventoryCost` (one stable id per `(subscription_item_id, cost_key)`, `last_order_line_cost_id`, the "open" definition of its Q6), `services/costs/inventoryCostSync.ts` (`createItemCosts`, `replaceItemCosts` with reactivation and the no-op rule, `endItemCosts`, `repointItemCosts`), the **activation transaction boundary** (forked EM, one transaction), `items[].costs[]` in `snapshotSubscription`, change-log redaction, `cpq.subscription.cost_changed`, the Phase 1 freeze marker `_arcCostPlusFrozen` / `isFrozenMirrorLine`, the reconfiguration marker `_arcReconfigured`, and `ended_at` = change-log `effective_at` (its Q8, final).
- `.ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md` (App Spec Phase 2): the request / answer API on cost lines, used here for renegotiation-due carried costs, and its MODIFIED texts of "Manual costs, cost confirmation and markup override", "Quote cost lines from catalog cost elements" and "Quote to order conversion", which this spec's MODIFIED texts replace cumulatively.
- `.ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md`: `reevaluateCarriedIndexCosts`, called on Renew mirrors after this spec's reconciliation.
- The sibling price-adjustment features `arc-continuity` / `billing-rerate` (`modifiedItems` in amended / renewed payloads) — **not built** (see Prior spec drift). Only the Re-price-from-cost PR waits for them (Resolved assumption Q3).

## 📝 TLDR

Today an Amend, Renew or Cancel quote knows nothing about what the operator pays its suppliers for the items it changes. ARC mirror lines carry prices but no costs, and after Phase 1 the Renews of cost-plus items are simply frozen at the contracted price.

**Proposed (future behavior):**
- **Amend** mirror lines carry each live item's open costs as `carried` cost lines, stamped with a state hash. Procurement records a renegotiated supplier price on them. While the line is frozen this moves **margin only** (price lock). An explicit **Re-price from cost** action un-freezes the line and re-prices it from the new costs.
- **Standalone Renew** mirror lines are re-priced at today's standard again (the Phase 1 safety freeze is no longer applied to them), and their costs are **reconciled** with today's catalog (R1c). Recurring costs whose validity or supplier term ends before the new term end become `estimated` (**renegotiation due**). They block conversion until a supplier answer or **Keep current cost** with evidence. Merge-renew mirrors keep the Phase 1 freeze and carry no costs.
- **Cancel** quotes show each supplier contract that outlives the cancellation (early-exit exposure). Nothing is recorded as a cost (Q-D10).
- **Activation** (inside the sibling's transaction) first locks the source quote and then the target subscriptions. An ARC activation refuses with `409 COST_SOURCE_CHANGED` when an item cost changed since mirroring. Otherwise it replaces item costs **in place** through the sibling's `replaceItemCosts`: stable ids, new keys created, returning keys reactivated, missing keys ended. Every change lands in the existing change-log snapshots and emits `cpq.subscription.cost_changed`. A cost-only Amend is an internal `ready → accepted` change with a zero billing diff.
- Between conversion and activation, a cost manager can **re-confirm** an order line cost (Q-D13). It moves margin only and is serialized with activation by the same source-quote lock.
- `ArcLineDiff` shows cost and margin before → after to `cpq.costs.view` holders.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | The item-cost hash guard (I-12) has no existing carried-adjustment code to reuse (verified: no `carried_from*` / `SOURCE_CHANGED` anywhere in `packages/`). What shape should it take? | A pure helper `lib/stateHash.ts` (`canonicalStateHash(projection)`: sorted-key canonical JSON → sha256 hex), extracted from the private `canonical()` in `services/arcPriceFreeze.ts:106-115`. On top of it, `services/costs/itemCostState.ts` provides `itemCostStateHash(row)` (which includes `subscription_item_id`, so a merge re-point counts as a change) and `itemCostSetHash(rows)` over the item's **open** costs (sibling Q6). The sibling's adjustment carry-over reuses `canonicalStateHash` with its own projection. | One generic primitive with no ORM dependency. Each caller keeps its own projection (which fields count). Matches App Spec §8 "built once here as a shared item-state hash helper". | reversible |
| Q2 | Activation takes no lock today (`services/cpqOrderService.ts:339-401`). The sibling makes it one transaction on a forked EM, but adds no lock. How are Q-D13 and I-12 serialized? | Inside the sibling's activation transaction, and only there, **every** `activateOrder` path (new sale and ARC) first takes `PESSIMISTIC_WRITE` on the source `CpqQuoteConfiguration`. That is the row `withQuotePricingWrite` locks (`services/priceAdjustments/quotePricingWrite.ts:30-33`). ARC paths then lock each target `CpqInventorySubscription`, sorted by id. One helper, `services/costs/sourceQuoteLock.ts`, is used by activation and re-confirmation. There is no `pricingRevision` bump and no quote event. | US-5.2: re-confirmation is "serialized by the quote-configuration lock that activation also takes". `ensureNoConcurrentArcQuote` treats `accepted` as terminal (`services/cpqQuotingService.ts:2528-2566`, `services/types.ts:55`), so two ARC orders on one subscription can wait for activation at the same time. | reversible |
| Q3 | Re-price from cost must reach billing through `modifiedItems`, but no `modifiedItems` exists (`services/cpqOrderService.ts:1260-1297`; connector `cpq-subscription-amended.ts:22-37` handles only added / removed items). | Everything else ships first. The **Re-price from cost** action ships in the last PR, which merges only after the sibling `billing-rerate` / `arc-continuity` features put `modifiedItems` in the amended / renewed payloads. Until then the action is not exposed. | Today a reconfigured Amend line already changes the CPQ item price without telling billing. A new, cost-driven way to do the same would widen that drift. Holding back one PR is fully reversible. | Confirmed by the product owner in PR review (2026-11-13). Note: billing contract dependency. Reversible. |
| Q4 | On a frozen Amend line, is changing a carried `price_basis` cost a locked price-basis write (R11) or a margin-only one? | **Margin-only** for lock purposes while the line is frozen. It changes no price (I-11), so like other margin-only writes it is allowed in every non-terminal status without an order, and it changes `margin_hash` (approval invalidated per R8). Once the line is un-frozen, the normal price-basis lock applies. | Matches "price lock: cost changes move margin only" (§1.3) and keeps the cost-only Amend workable after `ready`. Recorded as a MODIFIED requirement of PR #87. | reversible |
| Q5 | How does activation know which mirror lines' costs this feature manages? | Phase 3 mirroring sets the quote-only markers `_arcCostsCarried: true` and `_arcCarriedCostSetHash`. A marked line always uses `costSync = 'replace'` (the sibling's no-op rule keeps untouched rows unwritten). Unmarked lines follow the sibling's Q5 unchanged: `replace` only when `_arcReconfigured`, `cancel` ends, `add` creates, otherwise untouched. That covers Phase 1 frozen lines and non-cost-plus Renews created under Phase 1 that were never frozen. `QUOTE_ONLY_ARC_KEYS` (`services/arcPriceFreeze.ts:27`) keeps `_arcPriceFrozen`, `_arcRepriced`, `_arcCostPlusFrozen` and `_arcReconfigured` while Phase 1 quotes are in flight, and adds the two new markers. | Forward compatibility without a schema change. Activation already reads the source quote lines (`services/cpqOrderService.ts:438-443`). | reversible |
| Q6 | What happens to open standalone Renews created under the Phase 1 freeze when Phase 3 deploys? | Lines frozen with `_arcCostPlusFrozen` stay frozen and activate under the sibling's rules (untouched). On those lines only, the banner is replaced by "Created before cost carry-over — costs kept as contracted. Refresh the line to renegotiate." **Refresh from subscription** re-mirrors the line under Phase 3 rules. | No silent re-pricing of a quote the customer may already have seen. The operator opts in. | reversible |
| Q7 | Post-conversion supplier answers (Phase 2 returns `409 QUOTE_CONVERTED`). | Unchanged: the answer API never writes order costs. Its `409 QUOTE_CONVERTED` gains `{orderId, orderLineCostId}`, so the Cost requests page links to **Re-confirm** on the order. | Smallest surface, and one writer per entity. | reversible |
| Q8 | Where are `renegotiation_due` and the dropped-at-renewal costs stored? | New column `cpq_quote_line_costs.renegotiation_due` (boolean, not null, default false). Dropped item costs are **computed on read** (open item costs of a cost-managed Renew line with no matching cost line) and are not stored. | `estimated` alone cannot tell renegotiation from other estimates. Dropped costs have no quote-side lifecycle. | reversible |
| Q9 | Item-cost end date on Cancel / removal. | The sibling's rule, final: `ended_at` = the change-log `effective_at` of the activating order. This spec only references it. The exposure panel uses one reference date: today while the quote is open, and the change-log `effective_at` once activated. | One definition, owned by the sibling (its Q8, which amends App Spec R13). | reversible |
| Q10 | Merge-renew quotes (brief non-goal: merge-renew cost propagation). | Merge-renew mirrors of cost-plus items keep the Phase 1 freeze (`_arcCostPlusFrozen`). No merge mirror carries cost lines or gets renegotiation flags. At activation, open item costs of carried-over items are **re-pointed** to the clones (same ids, `cause: 'merge'`), unchanged. | I-10 needs re-pointing. Renegotiation inside merges is out of scope, and removing the freeze there would re-price cost-plus lines with no costs. | reversible |
| Q11 | Is Re-price from cost undoable? | Through **Refresh from subscription** on the line, with the confirmation "Discards the renegotiated costs on this line". There is no undo in the action log (PR #87 Q2: cost commands are not undoable). | One recovery path covers three cases: undoing a re-price, `COST_SOURCE_CHANGED` before conversion, and Phase 1 Renews. | reversible |
| Q12 | Which `cost_changed` cause does a re-confirmed cost get? | Re-confirmation is recorded on the order line cost (`reconfirmed_at` / `reconfirmed_by_user_id`) and emits no event. The activation that writes the value emits its own cause: `amend` / `renew` for ARC, `activation` for a new sale. | Matches the sibling's cause list. One event per item-cost write. | reversible |
| Q13 | Asset costs (sibling Q2) in Amend / Renew. | Untouched. ARC mirrors subscription items only, so asset costs are neither carried, renegotiated nor hash-guarded. They end on Cancel and with a `cancel` line that cancels the asset, appear in the Cancel exposure panel, and follow a merge. Renegotiating an asset's supplier contract (e.g. a server licence) needs ARC support for assets, which is a follow-up feature. | No asset mirror line exists (`services/cpqInventoryService.ts:1615-1775`); inventing one is a separate ARC capability, not a cost feature. | reversible |

## 📝 Problem Statement

- **ARC quotes carry no costs.** `mirrorTargetSubscriptionItems` copies each live item's configuration, charges and amounts (`services/cpqQuotingService.ts:2714-2808`; charges via `pickArcMirrorCharges`, `:2863-2901`). `restoreQuoteItemInTransaction` rebuilds them the same way (`:631-645`). Nothing reads the item's costs, so renewals start blind. The WF6 ROI (100% of renewals of costed items show the previous supplier cost) is 0% by construction.
- **Supplier price changes are not recorded.** The only way to change a live item is an ARC activation. It patches `charges` / `mrcAmount` / `nrcAmount` (`services/cpqInventoryService.ts:1732-1773`). After the sibling ships, it touches item costs only on reconfigured, added or cancelled lines, so there is no way to record a renegotiated supplier price.
- **Renew mis-prices cost-plus items.** Renew mirrors are not frozen today (`services/arcPriceFreeze.ts:58-76` freezes only `amend`). They are re-priced at today's standard (`services/cpqQuotingService.ts:1015-1022`). The sibling's Phase 1 freeze (`_arcCostPlusFrozen`) prevents a wrong price by keeping the contracted price, at the cost of never renegotiating.
- **Concurrent ARC orders can clobber each other.** `ensureNoConcurrentArcQuote` ignores quotes in `accepted` (`services/cpqQuotingService.ts:2550`, `services/types.ts:55`), so a second Amend can be created and converted while the first waits for activation. After the sibling, activation is one transaction, but it takes no lock. Only the subscription's optimistic `version` (`data/entities.ts:983-984`) protects it, and that version does not change when an item cost row changes.

## 📝 Prior spec drift

- **App Spec WF6 / US-6.2 / §8 — "the sibling `modifiedItems` path".** It does not exist. `emitAmendedEvent` / `emitRenewedEvent` send only `addedItems` / `removedSubscriptionItemIds` (`services/cpqOrderService.ts:1260-1297`), and the connector handles only those (`packages/cpq-billing-connector/src/modules/cpq_billing_connector/subscribers/cpq-subscription-amended.ts:22-37`). Handled by Q3.
- **App Spec US-5.2 — "the quote-configuration lock that activation also takes".** Neither the code (`services/cpqOrderService.ts:339-401`) nor the sibling (one transaction, no lock) takes it. Handled by Q2.
- **App Spec R13 vs US-6.4 — the cancel end date.** Settled by the sibling's Q8 (`ended_at` = change-log `effective_at`). Referenced, not redefined (Q9).
- **`xd-250-arc-spec.md` — `validateArcQuote` runs on "submit for approval".** The code runs it only on `in_approval` / `pre_approved` / `with_customer` (`services/cpqQuotingService.ts:879-897`), so the internal `ready → accepted` path (Q-D12) skips it. This spec checks I-12 at conversion and activation instead of widening `validateArcQuote`.

## 📝 Proposed Solution

1. **One state-hash primitive** (`lib/stateHash.ts`) and an item-cost projection (`services/costs/itemCostState.ts`). Mirroring stamps `carried_from_hash` on every carried cost line and `_arcCarriedCostSetHash` on the line. Conversion and activation recompute both from the live open item costs. Any difference → `409 COST_SOURCE_CHANGED {lines:[{quoteLineId, subscriptionItemId, costKeys}]}`, and nothing is written.
2. **Carry on mirror.** `mirrorTargetSubscriptionItems` (standalone targets only), the restore path and the new refresh path call `arcCostCarry.carryItemCosts(tx, line, item)`. On an Amend it creates one `carried` cost line per open item cost: same `cost_key`, `value_status = confirmed`, `value_origin = carried`. It copies `role`, `cost_type`, `charge_code`, `source`, `cost_model`, `unit_amount`, `instance_amount`, `currency_code`, `fx_rate`, `fx_rate_date`, `index_snapshot`, the supplier fields, `valid_until` and the supplier term. R1 instantiation stays skipped on unreconfigured Amend mirrors. A reconfiguration un-freezes the line (existing `services/cpqQuotingService.ts:453-469`) and sets `_arcReconfigured`. The sibling's widened R1 then instantiates catalog lines by `cost_key`, keeping a carried value where the key matches unless R1b resets it.
3. **Renew reconciliation (R1c)** runs on every saved recalculation of an unlocked, cost-managed standalone Renew mirror, in this order:
   1. `arcCostCarry.reconcileRenewCosts`:
      - a matching `cost_key` (or an item cost with no element) → carried;
      - an applicable element the item lacks → catalog line;
      - an open item cost whose element no longer applies, or whose `charge_code` no longer resolves → dropped (listed on read);
      - renegotiation due flags MRC carried costs whose `valid_until` or `supplier_term_end` < the target's `newTermEnd`.
   2. Then the index spec's `reevaluateCarriedIndexCosts`. It touches only carried `index` lines with `value_origin = carried` and `renegotiation_due = false`, and changes only `unit_amount` / `instance_amount` and `index_snapshot`.

   Renegotiation-due lines can be requested and answered through the sourcing spec's API. An answer clears `renegotiation_due`.
4. **Price lock + Re-price from cost.** `isFrozenMirrorLine` keeps the line's charges, and carried-cost writes are margin-only (Q4). `POST …/items/{lineId}/reprice-from-cost` clears `_arcPriceFrozen`, sets `_arcRepriced` and `_arcReconfigured`, and re-prices the line in `withQuotePricingWrite`. This is the same un-freeze a configuration change performs today, with a new trigger.
5. **Activation.**
   - Inside the sibling's transaction, `sourceQuoteLock` locks the source quote (all paths), then the target subscriptions (ARC).
   - `assertCarriedCostsFresh` runs before any write.
   - `buildArcLineChange` (`services/cpqOrderService.ts:1068-1113`) sets `costSync = 'replace'` for marked lines (Q5), with seeds from their order line costs.
   - The sibling's `replaceItemCosts` applies the seeds before the after-snapshot: it updates in place, creates new keys, reactivates ended rows for returning keys (never a second row per key), ends missing keys, skips no-op rows, sets `last_order_line_cost_id` and returns the changes for the post-commit events.
6. **Conversion.** The sibling's order-cost copy also sets `CpqOrderLineCost.inventory_cost_id = carried_from_item_cost_id` for carried cost lines (sibling: "Phase 3 sets it at conversion"). Conversion also runs `assertCarriedCostsFresh`.
7. **Q-D13 re-confirmation** on `CpqOrderLineCost` under `sourceQuoteLock`. It recomputes `total_amount`, leaves `charges` untouched and sets `reconfirmed_*`.
8. **UI:**
   - carried / renegotiation-due badges;
   - Keep current cost, Re-price from cost and Refresh from subscription;
   - the Cancel exposure panel;
   - cost rows in `ArcLineDiff`;
   - the Phase 1 banner removed from new standalone Renews.

**Alternatives considered:**
- **Snapshot item costs into the line `configuration` jsonb.** Every quote reader and the broadcast events would see it (I-4).
- **Optimistic check on `CpqInventorySubscription.version` instead of a cost hash.** Any price-only change on any item would refuse the activation, and item-cost writes do not bump the subscription version.
- **A separate ARC write-back module.** It would duplicate the sibling's `inventoryCostSync` and risk a second row per key (I-10).
- **Close-and-reopen item cost rows per change.** Rejected by the user (2026-11-12): ids must be stable.
- **Automatic price pass-through on cost change.** Rejected (Q-D6).
- **A lightweight "change item cost" command outside ARC.** Rejected (Q-D12): it bypasses the change log and the order trail.

**Research (market leaders):**
- **Salesforce CPQ amendments / renewals** copy the subscription's quote lines with their cost fields (Unit Cost). Amended lines keep the original price unless the rep re-prices them ("Renewal Pricing Method: Same / List / Uplift").
  - **Adopted:** carried cost beside the line; same price by default on Amend; list re-pricing on Renew.
  - **Not adopted:** a per-product uplift setting (Q-D6 uses an explicit action instead).
- **Zuora / Chargebee** model subscription changes as dated amendments with full before / after versions. Costs are outside their scope.
  - **Adopted:** before → after per change in the existing change log; stable item identity.
  - **Not adopted:** versioned item rows.
- **Oracle CPQ / Conga** check for expiring contracts on renewal assets.
  - **Adopted:** a supplier-term check against the new term end (renegotiation due).
  - **Not adopted:** a separate supplier-contract entity (the supplier term stays on the cost).
- **Odoo** recomputes `purchase_price` only on reordering and does nothing on renewal. That is the gap this feature closes.

## 📝 Delta

### Capability: cpq-arc

#### MODIFIED Requirement: Amend mirror line pricing
The system SHALL keep an engine-priced mirror line on an Amend quote at the source subscription item's stored charges until a pricing input of that line changes **or the user explicitly chooses Re-price from cost**. It SHALL then re-price the line at the current standard price; a cost-plus charge is priced from the line's current cost lines and markup.

##### Scenario: Untouched line
- WHEN an Amend quote adds a port and the existing port's catalog price rose from 100 to 120 since activation
- THEN the existing port's line keeps 100, and activation leaves its subscription item price at 100

##### Scenario: Reconfigured line
- WHEN the rep changes the existing port's speed on the Amend quote
- THEN the line is re-priced at the current standard price and the banner is shown

##### Scenario: Unchanged resubmission
- WHEN the UI saves the line with the same configuration and quantity
- THEN the line stays frozen

##### Scenario: Re-price from cost
- WHEN a cost-plus tail line (markup 25%) is frozen at 345, its carried tail cost is renegotiated from 276 to 240, and the operator chooses Re-price from cost
- THEN the line is un-frozen and marked re-priced, and its list price becomes 300.00

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/arcPriceFreeze.test.ts` and `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts`

#### MODIFIED Requirement: Renew mirror line pricing
The system SHALL re-price an engine-priced mirror line on a **standalone** Renew quote at the current standard price. A cost-plus charge is priced from the line's reconciled cost lines.

The system SHALL create a mirror line on a **merge** Renew quote frozen at the item's stored charges (`_arcCostPlusFrozen`) when its source item is cost-plus. Such a line carries no cost lines, shows "Costs are not carried to merged subscriptions", and is re-priced only when a pricing input changes.

A standalone Renew line created frozen before this change SHALL stay frozen until a pricing input changes or the line is refreshed from the subscription.

##### Scenario: Renew a cost-plus item
- WHEN a standalone Renew quote mirrors an item priced 400 from a carried 320 tail cost with markup 25%
- THEN the line is priced 400.00 from the carried cost, and no Phase 1 banner is shown

##### Scenario: Merge-renew of a cost-plus item
- WHEN a merge Renew quote mirrors the same item
- THEN the line keeps 400, carries no cost lines and shows the merge notice

##### Scenario: Renew created under Phase 1
- WHEN a standalone Renew line created with `_arcCostPlusFrozen` before this change is recalculated
- THEN it keeps its contracted price, and Refresh from subscription re-mirrors it with carried costs

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts` (sibling step 13)

Note: this replaces the sibling's MODIFIED text of the same requirement.

#### ADDED Requirement: Amend carries subscription item costs
The system SHALL create one `carried` cost line on every Amend mirror line of a standalone target for each open cost of the source subscription item. Each line SHALL have:
- the same `cost_key`;
- `value_status = confirmed` and `value_origin = carried`;
- the item cost's `role`, `cost_type`, `charge_code`, `source`, `cost_model`, amounts, currency, FX, `index_snapshot`, supplier, supplier quote ref, validity and supplier term;
- `carried_from_item_cost_id` and `carried_from_hash`.

The system SHALL NOT instantiate catalog cost lines on an unreconfigured Amend mirror.

##### Scenario: Amend a costed item
- WHEN an Amend quote mirrors an item with a tail cost of 270 EUR (Carrier X, term to 2028-11-30)
- THEN the mirror line has one carried cost line `tail` at 270 EUR, confirmed, with Carrier X and 2028-11-30, and the price is unchanged

#### ADDED Requirement: Price lock on frozen Amend lines
The system SHALL treat every cost change on a frozen Amend mirror line as margin-only:
- it SHALL NOT change the line's charges or offer price;
- it SHALL be allowed in every non-terminal quote status while no order exists;
- it SHALL change the quote's `margin_hash`.

##### Scenario: Supplier renegotiation without a customer change
- WHEN procurement sets the carried tail cost on a frozen line of an Amend quote in `with_customer` from 270 to 240, with supplier quote ref `CX-2207`
- THEN the line's charges and `snapshotHash` are unchanged, the margin rises by 30 per month, and `margin_changed` is emitted

#### ADDED Requirement: Renew reconciles costs with today's catalog
The system SHALL, on every saved recalculation of an unlocked, cost-managed standalone Renew mirror line, first run `reconcileRenewCosts`:
- carry each open item cost whose `cost_key` matches an applicable catalog element, or that has no element;
- instantiate each applicable element the item does not have;
- list each open item cost whose element no longer applies as dropped at renewal, without carrying it.

The system SHALL then run the index spec's `reevaluateCarriedIndexCosts`. It changes only the value and `index_snapshot` of carried `index` lines with `value_origin = carried` that are not renegotiation due.

##### Scenario: Charge became cost-plus after the sale
- WHEN an item's charge was switched to cost-plus with an `on_request` tail element after activation, and the item is renewed
- THEN the Renew line has a catalog `tail` cost line (estimate or `none`), and the line prices from cost once the cost is known

##### Scenario: Element no longer applicable
- WHEN an item cost's element no longer applies to the item's configuration
- THEN the cost is shown as dropped at renewal and, after activation, the item cost is ended

##### Scenario: Index cost on a Renew
- WHEN a carried `index` cost with `value_origin = carried` that is not renegotiation due is recalculated after reconciliation
- THEN only its value and `index_snapshot` change, as of the recalculation date

#### ADDED Requirement: Renegotiation due on Renew
The system SHALL mark a carried MRC cost on a Renew line as `renegotiation_due`, with `value_status = estimated` and its value kept, when its `valid_until` or `supplier_term_end` is before the renewal's new term end. Such a cost MAY be requested and answered through the sourcing API.

The flag SHALL clear when the cost is confirmed in either way:
- by a supplier answer;
- by Keep current cost, with evidence (a new supplier quote ref or a note) and dates not before the new term end (the supplier term may instead be cleared to "rolling").

##### Scenario: Supplier term ends first
- WHEN a subscription with a tail whose supplier term ends 2027-06-30 is renewed to 2028-12-31
- THEN the tail cost line is estimated and renegotiation due, keeps its value, and conversion returns `422 COSTS_NOT_CONFIRMED`

##### Scenario: Supplier answer
- WHEN procurement requests the cost and the carrier answers 255 EUR valid to 2028-12-31 for the current request id
- THEN the line is confirmed at 255, `renegotiation_due` is false, and conversion succeeds

##### Scenario: Keep current cost
- WHEN procurement keeps the current cost with `valid_until` 2028-12-31 and the note "Carrier confirmed rolling term"
- THEN the line is confirmed at the same value, the flag clears, `margin_hash` is unchanged and conversion succeeds

#### ADDED Requirement: Cancel shows supplier early-exit exposure
The system SHALL show to holders of `cpq.costs.view`, for each item cancelled by a Cancel quote or by a cancel line, and for each asset cancelled with it, every **open** inventory cost (item or asset cost) whose `supplier_term_end` is after the reference date, with the months of exposure. MRC costs without a supplier term SHALL show "Supplier term unknown".

The reference date SHALL be today while the quote is open, and the change-log `effective_at` of the activating order afterwards. The system SHALL NOT record any cost.

##### Scenario: Supplier term outlives the cancel
- WHEN, on 2027-11-30, an open Cancel quote cancels a subscription whose Carrier X tail term ends 2028-11-30
- THEN the quote lists "Carrier X tail — term ends 2028-11-30 (exposure 12 months)"

##### Scenario: After activation
- WHEN that quote's order activates on 2027-12-15
- THEN the order shows the same cost with exposure measured from 2027-12-15

##### Scenario: Asset licence outlives the cancel
- WHEN that subscription also has a server asset whose licence cost term ends 2028-05-31
- THEN the quote also lists "Server licence — term ends 2028-05-31 (exposure 6 months)"

#### ADDED Requirement: Stale carried costs block conversion and activation
The system SHALL refuse with `409 COST_SOURCE_CHANGED` to convert an ARC quote, or to activate its order, when any cost-managed mirror line's open item costs differ from the state recorded at mirroring. A difference in value, supplier, validity, term, status, item or set of keys counts. The response SHALL name the lines, and the system SHALL write nothing.

##### Scenario: Two Amends renegotiate the same tail
- WHEN two Amend orders both carry the tail cost of one item, both wait for activation, and both are activated at the same time
- THEN exactly one activation succeeds, and the other returns `409 COST_SOURCE_CHANGED` and leaves the order, the items and the item costs unchanged

#### MODIFIED Requirement: Minimal inventory-cost write-back at ARC activation
The system SHALL, when an Amend, Renew or merge-Renew order activates, write inventory costs through one replace rule.

**Lines that replace their item's costs with their order line costs, matched by `cost_key`:**
- every mirror line that carries costs (`_arcCostsCarried`);
- every reconfigured mirror line (`_arcReconfigured`).

Replacing means:
- updating existing rows in place (same id);
- creating rows for new keys;
- reactivating the ended row of a returning key, never inserting a second row;
- ending rows whose key is missing;
- leaving rows whose state is unchanged unwritten, with no event.

**Other lines:**
- `cancel` lines end their item's costs and the asset costs of every asset they cancel (`ended_at` = the change-log `effective_at`);
- `add` lines create item costs;
- every other mirror line leaves item costs unchanged.

Asset costs are otherwise untouched by Amend and Renew (mirror lines exist for items only). A Cancel order SHALL end every open inventory cost (item and asset) of the subscription. No inventory cost id SHALL change, and every change SHALL be visible in that order's change-log snapshots and emit one `cpq.subscription.cost_changed` with `cause` `amend`, `renew`, `cancel` or `merge`.

##### Scenario: Cost-only Amend
- WHEN a cost-only Amend lowering the tail from 270 to 240 is moved `ready → accepted`, converted and activated
- THEN the item cost keeps its id and holds 240, the Amend change-log row shows 270 → 240, one `cost_changed (amend)` is emitted, and the amended billing payload has no added or removed items

##### Scenario: Returning key
- WHEN a Renew re-instantiates an element whose item cost was ended by an earlier Amend
- THEN the ended row is reactivated with the new value and keeps its id

##### Scenario: Renew created before cost carry-over
- WHEN a Renew quote created under the Phase 1 freeze is activated after this change
- THEN its untouched frozen lines activate at the contracted price, and their item costs are unchanged

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts` (sibling step 15)

Note: this replaces the sibling's ADDED text of the same requirement once both are archived. It keeps the sibling's asset clauses (product-owner review 2026-11-13).

#### MODIFIED Requirement: Inventory costs follow a merge
The system SHALL, when a merge-Renew clones source items onto the merged subscription, re-point each open item cost of a cloned item to the clone (`subscription_item_id`, `subscription_id`) and each open asset cost of an asset moved to the merged subscription (`subscription_id`), without changing any id, before the `merge-result` snapshot is taken. Merge-Renew mirror lines SHALL carry no cost lines. A re-point SHALL count as a change for the stale-carried-cost check of any other ARC quote that carried the cost.

##### Scenario: Merge two subscriptions
- WHEN subscriptions A and B, each with one costed item, are merged into M
- THEN M's two items carry the same two item cost ids, the `merge-result` `after_snapshot` shows them, and two `cost_changed` events with `cause: 'merge'` are emitted

##### Scenario: Stale after merge
- WHEN an Amend order on A that carried A's tail cost is activated after the merge
- THEN activation returns `409 COST_SOURCE_CHANGED`

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts` (sibling step 16)

#### ADDED Requirement: Cost and margin in the ARC line diff
The system SHALL show in the ARC line diff, only to holders of `cpq.costs.view`, each line's MRC / NRC cost and margin. The "before" values come from the open item costs, and the "after" values from the line costs and the offer.

##### Scenario: Renegotiated tail
- WHEN a frozen Amend line's tail cost goes from 270 to 240 at an MRC of 345
- THEN the diff shows cost 270 → 240 and margin 75 → 105, and a user without `cpq.costs.view` sees only the price rows

### Capability: cpq-quote-pricing

#### MODIFIED Requirement: Manual costs, cost confirmation and markup override
The system SHALL let a user with `cpq.quotes.manage` and `cpq.costs.manage`:
- add, edit and delete `manual` cost lines;
- enter or confirm the value of any cost line, including `carried` lines (a `note` is required when overwriting a `carried` value);
- keep a carried cost unchanged with new validity and evidence;
- override or clear a cost-plus charge's markup on one quote line.

All of these are subject to the cost lock. A cost change on a frozen Amend mirror line counts as margin-only. Entering a value (amount or value status) on a cost line with an open request SHALL cancel that request (`manual_value`) and clear any pending proposal in the same write; after a decline the alternative supplier's value SHALL be entered on the same cost line (R10a).

##### Scenario: Enter a tail cost by hand
- WHEN a pricing manager sets the `on_request` tail cost line to 280 EUR, `confirmed`, with a supplier quote ref
- THEN the line prices from 280, and the cost line has `value_origin = manual`

##### Scenario: Manual value while a request is open
- WHEN a pricing manager enters 290 EUR on a tail whose request seq 2 is open
- THEN seq 2 is `cancelled (manual_value)`, a later answer to seq 2 returns `409 COST_REQUEST_SUPERSEDED`

##### Scenario: Margin-only custom cost after submission
- WHEN a pricing manager adds a `margin_only` NRC cost of 1500 to a line of a quote in `in_approval`
- THEN the cost line is created, the price is unchanged, and `margin_changed` is emitted with `approvalInvalidated: true`

##### Scenario: Price-basis change while locked
- WHEN a pricing manager changes a price-basis cost value, or a markup, on an unfrozen line of a quote in `with_customer`
- THEN the API returns `409 COST_LOCKED` and nothing changes

##### Scenario: Carried cost on a frozen line while locked
- WHEN the same change is made to a carried price-basis cost on a frozen Amend mirror line
- THEN it is stored, the price is unchanged and `margin_changed` is emitted

Frozen by: `packages/cpq/src/modules/cpq/commands/__tests__/quote-line-costs.test.ts` (created by PR #87 step 12)

Note: this replaces the supplier sourcing spec's MODIFIED text of the same requirement (App Spec Phase 2, which itself replaced PR #87's). It keeps the request-cancellation sentence and scenarios and adds the `carried` and frozen-line clauses.

#### MODIFIED Requirement: Quote cost lines from catalog cost elements
The system SHALL keep exactly one non-deleted catalog cost line per applicable active cost element, matched by cost key, on every configured quote line that is not one of these:
- an unreconfigured Amend mirror;
- a frozen mirror (`isFrozenMirrorLine`);
- a cost-managed standalone Renew mirror.

A reconfigured mirror line SHALL instantiate catalog lines, keeping a carried value whose `cost_key` matches unless the reconfiguration resets it (R1b). A cost-managed standalone Renew mirror SHALL be reconciled instead (Renew reconciles costs with today's catalog). On every saved recalculation the system SHALL resolve `fixed` and `table` values and soft-delete cost lines whose element no longer applies, cancelling any open request on them (`element_deactivated` when the element is inactive, otherwise `reconfigured`). A reconfiguration that changes an attribute driving an `on_request` line SHALL reset its value to the catalog estimate (or `none`), keep the previous value in `note`, cancel any open request (`reconfigured`) and, for `requires_sourcing` elements, open a new one.

##### Scenario: Add a costed product
- WHEN a rep adds a product whose `tail_mrc` charge has a `table` element and an `on_request` element with estimate 300
- THEN the line has two cost lines: one `confirmed` with the table value (origin `catalog`), and one `estimated` at 300

##### Scenario: Reconfigure a driving attribute
- WHEN the line's `bandwidth` (a dimension of the tail element) changes from 1G to 10G while request seq 1 is open
- THEN the `on_request` cost line goes back to its catalog estimate (or `none`), its previous value is kept in `note`, seq 1 is `cancelled (reconfigured)` and exactly one `cost_request_cancelled` is emitted, and seq 2 opens when the element has `requires_sourcing`

##### Scenario: Unreconfigured Amend mirror
- WHEN an Amend quote mirrors a subscription item and nothing on the line changes
- THEN no catalog cost lines are created on the mirror line; only the carried lines exist

##### Scenario: Reconfigured Amend mirror with a carried tail
- WHEN the rep changes the port speed (not a tail dimension) on an Amend line carrying a 240 tail
- THEN the `tail` line keeps 240, and any other applicable element is instantiated

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/costResolution.test.ts` (created by PR #87 step 8)

Note: this replaces the supplier sourcing spec's MODIFIED text of the same requirement (Phase 2, itself built on the sibling's Phase 1 text). It keeps the sibling's mirror-line rule and the sourcing spec's request-cancellation and reset clauses, and adds the frozen-mirror, cost-managed Renew and carried-value rules.

### Capability: cpq-quote-lifecycle

#### MODIFIED Requirement: Quote to order conversion
The system SHALL:
- refuse to convert a quote whose stored pricing contains an invalid manual adjustment;
- refuse it while any price-basis cost line is not `confirmed` or has `valid_until` before the conversion date (`422 COSTS_NOT_CONFIRMED`, listing the lines);
- refuse it while any price-basis cost line has an unapplied supplier proposal (`422 COST_ANSWER_PENDING`, listing the lines);
- refuse an ARC quote whose carried costs are stale (`409 COST_SOURCE_CHANGED`);
- keep today's `cancelled` / `rejected` refusal;
- take the quote's pricing lock while converting.

Once an order exists, cost lines SHALL NOT change the quote's prices. A successful conversion SHALL copy every non-deleted quote cost line to exactly one order line cost and cancel every open cost request of the quote (`quote_closed`), both in the same transaction. A carried cost line's order line cost SHALL have its `inventory_cost_id` set to the carried item cost.

##### Scenario: Estimated tail blocks conversion
- WHEN an accepted quote has an `estimated` price-basis cost
- THEN conversion returns `422 COSTS_NOT_CONFIRMED` naming the line, and no order or order line cost is created

##### Scenario: Pending supplier answer blocks conversion
- WHEN an accepted quote has a confirmed tail of 276 and an unapplied proposal of 310
- THEN conversion returns `422 COST_ANSWER_PENDING` naming the line, and no order or order line cost is created

##### Scenario: Margin-only costs never block
- WHEN only a `margin_only` cost is unconfirmed and its request is open
- THEN conversion succeeds, that cost is copied with its `value_status`, and the request is `cancelled (quote_closed)`

##### Scenario: Stale carried cost
- WHEN an accepted Amend quote carries a tail cost that another ARC changed since mirroring
- THEN conversion returns `409 COST_SOURCE_CHANGED`, and no order is created

##### Scenario: Carried cost link
- WHEN an Amend quote carrying item cost `C` converts
- THEN the order line cost for `tail` has `inventory_cost_id = C`

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts`

Note: this supersedes the supplier sourcing spec's MODIFIED text of the same requirement (Phase 2), which replaced the sibling's (Phase 1), which replaced PR #87's. It keeps every earlier clause and adds only the `COST_SOURCE_CHANGED` clause and the carried link.

#### MODIFIED Requirement: Order activation
The system SHALL activate an order (new sale or ARC) atomically. Subscriptions, items, assets, inventory costs, change-log rows and the order status SHALL be committed together or not at all, and lifecycle events SHALL be emitted only after the commit. A failed activation SHALL leave no pending change in the caller's entity manager. Every activation SHALL first lock the source quote configuration and, for ARC orders, then the target subscriptions in id order, so that it is serialized with cost re-confirmations and with other activations of the same subscriptions.

##### Scenario: Late failure
- WHEN activation fails while writing the change-log row
- THEN no subscription, item, asset, inventory cost or change-log row from that activation exists, the order keeps its previous status, and the request entity manager has no pending change sets

##### Scenario: Serialized with re-confirmation
- WHEN an order is activated while a re-confirmation of one of its costs is in flight
- THEN the two run one after the other, and activation writes the re-confirmed value if the re-confirmation committed first

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqOrderService.test.ts` (sibling `describe('activateOrder transaction boundary')`)

#### ADDED Requirement: Post-conversion cost re-confirmation
The system SHALL let a user with `cpq.orders.manage` and `cpq.costs.manage` change the value, currency, supplier, validity or supplier term of an order line cost while the order is not yet active, under these rules:
- the change runs under the source quote lock;
- `total_amount` is recomputed and `reconfirmed_at` / `reconfirmed_by_user_id` are set;
- the order's charges and totals stay unchanged.

The system SHALL refuse once the order is active (`409 ORDER_ACTIVATED`). At activation the subscription item cost takes the re-confirmed value, with `last_order_line_cost_id` pointing at that order line cost.

##### Scenario: Carrier confirms a lower price
- WHEN the order manager re-confirms the tail from 276 to 270 on a draft order
- THEN the order line cost holds 270 with a recomputed `total_amount` and `reconfirmed_at`, the order totals are unchanged, and after activation the item cost holds 270, with one `cost_changed` whose cause is `amend` / `renew` (ARC) or `activation` (new sale)

##### Scenario: Race with activation
- WHEN a re-confirmation and the activation of the same order run at the same time
- THEN they are serialized; if activation commits first, the re-confirmation returns `409 ORDER_ACTIVATED` and writes nothing

## 📝 Architecture

- **Module:** `@dainamite/cpq` only. No imports from other `src/modules`, no ORM relations. Billing and the connector are untouched (I-9).
- **Reused:**
  - `arcPriceFreeze.ts` markers and `arcPricingInputsChanged` (`services/arcPriceFreeze.ts:16-27, 141-165`); the un-freeze in `updateQuoteItem` (`services/cpqQuotingService.ts:450-470`).
  - `mirrorTargetSubscriptionItems` (`:2714-2808`), the restore path (`:585-648`), and `loadArcSourceMap` / `pickArcSource` (`:2637-2682`) for `arcSource`.
  - PR #87: `costResolution`, `costService` (lock, redaction, toggle), `withQuotePricingWrite` + `marginTracker`, `quoteMargin.ts`, `runCpqMutationGuards`, `cpqErrorDoc`, and the command bus (non-undoable, redacted logs).
  - Sibling:
    - the activation transaction (forked EM), `inventoryCostSync` (`replaceItemCosts`, `createItemCosts`, `endItemCosts`, `repointItemCosts`, reactivation, the no-op rule), and `ArcLineChange.costSeeds` / `costSync`;
    - `orderCostCopy`, `snapshotSubscription` with `items[].costs[]`, `cost_changed`;
    - `isFrozenMirrorLine`, `_arcCostPlusFrozen`, `_arcReconfigured`, `isCostPlusItem`;
    - the order / subscription cost read routes with their status-only projections.
  - Sourcing spec: request / answer on any cost line, carried lines included.
  - Index spec: `reevaluateCarriedIndexCosts`.
  - The idempotency of `apply*` on `(source_order_id, subscription_id)` (`services/cpqInventoryService.ts:1019-1061, 1124+, 1400-1446`).
- **New code:**
  - `lib/stateHash.ts` — `canonicalStateHash(value): string`. `arcPriceFreeze.ts` imports `canonical` from it.
  - `services/costs/itemCostState.ts`:
    - `itemCostStateHash(row)` over `{id, subscriptionItemId, costKey, role, costType, chargeCode, source, costModel, unitAmount, instanceAmount, totalAmount, currencyCode, fxRate, fxRateDate, indexSnapshot, supplierId, supplierQuoteRef, validUntil, supplierTermEnd, supplierMinTermMonths, status}`;
    - `itemCostSetHash(openRows)`;
    - `assertCarriedCostsFresh(tx, lines)`.
  - `services/costs/arcCostCarry.ts` — `carryItemCosts`, `reconcileRenewCosts`, `computeDroppedCosts`, `computeCancelExposure(referenceDate)`.
  - `services/costs/sourceQuoteLock.ts` — `lockSourceQuote(tx, sourceQuoteId, scope)` and `lockSubscriptions(tx, ids, scope)` (`PESSIMISTIC_WRITE`, sorted).
  - `services/costs/orderCostReconfirm.ts` — command `cpq.order_line_cost.reconfirm`.
  - Quoting service methods `repriceFromCost(quoteId, lineId)` and `refreshMirrorFromSubscription(quoteId, lineId)`.
- **Current consumers affected:**
  - `activateOrder` callers (`api/orders/[orderId]/activate`, and `api/orders/[orderId]/status` → `transitionOrderStatus`, `services/cpqOrderService.ts:801-814`) get `409 COST_SOURCE_CHANGED` and lock waits.
  - The quote page (banners, line actions).
  - The order page: `ArcLineDiff` at `backend/cpq/orders/[id]/page.tsx:678`, and Re-confirm.
  - The Cost requests page (link on `QUOTE_CONVERTED`).
  - The amended / renewed billing payloads are unchanged.

```mermaid
flowchart LR
  item["CpqInventoryCost — sibling"] -->|mirror: carry + hash — new| ql["carried CpqQuoteLineCost — PR #87 table"]
  ql -->|renegotiate (margin only), request / answer, Re-price from cost| wq["withQuotePricingWrite — existing"]
  ql -->|conversion: hash check + copy + carried link| ol["CpqOrderLineCost — sibling"]
  ol -->|Q-D13 re-confirm under source-quote lock — new| ol
  ol -->|activation tx (sibling) + locks + hash check — new| sync["inventoryCostSync.replaceItemCosts — sibling"]
  sync --> item
  item --> log["CpqSubscriptionChangeLog snapshots — existing"]
```

Takeaway: costs travel item → quote → order → item along the existing ARC path, and every item-cost write goes through the sibling's single sync helper. The only new enforcement is one hash check, at conversion and again under lock at activation.

## 📝 Data Model

Migrations are generated with `yarn mercato db generate` into `packages/cpq/src/modules/cpq/migrations/`. They are additive only.

**`cpq_quote_line_costs` (PR #87) — used columns and one addition**

| Column | Type | Rules |
|---|---|---|
| `origin` | text | gains the value `carried` (enum widened in the validator / entity type; no DB change); server-set only |
| `value_origin` | text | gains `carried`; becomes `supplier` / `manual` when renegotiated |
| `carried_from_item_cost_id` | uuid null (exists) | the `CpqInventoryCost.id`; required when `origin = carried` |
| `carried_from_hash` | text null (exists) | `itemCostStateHash` at mirroring; required when `origin = carried` |
| `renegotiation_due` | boolean not null default false (**new**) | Renew carried MRC costs only (R13); cleared by an answer or Keep current cost |

New index: partial `(organization_id, tenant_id, carried_from_item_cost_id) WHERE deleted_at IS NULL AND carried_from_item_cost_id IS NOT NULL`. It finds open quotes carrying a given item cost (usage endpoint, support).

**Line configuration markers** (jsonb, no schema change): `_arcCostsCarried: true` and `_arcCarriedCostSetHash: string`. Both are added to `QUOTE_ONLY_ARC_KEYS` beside `_arcPriceFrozen`, `_arcRepriced`, `_arcCostPlusFrozen` and `_arcReconfigured`, and all stay there while Phase 1 quotes are in flight.

**`cpq_order_line_costs` / `cpq_inventory_costs`** (sibling): no new columns. This spec writes:
- on order line costs: `inventory_cost_id` at conversion for carried costs, and the value fields, `total_amount` and `reconfirmed_*` (Q-D13);
- on item costs, through `inventoryCostSync`: values, `status` / `ended_at`, `subscription_item_id` / `subscription_id` (merge), `last_change_id`, `last_order_line_cost_id`.

**Change log:** no schema change. The write-back runs before the after-snapshot (`services/cpqInventoryService.ts:1044`), so `after_snapshot.items[].costs[]` reflects ARC updates.

**Sensitive data:** costs, suppliers and terms are commercially confidential (not personal data).
- Carried lines inherit PR #87's gating: values only to `cpq.costs.view`, status-only projections otherwise.
- Command logs carry ids, statuses and `cost_key` only.
- `cost_changed` carries no amounts.
- The exposure panel and the diff rows are projected server-side, only for `cpq.costs.view`.
- The hash is a one-way digest and is never returned without `cpq.costs.view`.

```mermaid
flowchart LR
    classDef newEntity fill:#2f6feb,color:#fff,stroke:#1b4fb0
    classDef existingEntity fill:#e5e7eb,color:#111,stroke:#9ca3af
    entity_1["CpqQuoteLineCost (+ renegotiation_due, carried use)"]:::newEntity
    entity_2["CpqInventoryCost"]:::existingEntity
    entity_3["CpqOrderLineCost"]:::existingEntity
    entity_4["CpqQuoteLineConfiguration (ARC mirror)"]:::existingEntity
    entity_5["CpqInventorySubscriptionItem"]:::existingEntity
    entity_6["CpqSubscriptionChangeLog"]:::existingEntity
    entity_1 -->|n-1 carried_from_item_cost_id| entity_2
    entity_4 -->|1-n| entity_1
    entity_3 -->|n-1 source_quote_line_cost_id| entity_1
    entity_3 -->|n-1 inventory_cost_id| entity_2
    entity_5 -->|1-n| entity_2
    entity_6 -->|snapshots items[].costs[]| entity_2
```

## 📝 API Contracts

Every route has:
- `requireAuth` and `requireFeatures` (never `requireRoles`);
- an `openApi` export with errors via `cpqErrorDoc`;
- Zod validation, and errors as `{error, ...details}`;
- `runCpqMutationGuards` on writes (resource kinds `cpq.quote_line`, `cpq.quote_line_cost`, `cpq.order_line_cost`).

With the toggle `cpq.cost_plus` off:
- cost routes return `404`, as in PR #87;
- activation still enforces I-12 and still writes item costs (R14);
- Re-price from cost on a cost-plus charge returns `422 COST_PLUS_DISABLED`.

| Method + path | Features | Request | Response / errors |
|---|---|---|---|
| `GET /api/cpq/quotes/{quoteId}/costs` (PR #87) | `cpq.quotes.view` | — | Additive per line in the status-only projection: `carried` origin, `renegotiationDue`, `frozen`. With `cpq.costs.view` also: `droppedItemCosts:[{inventoryCostId, costKey, name, reason}]`; `previous:{unitAmount, currencyCode, supplierName, validUntil, supplierTermEnd}` on carried lines; and on cancel lines / Cancel quotes `exposure:{referenceDate, items:[{inventoryCostId, costKey, name, supplierName, supplierTermEnd, exposureMonths, termUnknown}]}` |
| `PATCH /api/cpq/quotes/{quoteId}/costs/{costId}` (PR #87) | `cpq.quotes.manage` + `cpq.costs.manage` | + `keepCurrent?: true` with `validUntil`, `supplierTermEnd?` (nullable = rolling), and `supplierQuoteRef?` or `note?` | `200`; `409 COST_LOCKED` (not on frozen lines, Q4); `422 VALIDITY_EVIDENCE_REQUIRED`, `RENEGOTIATION_DATES_SHORT`, `NOTE_REQUIRED` (overwriting a carried value), `LINE_NOT_ELIGIBLE` (cancel lines) |
| Sourcing request / answer API (sourcing spec) | unchanged | unchanged | accepts carried lines; an applied answer clears `renegotiation_due`; `409 QUOTE_CONVERTED` gains `{orderId, orderLineCostId}` (additive) |
| `POST /api/cpq/quotes/{quoteId}/items/{lineId}/reprice-from-cost` (new; last PR, Q3) | `cpq.quotes.manage` + `cpq.arc.amend.manage` | `{expectedRevision?}` | `200 QuoteResult`; `409 NOT_FROZEN`, `COST_LOCKED` (status outside `new` / `incomplete` / `ready`, or an order exists), `STALE_REVISION`; `422 NOT_AMEND_MIRROR`, `COST_PLUS_DISABLED` |
| `POST /api/cpq/quotes/{quoteId}/items/{lineId}/refresh-from-subscription` (new) | `cpq.quotes.manage` + `cpq.arc.amend.manage` or `cpq.arc.renew.manage` (the one matching the quote type, checked in the handler) | `{expectedRevision?}` | `200 QuoteResult` (line re-mirrored: configuration, charges, carried costs, hashes); `409 COST_LOCKED`, `STALE_REVISION`, `ITEM_NOT_ACTIVE`; `422 NOT_ARC_MIRROR`, `MERGE_LINE` |
| `POST /api/cpq/orders` convert (existing) | unchanged | — | + `409 COST_SOURCE_CHANGED {lines:[{quoteLineId, subscriptionItemId, costKeys}]}` |
| `POST /api/cpq/orders/{orderId}/activate`, and `POST …/status` → `active` (existing) | unchanged | — | + `409 COST_SOURCE_CHANGED` (same body); locked as in Q2 |
| `PATCH /api/cpq/orders/{orderId}/costs/{orderLineCostId}` (new) | `cpq.orders.manage` + `cpq.costs.manage` | `{unitAmount?, currencyCode?, supplierId?, supplierName?, supplierQuoteRef?, validUntil?, supplierTermEnd?, supplierMinTermMonths?, note?}`; a change of value needs `supplierQuoteRef` or `note` | `200 {cost, orderMargin}`; `409 ORDER_ACTIVATED`, `ORDER_CANCELLED`; `422 CURRENCY_NO_RATE`, `VALIDITY_EVIDENCE_REQUIRED` |
| `GET /api/cpq/cost-plus/usage` (PR #87, sibling) | `cpq.costs.view` | — | + `openArcQuotesWithCarriedCosts` (`liveSubscriptions` stays the sibling's "open" count) |

**Events:**
- `cpq.subscription.cost_changed` (sibling; non-broadcast, no amounts): after commit, once per created / changed / ended / reactivated / re-pointed item cost, with `cause ∈ {activation, amend, renew, cancel, merge}`. Re-confirmations emit no event (Q12). A no-op row emits nothing.
- `cpq.quote.margin_changed` (PR #87): emitted by carried-cost edits, sourcing answers on carried lines and Re-price from cost. Keep current cost leaves the hash unchanged, so it emits nothing.
- `cpq.subscription.amended` / `renewed` payloads are unchanged (I-9).
- No new event ids and no notifications.

**ACL:** no new features. Re-confirmation needs `cpq.orders.manage` + `cpq.costs.manage`. ARC actions reuse the existing `cpq.arc.*.manage` features (`acl.ts:18-20`).

## 📝 UI/UX

- **Quote detail, ARC quotes** (`backend/cpq/quotes/[id]/page.tsx`):
  - **All users:**
    - Carried cost lines show the PR #87 status badges plus `Carried` and `Renegotiation due`.
    - The Phase 1 banner "Costs are not carried to change quotes yet" no longer appears on new standalone Renews.
    - Phase 1 standalone Renew lines (Q6) show the line notice "Created before cost carry-over — costs kept as contracted. Refresh the line to renegotiate."
    - Merge lines show "Costs are not carried to merged subscriptions".
  - **`cpq.costs.view` holders (reps read-only):**
    - In the Costs panel, changed carried lines show "Was 270 EUR · Carrier X · term to 2028-11-30".
    - A "Dropped at renewal" group.
    - On frozen lines, the hint "Price locked — cost changes move margin only".
  - **`cpq.costs.manage` holders:** on carried lines, **Edit / Confirm**, **Request cost** (renegotiation due, via the sourcing dialog) and **Keep current cost**. The Keep current cost dialog asks for valid until, supplier term end or "rolling", and a supplier quote ref or note. It warns when a date is before the new term end.
  - **Line ⋯ menu:**
    - **Re-price from cost**: frozen Amend lines with a cost-plus charge. The confirmation shows the old and new price. Hidden until Q3 is met.
    - **Refresh from subscription**: standalone ARC mirror lines. Confirmation: "Discards renegotiated costs and changes on this line".
  - **Cancel quotes / cancel lines:** a **Supplier exposure** panel (`cpq.costs.view`) labelled "as of today", with rows such as "Carrier X tail — term ends 2028-11-30 (exposure 12 months)" or "Supplier term unknown". No panel when nothing outlives the reference date.
  - A cost-only Amend shows the hint "Internal change — no customer document needed; move to Accepted when ready."
  - `409 COST_SOURCE_CHANGED` shows "The subscription's costs changed since this quote was created". Before conversion it offers **Refresh from subscription**; after conversion it says "Cancel this order and create a new Amend".
- **`ArcLineDiff`** (`components/ArcLineDiff.tsx`): an optional `costs` prop `{before:{mrcCost, nrcCost}, after:{mrcCost, nrcCost}}`. It renders "MRC cost" / "MRC margin" / "NRC cost" rows only when present; the server omits it without `cpq.costs.view`. Used on the quote and order pages.
- **Order detail** (`backend/cpq/orders/[id]`, `order-cpq-tab`):
  - **Re-confirm** per order line cost on non-active orders (`cpq.costs.manage`). The dialog has value, currency, supplier, quote ref, validity, term and note, and the line then shows "Re-confirmed by … on …".
  - Activated Cancel orders show the exposure panel "as of {effective date}".
- **Cost requests page:** a converted quote's row links to the order's Re-confirm dialog.
- Every dialog: `Cmd/Ctrl+Enter` submits, `Esc` cancels. `409 STALE_REVISION` shows "Quote changed, reload".
- **Accessibility:** badges carry text, and diff rows have text labels, not colour only.

Mockups: skipped — no browser provider configured (text-only spec).

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| Another ARC changed the item's costs after mirroring (open quote) | conversion `409 COST_SOURCE_CHANGED`; Refresh from subscription fixes the line |
| Same, after conversion | activation `409 COST_SOURCE_CHANGED`, the sibling's transaction rolls back; the operator cancels the order and creates a new Amend |
| Two activations of one subscription in parallel | serialized by the subscription row lock; the second re-checks hashes and fails if the first changed carried costs |
| The first ARC left the item's costs untouched | the second activation succeeds (hashes equal) |
| Re-confirmation racing activation (new sale or ARC) | serialized by the source quote lock; the loser gets `409 ORDER_ACTIVATED`, or activation reads the committed re-confirmation |
| Re-price from cost with an unknown price-basis cost | line not ready (`COST_PENDING`), quote `incomplete` |
| Re-price on a non-cost-plus frozen line | allowed; re-prices at today's standard (same as a reconfiguration) |
| Renew of a cost-plus item with the toggle off | `COST_PLUS_DISABLED`, line not ready (R14) |
| Renew term changed after flags were computed | the next saved recalculation (unlocked) re-evaluates `renegotiation_due` |
| Renegotiation-due index cost | not re-evaluated by `reevaluateCarriedIndexCosts` until answered or kept |
| Keep current cost with a date still before the new term end | `422 RENEGOTIATION_DATES_SHORT` (the supplier term may be cleared to "rolling" with evidence) |
| An item cost whose `charge_code` no longer exists on the Renew line | dropped at renewal |
| A key ended by an earlier ARC returns | the ended row is reactivated (sibling Q9); never a second row |
| Item without costs | no carried lines; set hash of an empty set; activation writes nothing |
| Phase 1 Renew activated after the upgrade | frozen lines untouched; unmarked lines follow the sibling's Q5 (replace only when `_arcReconfigured`) |
| Merge renewal | no carried lines on the merge quote; item costs re-pointed to the clones, ids unchanged |
| Activation retried after success | idempotent change-log lookup (`services/cpqInventoryService.ts:1020-1028`) returns before any cost write; no duplicate events |
| Event dispatch fails after commit | logged and swallowed (`services/cpqOrderService.ts:389-398`); stored rows are authoritative |
| Cancel with a cost whose term ended before the reference date | not listed |

## 📝 Risks & Impact Review

- **Contracts and compatibility:**
  - New errors: `409 COST_SOURCE_CHANGED` on conversion and activation (both were already refusable).
  - Additive fields on the costs read route and on `QUOTE_CONVERTED`; two new line actions and one order route.
  - No breaking change. Billing payloads are unchanged (I-9). Logged in `packages/cpq/MIGRATION.md` and the changeset.
  - **Activation locks.** On top of the sibling's transaction boundary, every activation now holds the source quote row, and ARC activations also hold the target subscription rows, until commit. Concurrent quote edits on a converted quote (none expected) and parallel activations of one subscription wait instead of racing. Deadlocks are avoided by a fixed order: quote first, then subscriptions by id.
  - Standalone cost-plus Renew mirrors are re-priced again (from carried + reconciled costs). That restores the sibling R9 behaviour the Phase 1 freeze suspended. Merge mirrors stay frozen.
- **Rollback limits:**
  - Reverting the code leaves `carried` cost lines and `renegotiation_due` values that Phase 1 code ignores; the PR #87 columns are nullable or defaulted.
  - Item costs updated in place by ARC cannot be "un-updated", but every prior state is in the change-log `before_snapshot`.
  - The migration is one defaulted boolean plus one index.
- **Toggle-off:** never weakens I-12 or the write-back (R14). Cost UI and routes return `404`. Renews of cost-plus items fail with `COST_PLUS_DISABLED` until the toggle is re-enabled.
- **Confidentiality sweep:** extend PR #87's `costConfidentiality.test.ts` (sentinel 7777.77) to cover:
  - Amend / Renew / Cancel quote reads (status-only projection);
  - `ArcLineDiff` data in quote and order results;
  - the exposure block;
  - re-confirmation responses and command logs;
  - the change-log API without `cpq.costs.view`;
  - `cost_changed` and the amended / renewed payloads.
- **Product calls:** price lock by default (Q-D6), cost-only Amend as an internal change (Q-D12) and exposure only (Q-D10) are decided in the App Spec. Q3 (holding back Re-price from cost until `modifiedItems` exists) is a sequencing call for the owner.

## 📋 Phasing

Three PRs, each leaving the app working. All of them merge after the sibling's merged PR (backend + ARC safety).

- **PR 1 — Safety core (no visible change except stricter guards):** Phase A (characterization), Phase B (hash helper, activation locks, `COST_SOURCE_CHANGED`), Phase C (carry on Amend, carried link at conversion, write-back through `replaceItemCosts`, merge rule, cost-only modify) and Phase D (usage, Q-D13 re-confirmation).
- **PR 2 — Renew / Cancel and UI:** Phase E (R1c reconciliation then index re-evaluation, renegotiation due, Keep current cost, exposure, freeze no longer applied to standalone Renews, forward compatibility, Refresh from subscription) and Phase F (diff, badges, dialogs).
- **PR 3 — Re-price from cost:** Phase G. It merges after the sibling `modifiedItems` work (Q3), followed by the archive step.

## 📋 Implementation Plan

Tests run with `yarn test` (`jest.config.cjs`), using the mock-EM pattern from `.ai/skills/unit-tests/SKILL.md`. Run `yarn mercato db generate` after entity steps and `yarn generate` after structural ones (new routes).

### Phase A — Characterize (committed alone, green on unchanged code)
1. **Characterize ARC pricing, conversion and activation.**
   - `arcPriceFreeze.test.ts` / `cpqQuotingService.arc.test.ts`: Amend mirror line pricing and Renew mirror line pricing as the sibling leaves them.
   - `cpqOrderService.test.ts`:
     - the conversion refusals and copy as the sibling leaves them;
     - the activation transaction boundary;
     - an amended / renewed payload golden for an Amend with only `modify` lines (empty `addedItems` / `removedSubscriptionItemIds`).
   - `cpqInventoryService.arc.test.ts`: the sibling's minimal write-back and merge re-point scenarios.
   - `costResolution.test.ts`: the sibling's catalog-line eligibility.
   - `quote-line-costs.test.ts` (PR #87): the cost-lock cases.

### Phase B — Hash helper and guarded activation (#29)
2. **`lib/stateHash.ts`.** `arcPriceFreeze.ts` uses it; the characterization stays green. Then **`services/costs/itemCostState.ts`** with `itemCostStateHash`, `itemCostSetHash` (open rows only) and `assertCarriedCostsFresh`. Tests:
   - `lib/__tests__/stateHash.test.ts`: key order, dates, null vs undefined, numeric string normalisation;
   - `itemCostState.test.ts`: each projected field changes the hash, including `subscription_item_id`; `updated_at` does not; ended or not-open rows are excluded from the set.
3. **Activation locks (Q2).** `sourceQuoteLock.ts`. Inside the sibling's activation transaction, `activateOrder` calls `lockSourceQuote` first on every path. ARC paths then call `lockSubscriptions` (sorted ids) before `apply*`. No revision bump. Tests: mock-EM asserts lock order on the new-sale and ARC paths; the Order activation scenarios are updated.
4. **`COST_SOURCE_CHANGED`**:
   - at conversion: `convertFromConfig`, after the R7 guard;
   - at activation: after the locks, before any write.

   Tests in `cpqOrderService.test.ts`:
   - a stale value, supplier, ended row, re-pointed row or added key → 409 with nothing persisted;
   - **parallel-Amend test:** two orders carry the same tail and the first renegotiates it; activating both → exactly one succeeds.

### Phase C — Carry and write-back (#30 Amend part, #33)
5. **Entity changes.** `origin` / `value_origin` gain `carried`; add the `renegotiation_due` column and the partial index; run `yarn mercato db generate`. Validators accept `carried` only server-side. Tests: validator matrix.
6. **Carry on Amend mirror** (`arcCostCarry.carryItemCosts`), with the full field list (incl. `source`, `cost_model`, `index_snapshot`). Called from `mirrorTargetSubscriptionItems` (standalone targets only), `restoreQuoteItemInTransaction` and, from step 16, refresh. It sets `_arcCostsCarried` and `_arcCarriedCostSetHash` and extends `QUOTE_ONLY_ARC_KEYS`. `costResolution` is changed to the MODIFIED "Quote cost lines from catalog cost elements". Tests:
   - `arcCostCarry.test.ts`;
   - `cpqQuotingService.arc.test.ts`: the mirror creates carried lines and no catalog lines; restore re-carries; merge mirrors carry nothing;
   - `costResolution.test.ts`: updated to the MODIFIED scenarios.
7. **Frozen-line lock rule (Q4).** The `costService` lock treats changes on frozen Amend mirror lines as margin-only; `NOTE_REQUIRED` applies when overwriting a carried value. Update `quote-line-costs.test.ts` (MODIFIED requirement). Test: on a locked quote with a frozen line, the change is stored, `snapshotHash` is unchanged and `margin_changed` is emitted.
8. **Conversion link + write-back.**
   - The sibling's `orderCostCopy` sets `inventory_cost_id = carried_from_item_cost_id` for carried lines.
   - `buildArcLineChange` sets `costSync = 'replace'` for `_arcCostsCarried` lines (Q5), with seeds from their order line costs. The seeds carry `inventoryCostId`, and the code asserts it equals the matched row.
   - Writes go only through `inventoryCostSync.replaceItemCosts` (reactivation, no-op, `last_order_line_cost_id`).

   Tests:
   - `cpqOrderService.test.ts`: the carried link scenario;
   - `cpqInventoryService.arc.test.ts`, updated to the MODIFIED write-back scenarios: in place with the same id, a returning key reactivated, a cancel `ended_at` = `effective_at`, and the change-log `after_snapshot` equal to the new state.
9. **Cost-only Amend and I-9.** The Phase A payload golden stays byte-identical for a cost-only Amend (`modify` with `mrcDelta` 0). Test: `cpqOrderService.test.ts`.
10. **Merge rule.** Re-pointing uses the sibling's `repointItemCosts`, and merge mirrors stay frozen with no carried lines (Q10). Tests: the MODIFIED "Inventory costs follow a merge" scenarios, including "stale after merge".
11. **Forward compatibility.** Fixtures:
    - a standalone Renew created under the Phase 1 freeze (`_arcCostPlusFrozen` lines, no carried lines);
    - a non-cost-plus Phase 1 Renew with unmarked, never-frozen lines, one reconfigured.

    Both convert and activate after Phase C. Frozen lines stay untouched, the reconfigured line replaces, and the others stay untouched. Test: `services/__tests__/arcCostsForwardCompat.test.ts`.

### Phase D — Usage and re-confirmation (#27)
12. **Usage endpoint:** add `openArcQuotesWithCarriedCosts` (partial index from step 5) to `GET /api/cpq/cost-plus/usage`. Test: `costService.test.ts`.
13. **Q-D13** command `cpq.order_line_cost.reconfirm` (non-undoable, redacted log) and the route `api/orders/[orderId]/costs/[orderLineCostId]/route.ts` (`openApi`, guards). The command:
    - runs in its own forked transaction under `lockSourceQuote`;
    - refuses active and cancelled orders;
    - recomputes `total_amount`;
    - never touches `charges` / totals;
    - sets `reconfirmed_*` and emits no event (Q12).

    Extend the sourcing answer's `QUOTE_CONVERTED` body. Run `yarn generate`. Tests:
    - command test and route test by feature;
    - **race test** with activation (lock ordering);
    - order totals unchanged;
    - activation writes the re-confirmed value with `last_order_line_cost_id` and cause `amend` / `renew` / `activation`.

### Phase E — Renew, Cancel, refresh (#30 Renew part, #32)
14. **R1c reconciliation, then index re-evaluation, then renegotiation due.** For cost-managed standalone Renew mirrors, `costResolution` calls `reconcileRenewCosts` first and then `reevaluateCarriedIndexCosts` (index spec, coordinated with `.ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md`). The second call is limited to carried `index` lines with `value_origin = carried` and `renegotiation_due = false`, and changes only the value and `index_snapshot`. Due flags are computed against `newTermEnd`. The dropped list is computed on read.
    - `buildArcMirrorConfiguration` stops setting `_arcCostPlusFrozen` on **standalone** Renew lines; merge-renew lines keep it (Q10). Existing frozen lines keep their marker (Q6).
    - Sourcing answers on due lines clear `renegotiation_due`.

    Tests:
    - `arcCostCarry.test.ts`: match / instantiate / drop; due by `valid_until` and by `supplier_term_end`; margin-only lines flagged but not blocking;
    - the call-order test (reconciliation before index; due lines skipped);
    - the Renew mirror line pricing scenarios;
    - conversion returns `COSTS_NOT_CONFIRMED` while a cost is due;
    - an answer clears the flag.
15. **Keep current cost** on the PATCH route (`keepCurrent`, evidence, `RENEGOTIATION_DATES_SHORT`). It clears the flag and leaves `margin_hash` unchanged. Tests: route test and `costService.test.ts`.
16. **Refresh from subscription** (`refreshMirrorFromSubscription` + route with `openApi` and guards; `MERGE_LINE` for merge quotes). It re-mirrors configuration, charges and carried costs, soft-deletes the line's previous cost lines and cancels open requests on them (sourcing spec reason `reconfigured`). Tests: `cpqQuotingService.arc.test.ts`; run `yarn generate`.
17. **Cancel exposure** (`computeCancelExposure(referenceDate)`), with today on open quotes and the change-log `effective_at` on activated Cancel orders. It appears in the costs read projection for Cancel quotes and cancel lines, and in the order view. Tests: the two scenarios, an unknown term, and nothing outliving the reference date.
18. **Read projection** additions (`previous`, `droppedItemCosts`, `frozen`, `renegotiationDue`, `exposure`) with redaction. Extend `costConfidentiality.test.ts` as listed in the Risks section.

### Phase F — UI (#34)
19. **`ArcLineDiff` cost / margin rows** (optional `costs` prop), with server-side `arcCosts` in quote / order results for `cpq.costs.view` holders only. Test: `components/__tests__/ArcLineDiff.test.tsx` (rows hidden without the prop).
20. **Quote and order pages.**
    - Quote page:
      - the Phase 1 banner is removed for new standalone Renews; the Phase 1 line notice and the merge notice are added;
      - Carried / Renegotiation due badges, Request cost on due lines, the Keep current cost dialog;
      - the Refresh from subscription action, the exposure panel, the cost-only Amend hint;
      - handling of `COST_SOURCE_CHANGED`.
    - Order page: the Re-confirm dialog and the exposure panel.
    - i18n keys. Dialog keyboard handling (`Cmd/Ctrl+Enter`, `Esc`).
21. **Docs.**
    - `manuals/xd-250-arc-flow.md` and `manuals/cpq-cost-plus-pricing.md`: renegotiation, cost-only Amend, exposure, re-confirmation, and recovery from `COST_SOURCE_CHANGED`.
    - `packages/cpq/MIGRATION.md` + changeset.
    - GIX demo: one live subscription with a tail cost whose supplier term ends before its renewal.
    - Playwright smoke: cost-only Amend → accepted → convert → activate; the item cost keeps its id, and Change History shows 270 → 240.

### Phase G — Re-price from cost (#31; after `modifiedItems`, Q3)
22. **`repriceFromCost`** + route (`openApi`, guards, `COST_LOCKED`, `NOT_FROZEN`, `NOT_AMEND_MIRROR`). It clears `_arcPriceFrozen`, sets `_arcRepriced` and `_arcReconfigured`, and re-prices in `withQuotePricingWrite`. Update the Phase A characterization to the MODIFIED Amend mirror line pricing scenarios. Tests:
    - re-price from a renegotiated cost (345 → 300);
    - `COST_PENDING`;
    - the re-priced line appears in `modifiedItems` (sibling contract) at activation.

    UI: the line action and its confirmation.
23. **Archive the Delta** into `.ai/specs/capabilities/`:
    - `cpq-arc.md`: MODIFIED Amend mirror line pricing, Renew mirror line pricing, Minimal inventory-cost write-back at ARC activation, Inventory costs follow a merge; plus the ADDED requirements;
    - `cpq-quote-pricing.md`: MODIFIED Manual costs …, Quote cost lines from catalog cost elements;
    - `cpq-quote-lifecycle.md`: MODIFIED Quote to order conversion, Order activation; ADDED re-confirmation.

    This runs after the PR #87 and sibling archive steps.

### Acceptance (App Spec §7 Phase 3)

| Kind | Criterion | Steps |
|---|---|---|
| Domain | R13 / R1c — Amend carries every open item cost and is never re-instantiated; Renew reconciles | 6, 14 |
| Domain | I-11 — frozen-line cost edits change only `margin_hash`; Re-price un-freezes and flows through `modifiedItems` | 7, 22 |
| Domain | I-12 — `COST_SOURCE_CHANGED`, nothing written; parallel Amends → exactly one succeeds | 3, 4 |
| Domain | I-10 — in-place update (same id), `after_snapshot` = new state, Cancel ends, merge re-points, one `cost_changed` per change with its cause | 8, 10 |
| Domain | I-9 — cost-only Amend → zero billing diff | 9 |
| Domain | Renew — renegotiation due blocks conversion until confirmed (answer) or kept with evidence | 14, 15 |
| Domain | Forward compatibility — a Phase 1 Renew activates correctly | 11 |
| Domain | Q-D13 — margin only, serialized with activation by the same lock, refused once active | 3, 13 |
| Business | Cost-only Amend 270 → 240: same id, Change History before → after, price and billing unchanged | 8, 9, 21 |
| Business | Re-price from cost reaches billing through the modify path | 22 |
| Business | Renew flags an expiring supplier term and blocks conversion until confirmed or kept | 14, 15 |
| Business | Cancel lists supplier contracts outliving the cancel date | 17, 20 |
| Business | Concurrent ARC activation refused with `COST_SOURCE_CHANGED` | 4 |
