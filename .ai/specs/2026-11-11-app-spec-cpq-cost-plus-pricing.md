# App Spec: CPQ Cost-Plus Pricing (supplier costs, cost tables, indexed costs, margin)

> The App Spec is a business architecture document that sits above feature specs.
> It captures domain knowledge, validates cross-spec consistency, and ensures
> the capability solves a real business problem using the platform correctly.
>
> This document is the SINGLE SOURCE OF TRUTH for what this capability is, who it serves,
> and how it maps to the platform. Feature specs are generated from this document.
> If a spec contradicts this document, this document wins.
>
> Each section has a checklist with an owner. A section is done when all checks pass.

**Status:** COMPLETE — Phases 0–4 written; every challenger gate (Phase 0, 1, 2, 4 + final consistency) and both architect checkpoints run, with all CRITICAL findings fixed. §10 is decided except U2 (open, non-blocking, verified in the feature specs). The user asked for an autonomous run (2026-11-11), so every decision took the recommended option. Phase 5: feature briefs written in `briefs/2026-11-11-cpq-cost-plus-*.md`.
**Sibling App Spec (shipped):** [`2026-11-10-app-spec-cpq-quote-price-adjustments.md`](2026-11-10-app-spec-cpq-quote-price-adjustments.md). This spec extends its price waterfall and reuses its aggregate lock, ARC frozen-line scheme and quote events. Where the two specs disagree, the sibling wins for manual adjustments and this spec wins for costs.
**Capability catalog:** [`app-spec-notes/capability-catalog.md`](app-spec-notes/capability-catalog.md), extended by the cost-plus rows in [`app-spec-notes/cost-plus-capability-catalog.md`](app-spec-notes/cost-plus-capability-catalog.md).
**Gate notes (`app-spec-notes/`):** `cost-plus-challenger-phase0.md` · `cost-plus-challenger-phase1.md` · `cost-plus-architect-checkpoint-1.md` · `cost-plus-challenger-phase2.md` · `cost-plus-architect-checkpoint-2.md` · `cost-plus-challenger-phase4.md` · commit plans `cost-plus-commits-WF.md`

---

## 0. Current state (research, 2026-11-11)

`P/` = `packages/cpq/src/modules/cpq/`. `CORE/` = `@open-mercato/core` 0.9.0 `src/modules/` (read from another local install; this worktree has no `node_modules`).

| # | Fact | Evidence |
|---|---|---|
| C1 | A product charge (`CpqProductCharge`) has `code`, `chargeType` (`nrc` / `mrc` / `usage`), `chargeModel` (`flat` / `per_unit` / `volume` / `tiered`), `pricingMethod` (`fixed` / `table`), `fixedPrice`, `pricingTableId` + `priceColumnKey`, `currencyCode`, `quantityAttributeCode` and `applicabilityCondition`. | `P/data/entities.ts:481-563`, `P/data/charge-pricing.ts:7-48` |
| C2 | Pricing tables (`CpqPricingTable` + `CpqPricingTableEntry`) have named dimensions, named price columns, tiers / ranges and a currency per entry. Lookup filters by currency without conversion and matches dimensions case-insensitively. | `entities.ts:385-477`, `cpqPricingService.ts:43-61, 300-467` |
| C3 | The engine records `listUnitPrice` / `listTotalPrice` before price rules and `standardUnitPrice` / `standardTotalPrice` after them. Manual adjustments (`CpqQuotePriceAdjustment`) then produce the offer price. This is the **price waterfall**. | `cpqPricingService.ts:122-141`, `cpqQuotingService.ts:1042-1047`, `P/services/types.ts:199-249` |
| C4 | Every price-affecting quote write runs in `withQuotePricingWrite`. It takes a pessimistic lock on `CpqQuoteConfiguration`, increments `pricingRevision`, returns `409 STALE_REVISION` on a mismatch, and emits events after commit. | `P/services/priceAdjustments/quotePricingWrite.ts:10-50` |
| C5 | No cost, margin, supplier or markup concept exists in CPQ or in the sales module. `CpqInventoryAsset.purchasePrice` holds the **sale** NRC, not a cost. | `entities.ts:1145`, `cpqOrderService.ts:703` |
| C6 | CPQ pricing never reads Open Mercato catalog prices. The only catalog link is `CpqProductOffering.catalogOfferId`. Catalog `CatalogPriceKind` / `CatalogProductPrice` could hold a "cost" price kind but have no cost semantics. | `entities.ts:98`, `CORE/catalog/data/entities.ts:727+, 779+` |
| C7 | Conversion copies line `charges`, `nrcTotal` and `mrcTotal` to `CpqOrderLineConfiguration`. Activation copies them to `CpqInventorySubscriptionItem.charges` / `mrcAmount` / `nrcAmount`. Billing receives only one recurring `mrcTotal` and one one-time `nrcTotal` per item. | `cpqOrderService.ts:306-310, 637-639, 1158-1193`, connector `lib/chargeMapper.ts:60-120` |
| C8 | ARC mirrors live items as `modify` (or `cancel`) lines. Amend mirrors start **frozen** (`_arcPriceFrozen`) and are re-priced only when a pricing input changes (`_arcRepriced`). Renew mirrors are re-priced at today's standard. Activation write-back patches item `charges` / `mrcAmount` / `nrcAmount`. | `cpqQuotingService.ts:2714-2900`, `P/services/arcPriceFreeze.ts:63-165`, `cpqInventoryService.ts:1749-1773` |
| C9 | A line is configured when it has no errors and has charges, or is a bundle, or is an ARC mirror. `new` / `incomplete` / `ready` are set automatically from line validity. Every other status transition is operator-driven (any → any). | `cpqQuotingService.ts:1034-1035, 1119-1131`, `types.ts:40-65` |
| C10 | `cpq.quote.pricing_changed` and `cpq.quote.status_changed` are declared with `clientBroadcast: true`, so their payloads reach browsers over the event bridge. | `P/events.ts:84-105` |
| C11 | CPQ has no settings entity. The precedent for a package-level switch is the feature toggle `cpq.manual_price_adjustments`, seeded per install with `defaultValue: true` and read through `featureTogglesService`. The framework also offers `ModuleConfigService` (`module_configs`, tenant / org scoped JSON values). | `P/lib/priceAdjustmentDefaults.ts:14-16`, `P/di.ts:27`, `CORE/configs/lib/module-config-service.ts:106-118` |
| C12 | Each quote has a single currency. There is no FX code in CPQ. The framework `currencies` module holds dated exchange rates. | `types.ts:18-36`, `.ai/guides/core.currencies.md` |
| C13 | The workflows module offers `USER_TASK` (form, assignee roles, due date), `WAIT_FOR_SIGNAL`, `CALL_API` / `CALL_WEBHOOK` activities and event triggers with filter conditions. CPQ does not integrate with it yet. | `CORE/workflows/data/validators.ts:79-92`, `CORE/workflows/data/entities.ts:707+, 919+`, `.ai/guides/core.workflows.md` |
| C14 | Bundle children are separate lines (`parentLineId`), priced independently. Quote totals are a flat sum. The hierarchy carries through to orders, subscription items and ARC mirrors. | `cpqQuotingService.ts:205-216, 1571+`, `cpqOrderService.ts:320-330, 671-680` |
| C15 | The Puffin public calculator removes metadata keys containing `cost`, `margin` or `vendor` before exposing the catalog. That is evidence that cost data is already treated as confidential. | `src/modules/demo_puffin/lib/public-calculator/catalog-filter.ts:8-38` |

---

## 1. Business Context `PM`

### 1.1 Business Model

`@dainamite/cpq` is an L2 product module licensed by operators (demo tenants: GIX — interconnect / peering, Puffin — cloud). Today every CPQ price is a **list price** taken from the catalog: a fixed price or a pricing-table lookup. Many telco and B2B offers are not priced like that. Their price is **what the operator pays + a markup**:

1. **Third-party tail.** An internet access needs a last-mile circuit from a local carrier. The tail cost is unknown until the carrier quotes it, and the customer price = tail cost + markup.
2. **Fixed cost tables.** Hardware, colocation power or cross-connects are bought at known supplier rates (by model, site or bandwidth), and the price = cost + markup.
3. **Variable (indexed) cost.** Fuel, energy or oil-linked components: the cost moves with a published index, and the price = indexed cost + markup at the time of quoting.

Today all three are priced off-system: a spreadsheet computes the price, and the rep types it in as a manual override. As a result the quote does not know its cost, nobody sees the margin, and on renewal nobody knows what the supplier charges.

**Who pays (inherited from the sibling App Spec Q1, user-confirmed 2026-11-10 — reconfirm in Q-P0.1):** the operator licensing `@dainamite/cpq`. Daily users: the sales rep (quotes), the pricing manager / deal desk (costs, markups, margin review) and procurement (obtaining supplier costs). Consumers: the pricing admin (cost catalog) and finance (margin reporting).

**Flywheel (Q-P0.2, decided):**
```
Costs live in CPQ (catalog defaults + supplier quotes on the quote)
  → cost-plus prices are computed, not typed → no spreadsheet errors, faster quotes
  → every quote shows contract margin → deal desk approves on margin, not on discount %
  → costs travel to orders and subscriptions → renewals start from the real supplier cost
  → renegotiated supplier costs and confirmed tail prices accumulate per supplier / site
  → pricing admin turns recurring supplier quotes into cost tables → fewer "on request" costs
  → faster quotes, higher and predictable margin
```

#### Checklist
- [x] Paying customer identified (Q-P0.1)
- [x] Flywheel articulated (Q-P0.2)

### 1.2 Business Goals

**Primary goal (Q-P0.3, decided):** every quote containing cost-driven components is priced **from its cost inside CPQ**, and every quote shows its contract margin.
- ≥ 95% of won quotes that contain a cost-plus charge were priced from confirmed costs in CPQ, not from manual overrides (per tenant per quarter). Today: 0%.
- 100% of quotes show contract margin and **cost coverage** (§1.3) to holders of `cpq.costs.view`.
- 0 orders created from a quote whose price-basis costs are unconfirmed or expired (I-6).
- The time from cost request to confirmed cost is measurable per quote (today it is not recorded anywhere). This is the baseline for a later SLA.

**Secondary goal:** margin and cost status are exposed as data and events, so a project can configure margin-based approvals and supplier-sourcing workflows with Open Mercato Workflows, without CPQ code. The pattern is the same as the sibling spec's approval hook.

**What is NOT important (scope exclusions, Q-P0.4, decided):**
- **Billing of costs.** Costs never reach billing (the user's constraint). The billing event payload is unchanged (I-9).
- **Indexation of customer prices on live subscriptions.** An index moving after activation changes the **cost** (margin) only, never the billed price. Contractual price indexation clauses are a separate capability.
- **Procurement execution.** Supplier purchase orders, supplier circuit ordering and supplier invoice reconciliation (quoted vs invoiced cost) are out of scope. CPQ emits the facts (events) that a procurement integration can consume.
- **A supplier portal.** Suppliers do not log in. Their prices arrive through procurement staff or a project integration (workflow `CALL_WEBHOOK` / CPQ API).
- **Margin approval logic.** Thresholds and routing are project configuration (Workflows + mutation guards), as in the sibling spec. This spec delivers margin data, events and the guard hook.
- **Cost-plus on usage charges.** Usage is not priced at quote time (C1). A usage charge may still carry an informational cost estimate in a later phase.
- **Accounting.** No COGS posting, cost accruals or FX gain/loss.
- **The Open Mercato `catalog` module price kinds as the cost store** (C6). They are rejected in §1.4.9.

#### Checklist
- [x] Primary goal stated with measurable outcome (Q-P0.3)
- [x] Scope exclusions listed (Q-P0.4)

### 1.3 Ubiquitous Language

| Term | Definition | Source of data | Period |
|------|-----------|----------------|--------|
| Cost | What the operator pays a third party (or itself) to deliver one charge. Never billed to the customer. | supplier / catalog / index | per cost type (NRC once, MRC monthly) |
| Cost element | A **catalog** definition of a default cost attached to one product charge: source, role, value or lookup, supplier. Entity `CpqChargeCostElement`. | pricing admin | — |
| Cost key | The stable identity of a cost across quote → order → subscription → ARC: the cost element `code` for catalog costs, or a generated uuid for manual costs. Never changes after creation. | system | — |
| Cost source | How a cost value is obtained: `fixed` (stored amount), `table` (cost-table lookup), `index` (cost index × factor + offset) or `on_request` (unknown until sourced). | cost element / cost line | — |
| Cost role | `price_basis`: the cost feeds the price of a cost-plus charge. `margin_only`: the cost only feeds margin. `price_basis` is allowed only on cost-plus charges. | cost element / cost line | — |
| Cost-plus charge | A product charge with `pricingMethod = cost_plus`. Its list price is derived from its price-basis costs and its markup, not from a fixed price or a pricing table. Standard (`fixed` / `table`) and cost-plus charges coexist on one product and on one line. | `CpqProductCharge` | — |
| Markup rule | How a cost-plus charge turns cost into list price: `markup_percent` (cost × (1 + m)), `target_margin_percent` (cost ÷ (1 − m), 0 ≤ m < 100) or `markup_absolute` (cost + a, per instance). One rule per charge. | catalog; quote-level override | — |
| Markup override | A quote-level replacement of a cost-plus charge's markup rule, set by the pricing manager. It changes the **list price** (an input of cost-plus pricing). It is not a manual adjustment. | quote | — |
| Cost table | A `CpqPricingTable` with `purpose = cost`, used to look up costs: the same dimensions, tiers and currency rules (C2), referenced through a cost column key. Readable only with `cpq.costs.view`. A price charge can never reference a cost table, and a cost element never references a price table. | pricing admin | — |
| Cost index | A named, dated value series in one currency (e.g. "Brent crude, USD/bbl"). Entity `CpqCostIndex` + `CpqCostIndexValue`. | pricing admin / import | dated |
| Index value in force | For an as-of date: the highest-revision value at the latest `effective_date` ≤ that date. Future-dated values are allowed and never used before their date. | derived | date |
| Cost line | One cost **instance** on a quote line, for one charge (`charge_code`) or for the line as a whole (`margin_only` only). Origin `catalog` (from a cost element), `manual` (added by a pricing manager) or `carried` (mirrored from a subscription item cost in ARC). Entity `CpqQuoteLineCost`. | quote | — |
| Value status | How certain a cost line's value is: `none` (no value yet), `estimated` (a value that is not final — a catalog estimate, a rep / procurement estimate, or a carried value due for renegotiation) or `confirmed` (final). | cost line | — |
| Value origin | Who produced the current value: `catalog` (fixed / table / index resolution), `supplier` (answer to a cost request), `manual` (entered by a pricing manager) or `carried` (from the subscription item). | cost line | — |
| Sourcing status | Where the request for a supplier price stands: `not_requested`, `requested`, `answered`, `declined` (no supplier can serve, or the supplier refused) or `cancelled` (superseded by a reconfiguration or line removal). Independent of value status: an `estimated` cost can be `requested`. | cost line | — |
| Cost request | One attempt to obtain a supplier price for one cost line, identified by `cost_request_id` (sequence `request_seq`). Opening a new request cancels the previous open one. An answer must quote the current `cost_request_id`. | rep / pricing manager / system | — |
| Known cost | A cost line whose value status is `estimated` or `confirmed`. | derived | — |
| Expired cost | A `confirmed` cost line whose `valid_until` < the date it is evaluated at: the conversion date for the conversion guard (R7), today for UI warnings. | derived | date |
| Supplier | The party a cost is paid to: an optional FK string to a CRM company (`customers` module) used in a supplier capacity, plus a name snapshot. CPQ does not require the company to be tagged as a supplier. | cost line | — |
| Supplier quote reference | The supplier's own reference for a quoted cost (e.g. a carrier quote id). It is the idempotency key for answers. | procurement | — |
| Supplier term | The supplier's commitment for a recurring cost: `supplier_term_end` and `supplier_min_term_months`. Used to flag renegotiation on Renew and early-exit exposure on Cancel. | cost line / item cost | dates |
| Cost total | Per charge and cost type: the sum of its known cost lines, with each line's cost model applied, × line quantity. | derived | NRC once / MRC monthly |
| Cost-plus list price | For a cost-plus charge: the markup rule applied to the per-instance sum of its price-basis costs (R2). It then enters the existing waterfall: price rules → standard → manual adjustments → offer (C3). | derived | — |
| Margin | Per charge and cost type: offer total − cost total. **Margin %** = margin ÷ offer total (null when offer = 0). **Markup %** = margin ÷ cost total (null when cost = 0). | derived | NRC / MRC |
| Contract margin | Offer deal value − contract cost over the same horizon as deal value (sibling §1.3: NRC + MRC × `termMonths`, else max(12, last window end)). Usage is excluded. On ARC quotes: changed lines only (sibling rule). | derived | horizon |
| Covered charge | A charge with ≥ 1 cost line, all of them known. | derived | — |
| Cost coverage | The share of offer deal value carried by covered charges. Margin is reported as "based on X% coverage". Uncovered charges count as cost 0. | derived | horizon |
| Indicative quote | A quote with at least one `estimated` price-basis cost. It can reach quote status `ready` and be sent to the customer (Q-D2), but it cannot be converted (R7). | derived | — |
| Line ready / quote `ready` | **Line ready** = the line is configured with no blocking error (C9). **Quote `ready`** = the `cpqStatus` value set automatically when every line is ready. | derived | — |
| Cost lock | The sibling spec's adjustment lock, extended to price-basis cost lines and markup overrides: no create / change while `cpqStatus ∉ {new, incomplete, ready}` or an order exists. Exempt: margin-only costs, confirming a value without changing it, extending `valid_until` / supplier term, sourcing-status changes, and post-conversion re-confirmations before activation (margin only, Q-D13) (R11). | quote | — |
| Order line cost | A cost copied from a quote cost line to the order at conversion (entity `CpqOrderLineCost`, same `cost_key`). It never affects price. Only Q-D13 re-confirmations (margin only) change it, and only until activation. | conversion | — |
| Subscription item cost | The contracted cost of a live item: **one row per item and `cost_key` for the whole life of the purchase**. Its **id never changes**: ARC activations update it in place, a merge re-points it, and a cancel ends it. Entity `CpqSubscriptionItemCost`. Frozen between ARC changes (R12). | activation / ARC | started / ended |
| Cost history | The append-only record of every change to a subscription item cost: which quote and order changed it, the effective date, and the values before → after. Entity `CpqSubscriptionItemCostChange`. Shown like the subscription's Change History. | activation / ARC | dated |
| Cost renegotiation | An ARC change to a subscription item's cost (new supplier price, new supplier, re-sourced tail), with or without a customer price change. | ARC quote | effective date |
| Price lock (ARC) | On a frozen Amend mirror line, a cost change updates margin but **not** the customer price, until the user explicitly chooses **Re-price from cost** (which un-freezes the line). | ARC amend | — |
| Renegotiation due | A carried cost on a Renew line whose `valid_until` or supplier term ends before the new term end; its value status becomes `estimated` (R13). | Renew | — |
| Keep current cost | Confirming a renegotiation-due carried cost unchanged, with new validity and evidence (R11). | procurement | — |
| Overdue request | An open cost request older than the tenant's threshold (default 5 working days); a queue filter, not a status. | derived | days |
| Cost-plus enabled | The feature toggle `cpq.cost_plus` (boolean, default **off**, per-tenant override). See R14. | feature toggles | — |

#### Checklist
- [x] Every domain term defined once
- [x] Same word = same meaning across all sections
- [x] Source of data specified per term; period for time-windowed terms

### 1.4 Domain Model

#### 1.4.1 Core idea — cost is an input, margin is an output

```
                       ┌── standard charge:  fixed / table ──────────────┐
Charge list price ─────┤                                                 ├─▶ list ─(price rules)─▶ standard ─(manual adj.)─▶ offer
                       └── cost-plus charge: markup(Σ price-basis costs)─┘
                                                                                                   offer − cost ─▶ margin
Cost lines (price_basis + margin_only) ─────────────────────────────────────────────────────────────────────────▶ cost total
```

1. Cost-plus changes only **where the list price comes from**. Everything downstream of list price — price rules, standard price, manual adjustments, deal value, existing events, order, subscription, billing — keeps working unchanged (I-8, I-9).
2. Cost lines are **inputs**, stored in their own table, like manual adjustments. Margin is **output**, recomputed on every recalculation. The same inputs give the same outputs.
3. Cost and margin data live **only in cost-owned tables** read behind `cpq.costs.view` (I-4). Never in `charges`, `pricingSummary`, the quote / order / line configuration entities, or broadcast events. Those are read by every quote reader, written to undo snapshots and the audit log, indexed for search and exported.

**Aggregate:** `CpqQuoteConfiguration` stays the aggregate root of a quote's pricing (C4). Every cost write — cost line create / change / delete, value or sourcing change, markup override — runs inside `withQuotePricingWrite`: it takes the same lock, increments `pricingRevision` and emits after commit. A write that changes no price (margin-only cost, unchanged-value confirmation, validity extension, sourcing status) still takes the lock and the revision. It does **not** change the pricing `snapshotHash`, so the sibling spec's approvals, which key on the hash, stay valid.

**Outside the aggregate:** cost index values and FX rates are reference data. A quote reads them only at a saved recalculation while unlocked and snapshots what it used (R4). Subscription item costs form a separate aggregate (per subscription) that is changed only by activation and ARC activation.

#### 1.4.2 Entities and ownership

| Entity / data | Owner | Created by | Read by | Updated by |
|---|---|---|---|---|
| `CpqProductCharge.pricing_method += 'cost_plus'`, `markup_rule`, `markup_value` (new columns) | cpq | pricing admin | engine; API returns markup only to `cpq.costs.view` | pricing admin |
| `CpqChargeCostElement` (new) | cpq | pricing admin | engine (instantiation), UI | pricing admin; soft delete |
| `CpqCostIndex`, `CpqCostIndexValue` (new) | cpq | pricing admin / import API | engine | values append-only; a correction is a new value with the same date and a server-assigned higher `revision` |
| Cost tables = `CpqPricingTable` (existing) + new column `purpose` (select `price` \| `cost`, default `price`) | cpq | pricing admin | engine; `purpose = cost` tables and their entries only to `cpq.costs.view` | pricing admin |
| `CpqQuoteLineCost` (new) | cpq | system (from cost elements); pricing manager (manual); system on clone / ARC mirror | engine, cost-guarded API, conversion | pricing manager / procurement / workflow via API, per R11 |
| Margin (computed, **not stored**): pure `computeQuoteMargin()` over stored `charges` + cost lines; `margin_hash` computed before / after each write inside `withQuotePricingWrite` | cpq | engine | cost-guarded API, `margin_changed` event, project guards | — |
| `CpqOrderLineCost` (new; copy of quote cost lines at conversion) | cpq | conversion | cost-guarded API, activation | Q-D13 re-confirmation only, until activation |
| `CpqSubscriptionItemCost` (new; stable id per item + `cost_key`) | cpq | first activation | cost-guarded API, ARC mirror, reports | ARC activation in place (values, status `ended` on cancel / removal); merge re-points `subscription_item_id` |
| `CpqSubscriptionItemCostChange` (new; append-only cost history) | cpq | every activation / ARC activation / merge that changes an item cost | cost-guarded API, Cost History UI | never |
| Toggle `cpq.cost_plus` | feature_toggles | `cpq/setup.ts` | all cost paths | tenant admin |

#### 1.4.3 Catalog: `CpqProductCharge` additions

| Field | Type | Required | Rules |
|---|---|---|---|
| `pricing_method` | select `fixed` \| `table` \| `cost_plus` | yes (existing) | `cost_plus` only when the toggle is on; `chargeType ∈ {nrc, mrc}`; `chargeModel ∈ {flat, per_unit}`; `per_unit` requires `quantityAttributeCode` |
| `markup_rule` | select `markup_percent` \| `target_margin_percent` \| `markup_absolute` | for `cost_plus` | |
| `markup_value` | numeric(18,4) | for `cost_plus` | percent: ≥ 0 (target margin < 100); absolute: ≥ 0, in the charge currency, per instance |
| `fixed_price` | numeric | no | for `cost_plus`: optional **fallback indicative price**, shown only while costs are unknown; never quoted (R5) |

A cost-plus charge must have ≥ 1 active `price_basis` cost element (validated on save).

#### 1.4.4 Catalog: `CpqChargeCostElement` — fields

Table `cpq_charge_cost_elements`; standard columns `id`, `organization_id`, `tenant_id` (indexed), `created_at`, `updated_at`, `deleted_at`.

| Field | Type | Multi | Required | Rules |
|---|---|---|---|---|
| `product_charge_id` | uuid (FK string → `cpq_product_charges`) | no | yes | same module |
| `code` | text | no | yes | unique per charge; becomes the **cost key**; immutable |
| `name` | text | no | yes | e.g. "Last-mile tail", "Router purchase" |
| `role` | select `price_basis` \| `margin_only` | no | yes | `price_basis` only when the charge is `cost_plus` |
| `cost_type` | select `nrc` \| `mrc` | no | yes | must equal the charge's `chargeType` for `price_basis`; free for `margin_only` (e.g. an MRC charge with a one-off installation cost) |
| `source` | select `fixed` \| `table` \| `index` \| `on_request` | no | yes | |
| `cost_model` | select `flat` \| `per_unit` \| `tiered` \| `volume` | no | yes | same semantics as charge models (C1, C2): `flat` = per instance, `per_unit` = × charge quantity, `tiered` / `volume` only with `source = table`; any non-`flat` model needs a `quantityAttributeCode` on the charge |
| `amount` | numeric(18,4) | no | `fixed` | ≥ 0 |
| `currency_code` | text (ISO 4217) | no | `fixed`, `on_request` estimate | `index` costs take the index currency (no duplicate field) |
| `cost_table_id` + `cost_column_key` | uuid + text | no | `table` | lookup per R3 |
| `cost_index_id`, `index_factor`, `index_offset` | uuid, numeric(18,6), numeric(18,4) | no | `index` (factor default 1, offset default 0, offset in the index currency) | unit cost = index value × factor + offset |
| `estimate_amount` | numeric(18,4) | no | no (`on_request` only) | instantiated as an `estimated` value with origin `catalog` (Q-D2) |
| `default_supplier_id` / `default_supplier_name` | uuid (FK string → customers company) / text | no | no | |
| `default_validity_days` | integer | no | no | suggested `valid_until` = answer date + N |
| `requires_sourcing` | boolean | no | yes (default `true` for `on_request`) | auto-opens a cost request on instantiation (Q-D5); stored but a no-op until Phase 2 |
| `applicability_condition` | jsonb (same grammar as charges) | no | no | evaluated against the line configuration (C1) |
| `sort_order`, `is_active` | integer, boolean | no | yes | |

#### 1.4.5 Catalog: `CpqCostIndex` / `CpqCostIndexValue`

`cpq_cost_indices`: `code` (unique per tenant), `name`, `unit` (text, e.g. "USD/bbl"), `currency_code` (required), `is_active`.
`cpq_cost_index_values`: `cost_index_id`, `effective_date` (date), `value` numeric(18,6) (> 0), `revision` (integer, server-assigned, starts at 1), `source_note` (text), `created_by_user_id`. Unique key: `(cost_index_id, effective_date, revision)`. Values are append-only.

#### 1.4.6 Quote: `CpqQuoteLineCost` — fields

Table `cpq_quote_line_costs`; standard columns.

| Field | Type | Multi | Required | Rules |
|---|---|---|---|---|
| `quote_configuration_id` / `quote_id` / `quote_line_id` | uuid (FK strings) | no | yes | same quote |
| `cost_key` | text | no | yes | unique per line among non-deleted rows |
| `charge_code` | text | no | yes for `price_basis` | must resolve to exactly one charge on the line; null = a line-level `margin_only` cost |
| `origin` | select `catalog` \| `manual` \| `carried` | no | yes | |
| `cost_element_id` | uuid | no | when the cost key is a catalog element | kept on `carried` lines too |
| `carried_from_item_cost_id`, `carried_from_hash` | uuid, text | no | `carried` | I-12 |
| `name`, `role`, `cost_type`, `source`, `cost_model` | as §1.4.4 | no | yes | `manual` lines: `source ∈ {fixed, on_request}` |
| `value_status` | select `none` \| `estimated` \| `confirmed` | no | yes | `fixed` / `table` / `index`: `confirmed` when resolved, `none` + `error_code` on lookup failure |
| `value_origin` | select `catalog` \| `supplier` \| `manual` \| `carried` | no | with a value | |
| `unit_amount` | numeric(18,4) | no | when `value_status ≠ none` | ≥ 0; the per-unit or per-instance amount per `cost_model` (table tiers resolve to a per-instance `instance_amount`, also stored); MRC = monthly |
| `currency_code` | text | no | with `unit_amount` | |
| `fx_rate`, `fx_rate_date` | numeric(18,8), date | no | when `currency_code` ≠ quote currency | **quote-currency units per 1 cost-currency unit**; snapshot per R4 |
| `index_snapshot` | jsonb `{ indexId, currencyCode, effectiveDate, revision, value, factor, offset }` | no | `index` | snapshot per R4 |
| `sourcing_status` | select `not_requested` \| `requested` \| `answered` \| `declined` \| `cancelled` | no | yes (default `not_requested`) | |
| `cost_request_id`, `request_seq` | uuid, integer | no | once requested | a new request cancels the previous open one and increments `request_seq` |
| `requested_at`, `requested_by_user_id`, `answered_at`, `answered_by_user_id`, `decline_reason` | datetime / uuid / text | no | system-set | `requested_at` → `answered_at` is the sourcing lead time (§1.2) |
| `supplier_id` / `supplier_name` / `supplier_quote_ref` | uuid / text / text | no | no | `supplier_quote_ref` = the answer idempotency key |
| `valid_until` | date | no | no | |
| `supplier_term_end`, `supplier_min_term_months` | date, integer | no | no | MRC costs |
| `note` | text ≤ 500 | no | required when a pricing manager overwrites a `catalog` or `carried` value | the previous value is kept in the audit trail |
| `error_code` | text | no | system-set | `TABLE_NO_MATCH`, `CURRENCY_NO_RATE`, `INDEX_NO_VALUE`, `CHARGE_NOT_FOUND`, `COST_PLUS_DISABLED` |

Indexes: `(organization_id, tenant_id, quote_configuration_id)`, `(organization_id, tenant_id, quote_line_id)`, `(organization_id, tenant_id, sourcing_status)` for the sourcing queue.

**`CpqOrderLineCost`** (table `cpq_order_line_costs`): the same value, currency, FX, index, supplier, validity and supplier-term fields as the quote cost line, plus:
- `order_configuration_id`, `order_line_id`, `cost_key`, `cost_element_id`, `role`, `cost_type`, `charge_code`, `cost_model`, `origin`, `value_status`, `value_origin`;
- `source_quote_line_cost_id` (uuid, required);
- `subscription_item_cost_id` (uuid, null on new-sale lines; set on ARC lines whose cost is carried from a live item);
- `reconfirmed_at` and `reconfirmed_by_user_id` (Q-D13).

Unique `(order_line_id, cost_key)`.

**`CpqSubscriptionItemCost`** (table `cpq_subscription_item_costs`): the same value, currency, FX, index, supplier, validity and supplier-term fields, plus:
- `subscription_id`, `subscription_item_id`, `cost_key`, `cost_element_id`, `role`, `cost_type`, `charge_code`, `cost_model` and the computed totals;
- `status` (`active` | `ended`), `started_at`, `ended_at`;
- `last_change_id`.

Unique `(subscription_item_id, cost_key)`. The **id is stable for the life of the purchase**: it is created once at the first activation of its item and never re-created. Amend / Renew / re-confirmation activations update it in place. Cancel and item removal set `status = ended` and `ended_at`. A merge (C13: items are cloned under new ids) re-points `subscription_item_id` and `subscription_id` without changing the cost id.

**`CpqSubscriptionItemCostChange`** (table `cpq_subscription_item_cost_changes`, append-only — the cost counterpart of `CpqSubscriptionChangeLog`, `entities.ts:1387`):
- `item_cost_id`, `subscription_id`, `subscription_item_id`;
- `change_type` (`activation` | `amend` | `renew` | `cancel` | `merge` | `reconfirm`);
- `source_quote_id`, `source_order_id`, `source_order_line_cost_id`;
- `subscription_change_log_id` (the matching ARC change-log row, when one exists);
- `effective_at`;
- `before` / `after` jsonb (value, currency, FX, supplier, quote ref, validity, supplier term, status);
- `performed_by_user_id`.

Unique `(source_order_id, item_cost_id)` makes activation retries idempotent. Index `(organization_id, tenant_id, subscription_id, effective_at)`.

The computed margin (`computeQuoteMargin()`) returns `margin_hash` (hash of every cost line's value, currency, FX rate and role + markup overrides + offers — **not** statuses, so confirming an unchanged value never invalidates an approval) and, per quote and per line: NRC / MRC cost totals, offer totals, margin, margin %, markup %, contract cost, contract margin, coverage, the roll-up for bundle parents and the flags `hasEstimatedCosts`, `hasPendingCosts`, `hasExpiredCosts`, `hasOpenRequests`.

#### 1.4.7 Business rules

- **R1 Instantiation.**
  - (a) On a configured line that is not an ARC mirror (and on a reconfigured mirror), every applicable active cost element of every resolved charge has exactly one `catalog` cost line, matched by `cost_key`. Cost lines whose element is no longer applicable are soft-deleted, and any open request on them is `cancelled`.
  - (b) A reconfiguration that changes an attribute named in an element's applicability condition or its cost-table dimensions resets that element's `on_request` line: the value goes to `none` (or back to the catalog estimate); from Phase 2, any open request is also `cancelled` and `cpq.quote.cost_request_cancelled` is emitted. The previous value goes into `note`. Other known values are kept.
  - (c) Unreconfigured **Amend** mirror lines are never re-instantiated from the catalog: they carry exactly the item's costs (R13). **Renew** mirror lines, which are re-priced at today's standard, are **reconciled** with today's catalog: cost lines matching an item cost by `cost_key` are carried; applicable catalog elements the item does not have are instantiated (e.g. a charge that became cost-plus after the sale, or an element added since); item costs whose element is no longer applicable are shown as "dropped at renewal" and not carried.
- **R2 Cost-plus list price.** Per charge and per instance:
  - Compute `C = Σ over price-basis known cost lines of (the line's per-instance amount per its `cost_model` × fx_rate)` in full precision.
  - Then `list total = markup(C)`: `markup_percent` → C × (1 + m), `target_margin_percent` → C ÷ (1 − m), `markup_absolute` → C + a (once per instance).
  - The list total is rounded **once**, to the currency precision. For `per_unit` charges, `list unit = list total ÷ charge quantity`, kept at 4 dp. The engine multiplies with the existing per-instance totals, so no unit × qty drift is introduced. The feature spec states the exact rounding step against `cpqPricingService` (Q-D14).
  - Price rules and manual adjustments then apply unchanged (C3). The line quantity multiplies afterwards (existing behaviour).
  - A cost-plus charge with **no applicable price-basis cost line** has no price: the line is not ready (`NO_PRICE_BASIS_COST`).
- **R3 Currency.**
  - Table lookups prefer entries in the quote currency. Otherwise they use entries in the element's currency and convert.
  - A cost in any currency other than the quote currency needs an FX rate from `currencies` `ExchangeRateService.getRate`, called with `autoFetch: false` (no provider fetch inside the quote lock) and a look-back of 7 days (tenant-configurable). The returned `actualDate` is stored as `fx_rate_date`. When several providers have a rate, the tenant's default provider wins, else the highest-priority one. If no rate exists, the cost line is `none` + `CURRENCY_NO_RATE` and the line is not ready.
  - There is never a silent 1:1 conversion. Before FX ships (Phase 2), any non-quote-currency cost is `none` + `CURRENCY_NO_RATE`.
- **R4 Snapshot freeze (index and FX alike).** Index values and FX rates are taken as of the date of a **saved** recalculation while the quote is unlocked, and stored in the line's snapshot. Once the cost lock applies they are frozen. Conversion uses the stored snapshot. Previews compute but never store.
- **R5 Unknown cost.** A cost-plus charge whose price-basis cost lines include any with value `none` has **no list price**. The line is not ready (`COST_PENDING`), so the quote cannot reach `ready`. The fallback indicative price (§1.4.3) is shown as "≈", never stored as list price, and never counted in totals.
- **R6 Estimated cost.** `estimated` price-basis costs price the charge. The quote is **indicative**: it can reach `ready` and `with_customer` (Q-D2) and shows an "Indicative — costs not confirmed" badge.
- **R7 Conversion guard.**
  - Conversion is refused (`422 COSTS_NOT_CONFIRMED`) while any price-basis cost line is not `confirmed`, or is expired on the conversion date, and (`422 COST_ANSWER_PENDING`) while a supplier answer with a different `proposedAmount` is unapplied. Margin-only costs never block.
  - On an accepted quote, confirming the same value lifts the block (R11).
  - Confirming a **different** value changes the price, so the cost lock refuses it. The action **Reopen and apply supplier answer** moves the quote back to `ready` and applies the value in one write; the quote is re-sent / re-accepted (Q-D3). A reopened quote whose answer is not applied stays `ready` with `COST_ANSWER_PENDING`; the earlier customer acceptance is void until re-accepted.
- **R8 Margin.** Margin approvals key on `margin_hash` (not the pricing `snapshotHash`): any lock-exempt cost write after `ready` that changes the margin emits `margin_changed` with `approvalInvalidated: true`, and a project guard compares the approved hash with the current one. Computed per charge, line (own charges + line-level costs), line roll-up (own + bundle descendants, C14) and quote. It covers NRC, MRC, contract margin, margin %, markup %, cost coverage and the flags. It is computed on read and in every write (not stored); persisting it is deferred until a report needs it.
- **R9 Manual adjustments on cost-plus charges** behave as on any charge. They act on the standard price derived from cost, and the "never above standard" rule (sibling R3) still holds. Raising a cost-plus price is done with a **markup override** (`cpq.costs.manage`), never with a manual adjustment.
- **R10a Declined / alternative supplier.** A decline sets `value_status = none` (any estimate is moved into the note): an undeliverable cost never prices a sendable quote. When a catalog `on_request` cost is declined, the pricing manager enters the alternative supplier's value **on the same cost line** (`value_origin = manual`, note required, supplier fields updated); a `cost_key` never needs a second cost line.
- **R10 Manual (custom) costs.** A pricing manager may add a `manual` cost line to any line at quote review (e.g. a carrier special-build fee, extra installation labour). A manual cost line may be `price_basis` only on a cost-plus charge, where it changes the price. Otherwise it is `margin_only`.
- **R11 Cost lock.**
  - Price-basis cost lines and markup overrides cannot be created, changed or deleted while locked.
  - Always allowed in non-terminal statuses:
    - margin-only cost changes;
    - confirming an unchanged value (`estimated` → `confirmed`);
    - extending `valid_until` / the supplier term;
    - after conversion and before activation, re-confirming a different value (Q-D13, from Phase 3): margin only, `charges` untouched;
    - sourcing-status changes (request, decline, cancel).
  - Answers that **change** a price-basis value on a locked quote are recorded on the request as `answered` with a `proposedAmount`; the value itself is not applied. The line shows "Supplier answered with a different cost" and the action **Reopen and apply supplier answer** (R7), which consumes `proposedAmount` under the same `cost_request_id`, keeping `value_origin = supplier` and the supplier quote ref.
  - Status transitions sent from the UI carry `expectedRevision`; a supplier answer (or any price-affecting write) that lands between the rep's last view and the transition yields `409 STALE_REVISION`, so a rep never sends a price they have not seen. The answer API itself takes the lock and needs no revision (automated callers never fail on concurrent margin-only edits).
  - Extending `valid_until` / the supplier term requires a new `supplier_quote_ref` or a note (evidence), recorded in the audit trail.
- **R12 Order and subscription.**
  - Conversion copies every quote cost line to a `CpqOrderLineCost` (same `cost_key`, `source_quote_line_cost_id`, and `subscription_item_cost_id` for costs carried from a live item). From then on, costs never affect price. Only Q-D13 re-confirmations on the order line cost (margin only) are allowed, until activation.
  - The first activation of an item creates one `CpqSubscriptionItemCost` per order line cost (stable id) and one `CpqSubscriptionItemCostChange` (`activation`). Values, FX and index snapshots are **frozen until the next ARC change**. An index moving after activation does not revalue item costs in this scope (Q-D9).
  - **Billing payloads are unchanged** (I-9).
- **R13 ARC.**
  - **Amend:**
    - Mirror lines carry the item's open costs as `carried` cost lines (same `cost_key`, `value_status = confirmed`, values, supplier, validity, supplier term, `carried_from_hash`).
    - **Price lock:** while a mirror line is frozen, changing a carried cost (renegotiation) changes margin only. **Re-price from cost** (an explicit action) or any configuration change un-freezes the line (existing C8). A configuration change also applies R1b, so re-sourcing may be required.
  - **Renew:**
    - Mirror lines are re-priced at today's standard (existing rule).
    - Carried costs keep their values. `index` costs are re-evaluated as of the recalculation date.
    - A carried MRC cost whose `valid_until` or `supplier_term_end` falls before the new term end is turned into `estimated` ("renegotiation due"; value kept, shown with the previous supplier term). A cost request can be opened on it. It blocks conversion until confirmed (R7): either a new supplier answer, or "keep current cost" with a new validity.
  - **Cancel:** cost lines are not editable. The Cancel quote shows, per item, any cost whose `supplier_term_end` is after the cancel effective date ("supplier early-exit exposure"). At activation, item costs are ended (`status = ended`, `ended_at` = the cancel effective date), with a `cancel` history entry. Recording a supplier early-termination charge is Q-D10.
  - **At ARC activation:**
    - A changed cost **updates the same `CpqSubscriptionItemCost` in place** (its id is unchanged) and appends one `CpqSubscriptionItemCostChange` (`amend` / `renew` / `reconfirm`) with before → after, the effective date E, and the source quote / order (linked to the subscription's `CpqSubscriptionChangeLog` row).
    - A cost new to the item (e.g. an element added at Renew) creates its row.
    - Cancel or removal sets `status = ended` and appends a `cancel` change.
    - A cost-only change produces a `modify` change with **no billing impact** (C8, I-9).
- **R14 Toggle.** `cpq.cost_plus` defaults off and has per-tenant overrides. When off:
  - cost UI, cost APIs and cost columns are hidden (`404` for cost endpoints);
  - `cost_plus` charges cannot be created;
  - the toggle never weakens guards or data paths: R7 still runs at conversion, activation still writes item costs for converted orders, and the answer API returns `409 COST_PLUS_DISABLED` (retryable after re-enabling) instead of `404`, so workflows and webhooks never lose an answer silently; open requests are listed by the usage endpoint;
  - quotes with stored cost-plus data stay readable (prices only), but any **re-pricing** of a cost-plus charge — recalculation of a new line, a reconfiguration, a Renew mirror — fails with `COST_PLUS_DISABLED` (line not ready). Renewals of cost-plus subscriptions therefore need the toggle on.
  
  Turning the toggle off never deletes data. `GET /api/cpq/cost-plus/usage` (`cpq.costs.view`) reports the open quotes, open requests and live subscriptions using cost-plus; the manual tells admins to check it before switching off (the platform toggle page has no injection spot — architect #2).
- **R15 Calculate-price API and the public calculator** never return cost or markup.
  - A cost-plus charge returns its list price when all its applicable price-basis costs resolve without a quote (`fixed`, `table`, `index`, or `on_request` with an estimate — returned as `indicative: true`).
  - Otherwise it returns `priceOnRequest: true` and no price (Puffin: "Contact sales").
  
  This is additive (sibling R13).
- **R16 Clone.** A clone copies cost lines with new ids:
  - `catalog` lines re-resolve on the clone's first recalculation;
  - `manual` values are kept;
  - supplier answers are kept with their `valid_until`, so expired ones show expired;
  - open requests are **not** copied (`sourcing_status = not_requested`);
  - markup overrides are copied.

#### 1.4.8 Invariants

| # | Invariant |
|---|---|
| I-1 | Every cost line belongs to one quote line of the same quote; a `price_basis` cost line targets exactly one cost-plus charge on that line; `cost_key` is unique per line. |
| I-2 | A cost-plus charge has a list price **iff** it has ≥ 1 applicable price-basis cost line and all of them are known. |
| I-3 | On every non-frozen quote line without an order, `list price = markup(Σ price-basis known costs)` exactly, per R2; recalculation is idempotent for the same snapshots. Exceptions by design: frozen ARC mirror lines (I-11) and costs re-confirmed after conversion (Q-D13) — there cost and price diverge and only margin moves. |
| I-4 | No cost value, markup or margin appears in `charges`, `pricingSummary`, the quote / line / order configuration entities, calculate-price responses, `clientBroadcast` events, or in audit-log, undo, search-index or export payloads available to holders without `cpq.costs.view`. |
| I-5 | Cost lines change only inside `withQuotePricingWrite` (lock + revision); price-basis values never change while locked, except post-conversion re-confirmations before activation (Q-D13: margin only, `charges` untouched). |
| I-6 | At conversion time, every price-basis cost line of the quote is `confirmed` and not expired on that date. |
| I-7 | Subscription item costs equal the quote cost lines (as re-confirmed, Q-D13) at activation, with dates materialised; `cost_key` is kept at every step. |
| I-8 | A quote with no cost-plus charges and no cost lines prices identically before and after this capability. |
| I-9 | Billing event payloads and billing items are identical with the toggle on or off. |
| I-10 | Per subscription item and `cost_key`, exactly one `CpqSubscriptionItemCost` exists for the life of the purchase, and its id never changes (a merge re-points it). Every change of its values or status appends exactly one `CpqSubscriptionItemCostChange` whose `after` equals the row's new state. The history is never edited. |
| I-11 | On a frozen ARC mirror line, no cost change alters the offer price. |
| I-12 | A carried cost line whose source item cost changed since mirroring (hash mismatch) blocks ARC activation (`409 COST_SOURCE_CHANGED`) — same pattern as the sibling's carried adjustments. |
| I-13 | A supplier answer is applied only when it quotes the cost line's current `cost_request_id`; otherwise `409 COST_REQUEST_SUPERSEDED`. A repeated answer with the same `supplier_quote_ref` **on the same cost line** is a no-op (a clone's cost line accepts it as new). |

#### 1.4.9 Domain events (after commit; signals — stored data is authoritative)

| Event id | When | Payload (beyond tenant / org) | Broadcast |
|---|---|---|---|
| `cpq.quote.cost_requested` (new) | a cost request opens (manual or auto, R1 / `requires_sourcing`) | `quoteId`, `quoteLineId`, `costLineId`, `costRequestId`, `requestSeq`, `costKey`, `chargeCode`, `productId`, `offeringId`, the line configuration attributes named by the element (e.g. site address, bandwidth), `supplierId`, `requestedByUserId` | **no** |
| `cpq.quote.cost_request_cancelled` (new) | an open request is superseded or orphaned: R1b reset, line removed, element deactivated, re-request, manual value entered, or the quote reaches a terminal status / is deleted (`quote_closed`) — always in the same transaction as the cause | ids, `costRequestId`, `reason` (`reconfigured` \| `line_removed` \| `element_deactivated` \| `re_requested` \| `manual_value` \| `quote_closed`) | no |
| `cpq.quote.cost_valued` (new) | a cost line gets a value or its value / value status changes, including supplier answers and declines | ids, `costRequestId?`, `valueStatus`, `previousValueStatus`, `sourcingStatus`, `valueChanged`, `leadTimeHours`; **no amount** | no |
| `cpq.quote.margin_changed` (new) | a save changes the quote's `margin_hash` | `quoteId`, `cpqStatus`, `pricingRevision`, `marginHash`, `previousMarginHash`, `approvalInvalidated` (true when `cpqStatus ∉ {new, incomplete, ready}` and no order exists), `contractMargin`, `marginPercent`, `costCoverage`, flags | **no** — the margin approval hook |
| Notifications (`notifications.ts`, new types — not events) | a request opens → to `cpq.costs.manage` holders; a request is answered / declined → to the quote owner | "Cost requested / answered / declined on quote Q-123" — no amount | — |
| Notification `cpq.cost.expiring` (Phase 4) | with `cost_expiring` → to `cpq.costs.manage` holders | quote no., cost name, `validUntil` — no amount | — |
| `cpq.quote.cost_expiring` (new, scheduled, later phase) | a confirmed price-basis cost on a non-terminal, unconverted quote reaches `valid_until` − N days | ids, `validUntil` | no |
| `cpq.quote.status_changed` (existing) | unchanged | gains only `hasPendingCosts` / `hasEstimatedCosts` (booleans, not sensitive) | yes (existing) |
| `cpq.subscription.item_cost_changed` (new) | each new `CpqSubscriptionItemCostChange` (activation, ARC activation incl. the Phase 1 minimal write-back, merge, re-confirmation) | `subscriptionId`, `subscriptionItemId`, `itemCostId`, `changeId`, `costKey`, `effectiveDate`, `supplierId`, `sourceOrderId`, `cause: 'activation' \| 'amend' \| 'renew' \| 'cancel' \| 'merge' \| 'reconfirm'`; no amounts | no |

**Anti-corruption boundary.** External data enters at three points, each validated by a Zod schema at the API:
- supplier answers (cost confirm API: request id, amount ≥ 0, currency known to `currencies`, `valid_until` ≥ today);
- index values (import API: value > 0, server-assigned revision);
- FX rates (read from `currencies` only, never typed onto a cost line).

**Rejected alternative:** storing costs as Open Mercato catalog prices (`CatalogPriceKind` "cost", C6). CPQ pricing does not read catalog prices. Cost elements need sources that catalog prices cannot express (`on_request`, `index`, roles, suppliers). And a cross-module read would break the "CPQ installable alone" rule.

#### 1.4.10 Access control

| Action | Feature (default roles — Q-D1) |
|---|---|
| See cost **status** on quote lines (none / estimated / confirmed / expired, sourcing status) | `cpq.quotes.view` (existing) |
| Request a cost | `cpq.quotes.manage` (existing) |
| See cost values, suppliers, markup (also on product charges), margin | `cpq.costs.view` (new; default `admin` **and `employee`**: reps see cost details read-only — Q-D1, user decision 2026-11-12) |
| Add / edit / delete manual costs, enter or confirm costs, answer or decline requests, markup override | `cpq.costs.manage` (new; default `admin`) |
| Cost elements, cost tables, cost indices and index values, `cost_plus` charges | `cpq.pricing.manage` **+** `cpq.costs.view` (both enforced server-side on every cost-catalog route, including `pricing-tables` and `pricing-table-entries`; the Pricing tables list filters `purpose = cost` server-side) |
| Cost-guarded responses | every response containing cost data checks `cpq.costs.view` server-side; no client-side-only hiding |

#### Checklist
- [x] Domain entities identified with clear ownership
- [x] Domain rules documented — invariants, constraints, calculations
- [x] Levels/tiers — N/A
- [x] KPIs/scores — margin and coverage formulas with input source and horizon
- [x] Access control rules documented
- [x] Data ownership per entity
- [x] Entity fields defined precisely

---

## 2. Identity Model `PM`

| Persona | Role key | Identity | Org scope | Sees | Does |
|---------|----------|----------|-----------|------|------|
| Sales rep | `employee` (+ `cpq.costs.view` by default) | internal | own organization | quotes, prices, cost details and margin (**read-only** — Q-D1) | builds quotes, requests costs; cannot edit costs or markups |
| Pricing manager / deal desk | role with `cpq.costs.view` + `cpq.costs.manage` (default `admin`) | internal | own organization | costs, suppliers, markup, margin | adds custom costs, overrides markup, confirms costs, reviews margin |
| Procurement / cost sourcing | role with `cpq.costs.view` + `cpq.costs.manage` | internal | own organization | sourcing queue, cost lines | obtains supplier quotes, enters and confirms costs |
| Pricing admin | role with `cpq.pricing.manage` + `cpq.costs.view` | internal | own organization | cost catalog | maintains cost elements, cost tables, indices, markups |
| Order manager / operations | role with `cpq.orders.manage` (+ `cpq.costs.view` / `cpq.costs.manage` to see / re-confirm costs) | internal | own organization | orders, subscriptions | converts, activates; re-confirms costs before activation (Q-D13) |
| ARC operator | sales rep with `cpq.arc.amend.manage` / `cpq.arc.renew.manage` / `cpq.arc.cancel.manage` (+ `cpq.costs.view` to see carried costs) | internal | own organization | change quotes | amends, renews, cancels |
| Tenant admin | `admin` | internal | tenant | feature toggles | switches `cpq.cost_plus` per tenant |
| Project implementer | `admin` | internal | tenant | events | configures the sourcing / approval workflows |
| Supplier | — | **none** (no account) | — | — | sends quotes off-system or through a project integration |

**Portal decision:** NOT USED. Every persona is internal and needs the backend's data grids. Suppliers are external, but per the decision tree a supplier portal is a separate product (procurement), excluded in §1.2. A project can connect a supplier API through a workflow `CALL_WEBHOOK` plus the cost-confirm API.

**Decision log:** procurement gets no separate identity type; it is a role with feature grants. That keeps one identity system and lets a project merge the pricing manager and procurement roles.

#### Checklist
- [x] Every persona has ONE identity type `PM`
- [x] Identity decision justified per persona `PM`
- [x] No persona has two accounts `Architect`
- [x] Org scoping defined per role `Architect`
- [x] Portal decision justified with the decision tree `PM`

---

## 3. Workflows `PM`

### WF1: Define cost-plus offers and the cost catalog

**Journey:** pricing admin enables `cpq.cost_plus` → creates the cost tables (`purpose = cost`) and cost indices with values → on the offering, sets a charge to `cost_plus` with a markup rule → adds cost elements (source, role, cost model, supplier, estimate, `requires_sourcing`) → previews the resulting list price with the calculate-price API → the offering is sellable.

**ROI:**
- A new cost-plus offer is configured with 0 code and 0 spreadsheet formulas.
- A supplier rate change is one cost-table row edit. Every later quote picks it up on its next saved recalculation, where today every affected quote is re-typed.

**Key personas:** pricing admin.

**Boundaries:**
- Starts when: the toggle is on and the admin opens a charge.
- Ends when: the cost-guarded **cost preview** (`POST /api/cpq/cost-preview`, `cpq.costs.view`) shows the cost breakdown and list price for a sample configuration — or `priceOnRequest` for `on_request`-only charges, which is the expected outcome for them.
- NOT this workflow: quoting (WF2), sourcing (WF3), index revaluation of live items (Q-D9).

**Edge cases:**
1. A cost-plus charge is saved with no `price_basis` element → refused (`422 NO_PRICE_BASIS_ELEMENT`). Risk if unhandled: `markup(0)` prices.
2. `target_margin_percent` ≥ 100 → refused. Risk: division by zero or a negative price.
3. Deactivating the last active price-basis element of a cost-plus charge → refused (§1.4.3). A cost element is deactivated while open quotes use it → open unlocked quotes drop the cost line on their next saved recalculation (R1a; the same as standard prices, which are not frozen); locked quotes keep it. Risk: silent price change on a locked quote.
4. A cost table has no entry for the quote currency or for the dimension values → `TABLE_NO_MATCH` / `CURRENCY_NO_RATE`, line not ready. Risk: a 0 cost.
5. A catalog reader without `cpq.costs.view` opens the offering → sees the pricing method `cost_plus`, but no markup, no elements and no cost tables. Risk: cost leak.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Package switch | feature toggles | config | grounded `P/lib/priceAdjustmentDefaults.ts` |
| Permissions | RBAC features | config | grounded `P/acl.ts` |
| Cost tables | `CpqPricingTable` + entries | partial | `purpose` column + guard |
| Cost indices | — | yes | new entities |
| Cost-plus charge | `CpqProductCharge` | partial | new pricing method + markup columns |
| Cost elements | applicability conditions | partial | new entity, reuses the condition grammar |
| Preview | calculate-price API | partial | cost-plus resolution + `priceOnRequest` |

### WF2: Quote with known costs (fixed / table / index)

**Journey:** rep adds a product → the engine instantiates the cost lines (R1) and resolves the costs → cost-plus list price (R2) → price rules → standard → manual adjustments (sibling) → offer → margin computed → the rep sees prices and cost status, the pricing manager sees margin → quote `ready` → accepted.

**ROI:**
- 0 manual price overrides for cost-plus products whose costs come from tables or indices (today 100% are typed in).
- Margin is visible on 100% of such quotes.

**Key personas:** sales rep, pricing manager.

**Boundaries:**
- Starts when: a line with a cost-plus charge or cost elements is configured.
- Ends when: the quote is accepted with stored prices, cost lines and margin.
- NOT this workflow: unknown costs (WF3), conversion (WF5).

**Edge cases:**
1. The rep changes a dimension (site, bandwidth) → table cost re-resolved on the saved recalculation → price changes → `pricing_changed` + `margin_changed`.
2. A table cost changes after the quote is sent (`with_customer`) → locked: the stored snapshot stands (R4).
3. The cost is in USD and the quote in EUR, with no rate → `CURRENCY_NO_RATE`, line not ready.
4. A manual discount is set on a cost-plus charge → offer below standard; margin may go negative → shown red to the pricing manager; approval is the project workflow's job (WF4).
5. Line quantity 5 with a `per_unit` cost → cost total = unit × charge quantity × 5; the margin per line is shown.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Charge resolution | `cpqPricingService` | partial | new list-price source |
| Price rules / manual adjustments | waterfall | no | grounded C3 |
| Aggregate lock, revision, events | `withQuotePricingWrite` | no | grounded C4 |
| FX | `currencies` `ExchangeRateService.getRate` | partial | grounded-elsewhere `CORE/currencies/services/exchangeRateService.ts:49-70` (falls back `maxDaysBack`; refuses future dates — rate date ≤ today; resolve optionally) |
| Cost lines, margin | — | yes | new tables |
| UI | quote detail page | partial | cost panel + margin card |

### WF3: Source an unknown cost (third-party tail)

**Journey:** rep adds "Internet access" at a site → the tail cost element (`on_request`, `requires_sourcing`) instantiates a cost line (`none`, or `estimated` from the catalog estimate) and auto-opens a cost request → `cpq.quote.cost_requested` → a project workflow creates a procurement `USER_TASK` (or calls a carrier API through `CALL_WEBHOOK`) → procurement obtains the carrier quote → answers through the **Cost requests** page (or the workflow calls the answer API) with the request id, amount, currency, supplier, supplier quote ref, validity and supplier term → the cost becomes `confirmed` → the line is ready → the quote is `ready` → the rep sends it.

**ROI:**
- 100% of tail requests are recorded with requested / answered timestamps, so median sourcing lead time per supplier becomes measurable (today requests go by email and are invisible).
- 0 orders on unconfirmed tails (I-6).
- Indicative quotes go out while sourcing runs (Q-D2).

**Key personas:** sales rep, procurement, project implementer (workflow).

**Boundaries:**
- Starts when: a cost line has `requires_sourcing` or the rep / pricing manager clicks **Request cost**.
- Ends when: every price-basis cost line of the quote line is `confirmed` — by a supplier answer, or after a decline by an alternative value on the same cost line (R10a) — or the quote line is removed.
- NOT this workflow: the carrier ordering after the sale, comparing bids (Q-D11), supplier portal.

**Edge cases:**
1. The rep changes bandwidth while the request is open → the request is `cancelled`, a new one opens (R1b); a late answer to the old one → `409 COST_REQUEST_SUPERSEDED`.
2. The carrier declines (no coverage) → `declined` + reason → the rep (notified) sees "No supplier can serve this site" and either removes the line, or the pricing manager enters another supplier's value on the same cost line (R10a).
3. The answer arrives after the quote was sent with an estimate and the value differs → recorded as `proposedAmount`; the guided "reopen" path applies (R7, R11).
4. No workflow is configured for `cost_requested` → requests sit in the Cost requests page; procurement works the queue manually. CPQ never depends on a workflow existing.
5. A confirmed tail expires before conversion → conversion refused (`COSTS_NOT_CONFIRMED`); procurement extends validity (lock-exempt) or re-requests.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Request event | `createModuleEvents` (non-broadcast) | partial | new events |
| Process | Workflows: event trigger, `USER_TASK`, `CALL_WEBHOOK`, `CALL_API` | config | docs-only `.ai/guides/core.workflows.md`; code read in `CORE/workflows` (another install) |
| Answer API | CPQ route style | yes | new route with request-id check |
| Queue page | `DataTable` | yes | new page |
| Conversion guard | `cpqOrderService.convert` | partial | grounded C7 |

### WF4: Review margin and add custom costs at quote review

**Journey:** quote is ready → pricing manager opens the quote → **Margin** card (contract margin, margin %, coverage, flags) and per-line cost panel → adds a custom cost (special-build fee, installation labour) or overrides a markup → saved recalculation → `cpq.quote.margin_changed` → a project approval workflow filters on `marginPercent` and routes approval through a `USER_TASK`; a project mutation guard can block the status change → approved → `with_customer`.

**ROI:**
- Margin-based approval set up per project with 0 CPQ code.
- ≥ 90% of accepted quotes with cost-plus charges have cost coverage ≥ 80% at acceptance (today: margin unknown, coverage 0%).

**Key personas:** pricing manager / deal desk, project implementer.

**Boundaries (WF4 is the review sub-flow of WF2, between quote `ready` and `with_customer`):**
- Starts when: a quote with at least one cost line reaches `ready` (or a pricing manager opens it earlier).
- Ends when: the quote moves to `with_customer` with a margin the project's approval rule accepted (or no rule exists).
- NOT this workflow: approval logic and thresholds (project), list price definition (WF1).

**Edge cases:**
1. A custom cost is added after the quote left `ready` → margin-only: allowed (R11); price-basis: refused while locked.
2. A markup override pushes the offer above what the customer saw → only while unlocked; the quote returns through `ready` (sibling lock).
3. Coverage is 40% → the margin card shows "based on 40% coverage"; the approval workflow can filter on `costCoverage`.
4. Two pricing managers edit → `409 STALE_REVISION` (C4).
5. A rep (default `cpq.costs.view`, no `cpq.costs.manage`) sees the cost lines and the Margin card read-only, and edit actions are not rendered. A custom role without `cpq.costs.view` sees cost status only (server-side guard).

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Margin event → approval | Workflows + mutation guards | config | guards grounded (`P/api/_helpers/quoteMutationGuard.ts:13-37`): `runCpqMutationGuards` on `api/quotes/[quoteId]/status` and `api/orders` (conversion); Workflows docs-only |
| Custom costs, markup override | — | yes | new API + dialogs |
| Margin card | quote page | yes | |

### WF5: Carry costs to order and subscription without billing impact

**Item margin:** per subscription item and month: item MRC amount − Σ open MRC item costs (× quantity); NRC margin recorded once at activation.

**Journey:** accepted quote → conversion (guard R7) → `CpqOrderLineCost` copies → (optional re-confirmation of value / validity before activation, Q-D13) → activation → one `CpqSubscriptionItemCost` per item cost (stable id) + an `activation` cost-history entry → `cpq.subscription.item_cost_changed (cause: activation)` → billing receives the unchanged payload (I-9) → the subscription page shows contracted cost, supplier, supplier term and margin.

**ROI:**
- 100% of activated cost-plus and costed items have their contracted cost recorded, so renewals start from the real supplier cost (WF6).
- Billing changes: 0.

**Key personas:** order manager, system.

**Boundaries:**
- Starts at conversion.
- Ends when: item costs exist for every costed item.
- NOT this workflow: billing; supplier ordering; index revaluation (Q-D9).

**Edge cases:**
1. Conversion is attempted with an expired tail → `422`; the order is not created.
2. Activation fails after the order commit → no item costs; the existing activation retry recreates them idempotently (unique `(subscription_item_id, cost_key, effective_from)`).
3. Activation event lost → item costs are written in the same transaction as the items (not by a subscriber), so nothing is lost.
4. Re-confirmed tail on the order with a different value → margin only; the price is fixed by the order.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Conversion / activation copy | `cpqOrderService` | partial | grounded C7 |
| Billing | connector | no | grounded C7, unchanged |
| UI | order / subscription detail | partial | cost tab |

### WF6: Renegotiate costs through Amend / Renew; close them on Cancel

**Journey (amend):** Amend quote → mirror lines carry item costs (`carried`, hashed) → procurement records the renegotiated supplier price on the carried cost (margin only — price lock) → optionally **Re-price from cost** → activation (stale-hash guard I-12) → the same item cost updated in place from E, plus an `amend` cost-history entry linked to the Amend order → `item_cost_changed (amend)`; billing changes only if the price changed (existing modify path).
**Journey (renew):** Renew quote → re-priced at today's standard; carried costs kept; costs with validity or supplier term ending before the new term end become `estimated` (renegotiation due) → cost request → answer / "keep current cost" → conversion → activation → item costs re-dated.
**Journey (cancel):** Cancel quote shows supplier early-exit exposure → activation ends item costs (`cancel` entries in Cost History).

**ROI:**
- 100% of renewals of costed items show the previous supplier cost and term (today unknown).
- 100% of supplier price changes are recorded with an effective date within the month they take effect (today none are recorded), so subscription margin reflects actual supplier cost.

**Cost-only Amend (Q-D12):** an internal change — no customer document; the operator moves it `ready` → `accepted` directly (status transitions are operator-driven, C9).

**Key personas:** ARC operator (sales rep), procurement, pricing manager.

**Boundaries:**
- Starts when: an ARC quote mirrors a costed item.
- Ends when: item costs match the activated ARC.
- NOT this workflow: supplier termination execution, early-termination charges (Q-D10), merge-renew (sibling U14).

**Edge cases:**
1. Another ARC on the same subscription activates first → `409 COST_SOURCE_CHANGED`; the operator refreshes the mirror.
2. A Renew of a cost-plus item whose tail must be re-sourced → the quote is indicative until confirmed; conversion is blocked (R7).
3. The supplier changes price with no customer change (Q-D12) → a cost-only Amend: `modify` change, no billing event change.
4. Re-price from cost on a frozen line → the line becomes re-priced (existing `_arcRepriced`); the new price reaches billing through the sibling `modifiedItems` path.
5. Toggle turned off while a Renew of a cost-plus item is open → `COST_PLUS_DISABLED` (R14).

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Mirror, frozen lines, re-price | ARC services | partial | grounded C8 |
| Carried hash guard | — (sibling carry-over planned, not built) | yes | grounded absent |
| Activation write-back | `cpqInventoryService` modify | partial | grounded C8 |
| Cancel exposure | Cancel quote page | yes | |

#### Checklist (per workflow)
- [x] End-to-end journey `PM`
- [x] Measurable ROI `PM`
- [x] Boundaries `PM`
- [x] 3–5 edge cases `PM`
- [x] Every step mapped `Architect`

#### Checklist (overall)
- [x] 3–7 core workflows defined (6) `PM`
- [x] > 200-line workflows re-checked: no platform capability prices CPQ charges or stores supplier costs. Catalog price kinds were rejected (§1.4.9). Workflows cover the sourcing process (WF3) and approvals (WF4), so CPQ ships no process engine. `Architect`

### Production reality check

| Workflow | Could a client run their business on this today (after its phase)? |
|---|---|
| WF1 | Yes after Phase 1 for `fixed` / `table` costs; `index` after Phase 4. |
| WF2 | Yes after Phase 1 for fixed / table costs in the quote currency; foreign-currency costs after Phase 2. |
| WF3 | Yes after Phase 2. **Phase 1 workaround:** an `on_request` cost can be entered by the pricing manager as a manual value (`estimated` / `confirmed`) — sourcing is off-system but the quote prices and converts correctly. No queue, no events, no request ids. |
| WF4 | Yes after Phase 1 (margin card, custom costs, `margin_changed`). |
| WF5 | Yes after Phase 1 (copy to order and subscription; billing unchanged). |
| WF6 | Yes after Phase 3. **Phase 1–2 workaround:** ARC mirror lines of costed items carry no costs to the quote; Renew mirror lines with a cost-plus charge are **frozen at the contracted price** (like Amend) and show the banner "Costs are not carried to change quotes yet". A **minimal activation write-back** keeps item costs truthful: cancelled / removed items end their costs (`status = ended`, `cancel` history entry); a re-priced (reconfigured) mirror line updates the item's costs in place from its own order line costs (same ids, matched by `cost_key`; new keys create rows, missing keys end), with history entries; untouched mirrors leave item costs as they are. No wrong price, no stale cost. |

---

## 3.5 UI Architecture `PM + UX`

### Navigation (per role)

| Role | Sidebar groups | Notes |
|------|---------------|-------|
| Sales rep | CPQ → Quotes, Orders, Subscriptions (unchanged) | |
| Procurement | CPQ → **Cost requests** (new, top of the group for this role) | needs `cpq.costs.manage` |
| Pricing manager | CPQ → Quotes, Cost requests | |
| Pricing admin | CPQ → Offerings, Pricing tables (with the purpose filter), **Cost indices** (new) | `cpq.pricing.manage`; cost tables need `cpq.costs.view` |

### Dashboard Widgets

None in this scope. The Cost requests page, sorted by age, is procurement's "what to do now".

### Custom Pages

| Page | URL pattern | Role | Purpose | Building block |
|------|------------|------|---------|----------------|
| Cost requests (list) | `/backend/cpq/cost-requests` | procurement, pricing manager | Open requests across quotes: quote no., customer, product, cost name, site / key attributes, requested at, age, supplier, sourcing status; filters: status, supplier, age > N days | standard table (`DataTable`, paginated) |
| Cost requests — row expansion + dialogs (no detail page: a cost request is a state of a cost line, not an entity; the line's home is the quote detail) | on `/backend/cpq/cost-requests` | procurement (`cpq.costs.view` + `cpq.costs.manage`) | Row expansion: line configuration, previous values, request history (every `cost_request_id`). **Answer** dialog (amount, currency, supplier, supplier quote ref, valid until, supplier term), **Decline** dialog (reason), link to the quote | standard table + dialogs |
| Cost indices (list / detail) | `/backend/cpq/cost-indices`, `/[id]` | pricing admin | Index master data + values table (date, value, revision, note) + **Add value**; values are append-only | standard table + form |
| Quote detail (changes) | `/backend/cpq/quotes/[id]` | rep, pricing manager | Per line: cost status badges (all users); **Costs** sub-panel under the charges (cost holders): cost lines (name, role, source, status, value, currency, supplier, valid until), actions **Request cost**, **Add custom cost**, **Edit / Confirm**, **Override markup**, **Re-price from cost** (ARC). Summary: **Margin** card. Badges: "Indicative", "Cost pending", "Expired cost", "Supplier answered different cost — reopen". | existing page + dialogs |
| Offering / specification charge editor (changes; cost elements are a child entity of the charge with dialog editing and no standalone page — the same exception as `CpqQuotePriceAdjustment` in the sibling spec) | `/backend/cpq/offerings/[id]`, `/backend/cpq/specifications/[id]` | pricing admin | Pricing method `Cost-plus` + markup fields; **Cost elements** sub-table + dialog | existing pages + dialog |
| Pricing table detail (changes) | `/backend/cpq/pricing/[id]` | pricing admin | `purpose` selector (immutable once referenced) | existing |
| Order detail (changes) | `/backend/cpq/orders/[id]` + `order-cpq-tab` | order manager (`cpq.costs.view`; Re-confirm needs `cpq.costs.manage`) | Read-only costs + margin; **Re-confirm** before activation (Q-D13); server-side gated | existing |
| Subscription detail (changes) | `/backend/cpq/inventory/subscriptions/[id]` | `cpq.costs.view` holders (reps read-only, pricing manager, procurement, ops) | Per item: current cost, supplier, supplier term, item margin. A **Cost History** section modelled on the existing Change History (`page.tsx:754-790`): one row per `CpqSubscriptionItemCostChange` with change type, effective date, Quote / Order links, item and cost name, and before → after value / supplier / validity; filterable per item. Not rendered, and API `403`, without `cpq.costs.view` | existing |
| ARC line diff (changes) | `ArcLineDiff` | ARC operator | Previous vs new cost and margin (cost holders) | existing component |

All dialogs: `Cmd/Ctrl+Enter` submit, `Esc` cancel; `409` → "Quote changed, reload".

### Widget Injections

| Widget | Injects into | Injection spot | Data |
|--------|-------------|---------------|------|
| none new | — | — | Costs render inside CPQ's own pages; `order-cpq-tab` (existing CPQ widget) gains the cost section |

### Key User Flows

| Persona | Task | Flow (login → done) | Clicks | Notes |
|---------|------|---------------------|--------|-------|
| Procurement | Answer a tail request | CPQ → Cost requests → row **Answer** → Save | 2 to dialog | |
| Pricing manager | Check margin, add a custom cost | CPQ → Quotes → quote (Margin card) → Costs sub-panel **Add cost** (line pre-selected) | 3 to dialog | |
| Sales rep | Request a cost | CPQ → Quotes → quote → line ⋯ → Request cost | 3 | usually automatic |
| Pricing admin | Make a charge cost-plus | CPQ → Offerings → offering → charge row **Edit** (dialog with pricing method) | 3 to dialog | |
| Pricing admin | Add an oil price value | CPQ → Cost indices → index → Add value | 3 | |

### Empty States

| Page/Widget | Empty state message | Action |
|-------------|-------------------|--------|
| Cost requests | "No open cost requests. Requests appear here when a quote needs a supplier price." | link to Quotes |
| Costs sub-panel | "No costs on this line. Margin is not tracked for it." | Add custom cost (cost managers) |
| Margin card | "No costs recorded — margin unknown (0% coverage)." | — |
| Cost elements sub-table | "This charge has no costs. Add one to track margin or price it cost-plus." | Add cost element |
| Cost indices | "No cost indices. Create one for costs that follow a market price." | Create index |

#### Checklist
- [x] Every persona has a defined login-to-primary-task flow `PM`
- [x] Navigation grouping matches how users think about their work `UX`
- [x] Dashboard widgets — none; the queue page answers "what next" `UX`
- [x] Empty states are helpful `UX`
- [x] Platform building blocks; custom UI only on existing CPQ pages `Architect`
- [x] ≤ 3 clicks login → primary task `UX`

---

## 4. Workflow Gap Analysis `Architect`

Atomic commits. Scope `app` = `packages/cpq` (L2), `demo` = `src/modules/demo_*`. Evidence: `grounded` = repo source; `docs-only` = `.ai/guides` / another install's framework source.

#### WF1: Define cost-plus offers and the cost catalog — Total: 9

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Toggle `cpq.cost_plus` + ACL `cpq.costs.view` / `.manage` + role defaults | feature toggles, RBAC | 1 | app | 1 | 1 | grounded |
| `CpqProductCharge` cost-plus columns, validators, migration, markup guard in responses | charge entity | 2 | app | 1 | 1 | grounded C1 |
| `CpqPricingTable.purpose` + cost-table read guard | pricing tables | 2 | app | 1 | 1 | grounded C2 |
| `CpqChargeCostElement` entity, validators, API (`openApi`) | — | 3 | app | 1 | 1 | |
| Charge editor: cost-plus fields + cost elements sub-table / dialog | offering / spec pages | 2 | app | 1 | 1 | |
| Calculate-price: cost-plus resolution, `priceOnRequest`, `indicative` | calculate-price | 2 | app | 1 | 1 | grounded `api/` + manual `xd-187-calculate-price-api.md` |
| `CpqCostIndex` + values entities, API, import | — | 3 | app | 1 | 4 | |
| Cost indices pages (list + detail) | DataTable / CrudForm | 2 | app | 1 | 4 | |
| Demo seed (GIX: cross-connect cost table; Puffin: none) | seeds | 1 | demo | 1 | 1 | grounded `xd-276` |

#### WF2: Quote with known costs — Total: 10

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| `CpqQuoteLineCost` entity + migration + instantiation (R1) | — | 3 | app | 1 | 1 | |
| Engine: refactor the table lookup (`calculateFlat` / `PerUnit` / `Tiered` / `Volume`, today bound to `CpqProductCharge`, `cpqPricingService.ts:248-322`) into a table + column + model + dimensions lookup; cost resolution (fixed / table); cost-plus list price (R2), `NO_PRICE_BASIS_COST`, `COST_PENDING` | `cpqPricingService` | 3 | app | 2 | 1 | grounded C3 |
| `computeQuoteMargin()` (R8) incl. bundle roll-up + `margin_hash` | — | 2 | app | 1 | 1 | computed, not stored (architect #1) |
| Cost-guarded read API (cost lines, margin) | CPQ route style | 2 | app | 1 | 1 | |
| Quote page: cost status badges, Costs sub-panel, Margin card | quote detail | 2 | app | 2 | 1 | |
| Clone (R16) + toggle-off behaviour (R14) | clone service | 1 | app | 1 | 1 | grounded |
| FX conversion with a dated rate snapshot (R3 / R4) | currencies `ExchangeRateService` | 2 | app | 1 | 2 | grounded-elsewhere (architect #1) |
| Engine: `index` cost source + snapshot (R4) + Renew re-evaluation | — | 2 | app | 1 | 4 | |

#### WF3: Source an unknown cost — Total: 8

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Manual value entry on `on_request` lines (Phase 1 workaround) | — | 1 | app | 0 | 1 | covered by the WF4 edit API |
| Conversion guard (R7) | conversion | 1 | app | 1 | 1 | grounded |
| Sourcing fields, request / answer / decline / cancel API with request ids (I-13), locked-answer `proposedAmount` (R11) | — | 3 | app | 2 | 2 | |
| Events `cost_requested` / `cost_request_cancelled` / `cost_valued` | `createModuleEvents` | 1 | app | 1 | 2 | grounded |
| Cost requests page (list, row expansion, Answer / Decline dialogs) | DataTable / dialogs | 2 | app | 1 | 2 | workflows' own task inbox covers the projects that configure a workflow (architect #1) |
| Notifications: request opened → cost managers; answered / declined → quote owner | `notifications.ts` | 1 | app | 1 | 2 | catalog: notifications (docs-only) |
| Sourcing workflow recipe (event trigger → `USER_TASK` → `CALL_API` answer), seeded for demos | Workflows | 1 | demo | 1 | 2 | docs-only |
| `cost_expiring` scheduled check | `SchedulerService` | 2 | app | 1 | 4 | grounded-elsewhere `@open-mercato/scheduler/src/index.ts:7-15` |

#### WF4: Review margin, custom costs — Total: 5

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Write API: manual costs, edit / confirm values, markup override, R10a, lock rules + exemptions + evidence (R11) | `withQuotePricingWrite` | 3 | app | 2 | 1 | grounded C4; re-estimated by architect #2 |
| Confidential commands: cost commands' audit `snapshotBefore` / `snapshotAfter` and undo payloads carry ids + statuses only (no amounts, suppliers, markup); cost entities stay out of `ce.ts` and search | command pattern (`registerCommand`) | 2 | app | 1 | 1 | grounded `P/commands/price-adjustments.ts:2-5, 44-47` |
| Dialogs (add / edit cost, override markup) | dialogs | 2 | app | 1 | 1 | |
| `margin_changed` event + `status_changed` flags + approval recipe in the manual | events, Workflows | 1 | app | 1 | 1 | Workflows docs-only |

#### WF5: Carry costs to order and subscription — Total: 5

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| `CpqOrderLineCost` + conversion copy (same transaction) | conversion | 2 | app | 1 | 1 | grounded C7; restored by user decision 2026-11-12 (supersedes architect #1) |
| `CpqSubscriptionItemCost` (stable id) + `CpqSubscriptionItemCostChange` + activation write (same transaction) + `item_cost_changed` | activation; pattern `CpqSubscriptionChangeLog` | 3 | app | 2 | 1 | grounded C7, `entities.ts:1387` |
| Order + subscription UI: order costs; item costs; Cost History section (modelled on Change History) | existing pages | 2 | app | 1 | 1 | grounded `inventory/subscriptions/[id]/page.tsx:754-790` |
| Order re-confirmation (Q-D13) | — | 1 | app | 1 | 3 | deferred from Phase 2 (architect #2) |

#### WF6: Renegotiate costs through ARC — Total: 8

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Phase 1 safety: Renew mirror lines with cost-plus charges frozen + banner | `arcPriceFreeze` | 1 | app | 1 | 1 | grounded C8 |
| Phase 1 safety: minimal ARC write-back (end on cancel / removal; in-place update on re-priced mirror, with history) | activation write-back | 2 | app | 1 | 1 | grounded C8 |
| Item-cost state hash + activation refusal `COST_SOURCE_CHANGED` (I-12) — **new code**: the sibling carried-adjustment pattern is not built yet (architect #1); built here as a shared helper the sibling's carry-over can reuse | — | 3 | app | 1 | 3 | grounded: absent (`P/data/entities.ts:1489-1560` has no `carried_from_*`) |
| Mirror carried costs, skip catalog instantiation (R1c) | mirror service | 2 | app | 1 | 3 | grounded C8 |
| Price lock + **Re-price from cost** action | `arcPriceFreeze` | 2 | app | 1 | 3 | grounded |
| Renew renegotiation due + cancel exposure | — | 2 | app | 1 | 3 | |
| ARC activation: update item costs in place + cost-history entries linked to the ARC change log, merge re-pointing, `item_cost_changed`, cost-only modify | activation write-back | 2 | app | 1 | 3 | grounded C8 |
| `ArcLineDiff` costs + banners | existing component | 1 | app | 1 | 3 | |

### Gap Summary

| Workflow | Business Priority | Atomic Commits (raw) | Workaround? | Commits (effective) | Blocks ROI? |
|----------|------------------|---------------------|-------------|---------------------|-------------|
| WF1 | high | 9 | indices later | 7 in Phase 1 | no |
| WF2 | high | 10 | FX, index later | 8 in Phase 1 | no |
| WF3 | high (case 1) | 8 | manual entry in Phase 1 | 1 in Phase 1 | sourcing ROI from Phase 2 |
| WF4 | high | 5 | — | 5 | no |
| WF5 | high | 5 | re-confirmation Phase 3 | 4 in Phase 1 | no |
| WF6 | medium | 8 | frozen Renew mirrors + minimal write-back | 2 in Phase 1 | renegotiation ROI from Phase 3 |

**Total: 45 atomic commits** — Phase 1: 27 (user decision 2026-11-12: order costs and cost history +2), Phase 2: 7, Phase 3: 7, Phase 4: 4 (architect checkpoint #2: +1 write API, re-confirmation moved to Phase 3. After architect checkpoint #1: −1 order copy table, −1 detail page, +1 notifications, +1 confidential commands, +1 Phase 1 ARC write-back, +1 hash helper not yet built; +1 index engine row made explicit). Commit plans: `app-spec-notes/cost-plus-commits-WF.md`.

#### Checklist
- [x] Every workflow step scored in atomic commits `PM`
- [x] Architect checkpoint #1 — re-mapped (see `app-spec-notes/cost-plus-architect-checkpoint-1.md`) `Architect`

---

## 4.5 Module Architecture `Architect`

### Platform capabilities used

| Capability | Usage | Extension points used | Notes |
|-----------|-------|----------------------|-------|
| `feature_toggles` | as-is | per-tenant override | `cpq.cost_plus` |
| RBAC (`acl.ts`, `setup.ts`) | as-is | feature ids | `cpq.costs.view`, `cpq.costs.manage` |
| `currencies` | as-is | exchange-rate read (DI) | Phase 2, docs-only |
| `customers` companies | as-is | FK string only | supplier reference |
| `workflows` | as-is (project config) | event triggers, `USER_TASK`, `CALL_API` | sourcing + approval recipes |
| events (`createModuleEvents`) | extend | new non-broadcast events | |
| scheduler | as-is | registered command | Phase 4 `cost_expiring` (docs-only) |

### Shared modules (existing or proposed)

| Module | Status | Usage | Extension points | Rationale |
|--------|--------|-------|-----------------|-----------|
| `@dainamite/cpq` | EXISTING | extend | own entities, services, pages | Cost-plus is CPQ pricing; one domain = one package (SPEC-001). |
| `@dainamite/cpq-billing-connector` | EXISTING | unchanged | — | I-9: no billing impact. |
| `@dainamite/billing` | EXISTING | unchanged | — | |

### App modules

| Module | Responsibility | Entities owned | Notes |
|--------|---------------|----------------|-------|
| `demo_gix` | GIX seed: a cross-connect cost table, a cost-plus "IP Transit with partner tail" charge (`on_request`), demo quotes in all cost states | — | seeds only |
| `demo_puffin` | No cost-plus seed; verifies R15 (the public calculator shows "Contact sales" for on-request charges if any are added) | — | |

#### Checklist
- [x] Every capability listed with usage and extension points `Architect`
- [x] Every capability traces to a workflow `Architect`
- [x] Shared modules listed `Architect`
- [x] No `platform`-scoped gaps → no upstream investigation needed `Architect`
- [x] Reusability: cost-plus belongs in L2 `@dainamite/cpq` (2+ operators: telco tails, cloud resale) `Architect`
- [x] Boundaries: no cross-module ORM relations; supplier / currency by id `Architect`
- [x] App modules: seeds only `Architect`
- [x] No platform code modified `PM + Architect`
- [x] Bounded context: costs share the quote aggregate's invariants (I-5) → same module `DDD`

---

## 5. User Stories `PM`

**Common failure block (CF)** — applies to every write story below and is not repeated:
- `409 STALE_REVISION`: another user saved first → "Quote changed, reload"; nothing is stored.
- `403`: missing feature → the action is not rendered; the API refuses; no state change.
- Toggle off → cost endpoints `404`, cost UI hidden (R14) — except the answer API (`409 COST_PLUS_DISABLED`, retryable) and the usage endpoint (always reachable for `cpq.costs.view`).
- Navigating away from or cancelling a dialog stores nothing.

The surface named in each story exists in §3.5. All personas are internal (§2).

### WF1: Define cost-plus offers and the cost catalog

**US-1.1** As a pricing admin, I set a charge's pricing method to **Cost-plus** with a markup rule, so that its list price is computed as cost + markup instead of typed.
Identity: pricing admin, `cpq.pricing.manage` + `cpq.costs.view`, offering / specification charge editor.
Success: the charge saves with `pricing_method = cost_plus`, `markup_rule` and `markup_value`; the cost preview (`cpq.costs.view`) shows the cost breakdown and list price; calculate-price returns the list price only (R15).
**Happy path:** choose Cost-plus → markup rule and value → add ≥ 1 price-basis cost element (US-1.2) → save → the preview shows the list price.
**Alternate paths:** switching a `fixed` charge to cost-plus keeps `fixed_price` as the fallback indicative price; switching back to `fixed` / `table` deactivates the charge's price-basis elements in the same save, after a confirmation showing how many open quotes use them; unlocked quotes re-price from the new method on their next saved recalculation, locked quotes keep their stored prices.
**Failure paths:** no price-basis element → `422 NO_PRICE_BASIS_ELEMENT`, nothing saved; target margin ≥ 100 → inline error; `per_unit` without a quantity attribute → inline error; usage charge → Cost-plus is not offered.

**US-1.2** As a pricing admin, I attach cost elements (fixed, cost table, on request, index) to a charge, with a role and an optional default supplier, so that every quote line gets its default costs.
Identity: pricing admin, charge editor → Cost elements sub-table.
Success: the elements are listed with code, name, role, source, cost model, value / table / estimate and supplier; a new quote line instantiates them (US-2.1).
**Happy path:** Add cost element → source `table` → pick a cost table and column → role `price_basis` → save.
**Alternate paths:** `margin_only` on a `fixed`-priced charge (cost tracking without cost-plus); `on_request` with an estimate and `requires_sourcing`; an applicability condition (only for bandwidth ≥ 1 Gb/s).
**Failure paths:**
- a duplicate `code` → `422`;
- `price_basis` on a non-cost-plus charge → `422`;
- a price table picked as cost source → `422 WRONG_TABLE_PURPOSE`;
- `cost_type` ≠ charge type for `price_basis` → `422`;
- deactivating the last active price-basis element of a cost-plus charge → refused;
- deactivating an element used on open quotes → confirmation dialog "N open quotes will drop this cost on their next recalculation" → on confirm, soft-deactivated; locked quotes keep their stored lines.

**US-1.3** As a pricing admin, I maintain a **cost table** (purpose = cost), so that supplier rates are looked up instead of typed.
Identity: pricing admin, Pricing tables page with the purpose filter.
Success: a cost table is readable only by `cpq.costs.view` holders; its entries resolve in quotes (US-2.1).
**Happy path:** create a table → purpose Cost → dimensions (site tier, bandwidth) → cost column → entries → save.
**Alternate paths:** a CSV import of entries uses the existing pricing-table entry API.
**Failure paths:** changing `purpose` on a table referenced by any charge or element → `422 PURPOSE_LOCKED`; a user without `cpq.costs.view` → the table is absent from the list, and `404` on direct URL.

**US-1.4** (Phase 4) As a pricing admin, I maintain a **cost index** (e.g. Brent, USD/bbl) and add dated values, so that index-linked costs follow the market at quoting time.
Identity: pricing admin, Cost indices pages.
Success: values are append-only; the value in force on a date is deterministic (highest revision at the latest date ≤ the date).
**Happy path:** Cost indices → Brent → Add value (date, value, note) → save → the next saved recalculation of an unlocked quote uses it.
**Alternate paths:**
- on a quote: the index cost line shows its snapshot (value, date, revision); a newer value moves the price only on the next saved recalculation while unlocked (R4);
- a correction for an existing date → new revision (server-assigned);
- a future-dated value → stored, unused before its date;
- bulk values via the import API.
**Failure paths:** value ≤ 0 → `422`; a quote-date with no value at or before it → cost line `INDEX_NO_VALUE`, line not ready; deleting an index referenced by elements → refused; deactivating it while active elements reference it → refused ("re-point the elements first").

**US-1.5** As a storefront / API consumer (Puffin calculator), I price an offer with a cost-plus charge without seeing any cost, so that public prices stay correct and costs stay private.
Identity: anonymous API proxy (existing calculator) — no new surface.
Success: the response contains a list price or `priceOnRequest: true` / `indicative: true`, and never a cost or markup field (R15, I-4).
**Happy path:** table-costed charge → list price returned.
**Alternate paths:** `on_request` with an estimate → `indicative: true` + price; the Puffin UI labels it "from".
**Failure paths:** `on_request` without an estimate → `priceOnRequest: true`, no price → "Contact sales"; toggle off → the charge is reported as `priceOnRequest: true` (never a stale price).

**US-1.6** As a tenant admin, I switch cost-plus on or off for my tenant, so that only operators who use it see it.
Identity: tenant admin, feature toggles page (platform).
Success: on → cost UI and APIs appear; off → they disappear and stored data is untouched (R14).
**Happy path:** enable the `cpq.cost_plus` override → reload → the Cost-plus pricing method and the cost panels appear (the Cost requests menu appears from Phase 2).
**Alternate paths:** off with existing cost-plus quotes → prices still shown; re-pricing returns `COST_PLUS_DISABLED`. Switched on for a tenant with existing quotes and subscriptions → no backfill: existing lines get cost lines on their next saved recalculation, live items get costs at their next ARC (Renew reconciliation, R1c).
**Failure paths:** off while a Renew of a cost-plus item is open → the Renew lines are not ready with "Cost-plus is disabled for this tenant"; no data loss.

### WF2: Quote with known costs

**US-2.1** As a sales rep, I add a product whose charges have cost elements, so that its price is computed from the catalog costs and markup, with 0 manual overrides.
Identity: sales rep, Quote detail.
Success: one cost line per applicable element (R1); cost-plus charges carry list = markup(cost) (R2); the waterfall continues unchanged; the line is ready when all price-basis costs are known.
**Happy path:** add "Cross-connect 10G" → the table cost resolves → list price shown → quote `ready`.
**Alternate paths:**
- a mix of a cost-plus charge (MRC) and a fixed-price charge (NRC install) on one line, both priced;
- a bundle child with costs → the parent shows the roll-up margin to cost holders.
**Failure paths:**
- table miss → line not ready, badge "Cost not found (table)", `TABLE_NO_MATCH`;
- no applicable price-basis element → `NO_PRICE_BASIS_COST`;
- an `on_request` cost without value → `COST_PENDING`, the price shown as "≈ fallback" or "Price on request".

The quote cannot reach `ready` in any of these failure cases.

**US-2.2** As a sales rep, I change a line's configuration (site, bandwidth, quantity), so that costs and price follow the new configuration.
Identity: sales rep, Quote detail / configurator.
Success: R1a / R1b applied on the saved recalculation; `pricing_changed` / `margin_changed` emitted once per save.
**Happy path:** bandwidth 1G → 10G → the table cost re-resolves → the price updates.
**Alternate paths:** a quantity change only → the costs are kept and the totals scale.
**Failure paths:**
- the quote is locked → the edit is refused (sibling R7);
- an `on_request` value is reset by R1b → the line goes back to not ready, the previous value is shown in the note, and (from Phase 2) an open request is cancelled (`cost_request_cancelled`).

**US-2.3** As a pricing manager, I see each line's costs and the quote's margin, so that I know what the deal earns.
Identity: pricing manager, `cpq.costs.view`, Quote detail → Costs sub-panel + Margin card.
Success: NRC / MRC cost, margin, margin %, markup %, contract margin, coverage and flags match R8 for every line, bundle roll-up and the quote.
**Happy path:** open the quote → the Margin card shows "Contract margin 18.4% (coverage 100%)".
**Alternate paths:** partial coverage → "based on 60% coverage"; an indicative quote → "Indicative — 1 cost estimated".
**Failure paths:** a rep without `cpq.costs.view` → the Margin card and values are not rendered and the cost API returns `403`; only the status badges are visible.

**US-2.4** (Phase 2) As a pricing manager, I enter a supplier cost in USD on a EUR quote, so that foreign-currency tails price correctly.
Identity: pricing manager / procurement, Edit cost dialog or answer form.
Success: `fx_rate` and `fx_rate_date` are stored from `currencies` for the saved recalculation date; the price uses the converted amount; the snapshot freezes with the lock (R4).
**Happy path:** 300 USD → rate 0.92 on 2026-11-11 → 276 EUR cost → markup → price.
**Alternate paths:** a later saved recalculation while unlocked refreshes the rate (and the price) to that day.
**Failure paths:** no rate for the date → `CURRENCY_NO_RATE`, line not ready, message "No USD→EUR rate for 2026-11-11"; the value is still stored.

**US-2.5** As a sales rep, I clone a quote with costs, so that a variant starts from the same costing.
Identity: sales rep, Quote detail → Clone (existing).
Success: R16 applied.
**Happy path:** clone → catalog costs re-resolve, manual and supplier values are kept, markup overrides are copied.
**Alternate paths:** a cloned expired supplier answer shows "Expired" and blocks conversion until re-confirmed.
**Failure paths:** open requests are not copied → the clone's `on_request` lines without a value are not ready and show **Enter cost** (Phase 1) / **Request cost** (from Phase 2).

### WF3: Source an unknown cost

**US-3.1** (Phase 2) As a sales rep, I get a supplier price requested automatically when I add a product with an on-request cost (or I request it manually), so that sourcing starts without email.
Identity: sales rep, Quote detail (badge "Cost requested").
Success: the request opens with a `cost_request_id`; `cost_requested` is emitted after commit, with the configuration attributes named by the element.
**Happy path:** add Internet at a site → badge "Cost requested" → the procurement task is created by the project workflow.
**Alternate paths:**
- an estimate exists → the line prices indicatively while requested;
- a manual **Request cost** on a `margin_only` cost;
- **Re-request** → the previous open request is cancelled and `request_seq` + 1.
**Failure paths:**
- requests open only on a **saved** recalculation, never on configurator previews; one cost line has at most one open request, so repeated reconfiguration or bulk-adding N sites yields at most N open requests, never duplicates;
- a workflow `CALL_WEBHOOK` timeout leaves the request `requested` → shown as **Overdue** after N days (queue filter) → procurement re-requests or answers by hand;
- no workflow is configured → the request still appears on the Cost requests page (WF3 edge 4);
- event delivery fails → the stored request is authoritative and listed in the queue; the project workflow can be re-triggered by re-request.

**US-3.2** (Phase 2) As procurement, I answer a cost request with the supplier's price, so that the quote can be priced firmly.
Identity: procurement, `cpq.costs.view` + `cpq.costs.manage`, Cost requests page → Answer dialog (or a workflow calling the answer API).
Success: I-13 is enforced; the value becomes `confirmed` with origin `supplier`; `cost_valued` is emitted (no amount); `answered_at − requested_at` is stored.
**Happy path:** Cost requests → row **Answer** (amount, currency, supplier, quote ref, valid until, supplier term) → save → the quote line is ready; the quote owner is notified.
**Alternate paths:**
- answer as `estimated` (budgetary) → the line prices indicatively and the request stays `answered`;
- many answers at once → one API call per cost line (a CSV import is out of scope);
- a repeated answer with the same supplier quote ref → no-op `200`.
**Failure paths:**
- stale request id → `409 COST_REQUEST_SUPERSEDED`, "This request was replaced — open the current one";
- `valid_until` in the past → `422`;
- an unknown currency → `422`;
- the quote is cancelled / rejected → its requests were already cancelled at close (US-3.7) → `409 QUOTE_CLOSED`, nothing written.

**US-3.3** (Phase 2) As procurement, I decline a request when no supplier can serve it, so that the quote owner is notified ("Cost declined") within the same minute.
Identity: procurement, Cost requests page → Decline dialog.
Success: `sourcing_status = declined` with a reason; the value status goes to `none` (a catalog estimate is discarded into the note), so the line is not ready and the quote cannot be sent as indicative; `cost_valued` emitted; the quote owner gets the "Cost declined" notification.
**Happy path:** Decline → reason "No coverage at site" → save.
**Alternate paths:** the pricing manager enters another supplier's value on the same cost line (R10a, US-4.2) → the line prices.
**Failure paths:** declining an already answered request → `409`; a decline without a reason → inline error.

**US-3.4** (Phase 2) As procurement, I answer after the quote was sent with an estimate, so that the firm cost is recorded even when it differs.
Identity: procurement → pricing manager, Cost requests page → Quote detail.
Success: R11 / R7: the same value → `confirmed` (lock-exempt); a different value → stored as `proposedAmount`, the badge "Supplier answered with a different cost" with the action **Reopen and apply supplier answer** appears, and the price is unchanged.
**Happy path (same value):** answer 276 → confirmed → conversion unblocked.
**Alternate path (different value):** the pricing manager clicks **Reopen and apply supplier answer** (one action name everywhere) → the quote goes back to `ready` → the value is applied → the price changes → `pricing_changed` → re-send.
**Failure paths:** the quote already has an order → Phase 2: `409 QUOTE_CONVERTED`, nothing written (conversion already required confirmed price-basis costs, so this is rare); from Phase 3 the answer is applied as a post-conversion re-confirmation (Q-D13, US-5.2): margin only, never price.

**US-3.5** As an order manager, I am stopped from converting a quote with unconfirmed or expired price-basis costs, so that no order is priced on a guess.
Identity: order manager / rep, Quote detail → Convert.
Success: `422 COSTS_NOT_CONFIRMED`, listing the lines and costs; no order is created (I-6).
**Happy path:** all confirmed → conversion proceeds (US-5.1).
**Alternate paths:** only margin-only costs are unconfirmed → conversion proceeds.
**Failure paths:** expired on the conversion date → refused, with "extend validity or re-request"; an unapplied different supplier answer → `422 COST_ANSWER_PENDING`; a concurrent confirmation during conversion → serialized by the aggregate lock.

**US-3.7** (Phase 2) As procurement, I stop seeing requests for quotes that are closed or lines that are gone, so that I never source a dead deal.
Identity: procurement, Cost requests page.
Success: a terminal quote status (rejected, cancelled, expired), quote deletion, line removal or element deactivation cancels every open request in the same transaction (`cost_request_cancelled`, reason per §1.4.9); the project workflow closes its task on that event.
**Happy path:** the rep rejects the quote → its 3 open requests disappear from the queue.
**Alternate paths:** an abandoned draft (no status change) keeps its requests; they show as **Overdue** after N days (queue filter) and procurement may decline them with reason "quote inactive".
**Failure paths:** the event is lost → the queue (stored state) already hides them; the workflow task stays open until its own timer → the answer API returns `409 QUOTE_CLOSED` with no write.

**US-3.6** (Phase 4) As procurement, I am warned N days before a confirmed cost on an open quote expires, so that I re-source in time.
Identity: procurement, notification `cpq.cost.expiring` (new type, Phase 4) linking to the quote's Costs sub-panel.
Success: `cost_expiring` is emitted once per cost line and `valid_until` (idempotent scheduled job).
**Happy path:** the job runs daily → the event → the project workflow notifies procurement.
**Alternate paths:** validity extended → no further event for the old date.
**Failure paths:** the job misses a day → the next run catches every line with `valid_until − N ≤ today`; no duplicate events (dedupe key).

### WF4: Review margin and custom costs

**US-4.1** As a pricing manager, I add a custom cost to a line at quote review, so that special costs (carrier special build, extra labour) count.
Identity: pricing manager, `cpq.costs.manage`, Quote detail → Add custom cost.
Success: a `manual` cost line (role per R10); margin recomputed; `margin_changed` emitted; price changes only for price-basis on cost-plus charges.
**Happy path:** Add custom cost → "Special build" NRC 1 500, margin-only → save → margin drops.
**Alternate paths:**
- delete a manual cost (same lock rules; a price-basis delete re-prices);
- a price-basis custom cost on a cost-plus charge → the price rises;
- a line-level (no charge) margin-only cost;
- after the quote left `ready`, a margin-only custom cost is still allowed (R11).
**Failure paths:** price-basis on a locked quote → `409 COST_LOCKED`; price-basis on a fixed charge → `422`; missing name / amount → inline errors.

**US-4.2** As a pricing manager, I edit or confirm a cost value (including entering an on-request cost myself), so that the quote prices without a formal request.
Identity: pricing manager, Quote detail → Edit / Confirm cost.
Success: value, status and origin `manual`; overwriting a catalog / carried value requires a note; audit keeps the previous value.
**Happy path:** the tail is known from a carrier email → enter 280 EUR confirmed → the line is ready (the Phase 1 path for WF3).
**Alternate paths:**
- **Confirm** an estimate without a change → lock-exempt;
- extend `valid_until` → lock-exempt.
**Failure paths:**
- a price-basis value change while locked → `409 COST_LOCKED`, with the hint "move the quote back to Ready";
- a negative amount → `422`;
- (from Phase 2) an open request exists → saving cancels it (`cost_request_cancelled`) after a confirmation prompt.

**US-4.3** As a pricing manager, I override the markup of a cost-plus charge on one quote, so that risky or strategic deals carry a different markup.
Identity: pricing manager, Quote detail → Override markup.
Success: the list price is recomputed from the override (R9); the override is shown as a badge on the charge; `pricing_changed` + `margin_changed`.
**Happy path:** 25% → 35% → save → the price rises.
**Alternate paths:** remove the override → the catalog markup applies again.
**Failure paths:** locked quote → `409 COST_LOCKED`; target margin ≥ 100 → inline error; a rep (no `cpq.costs.manage`) → the action is not rendered.

**US-4.4** As a project implementer, I configure a margin-approval workflow on `cpq.quote.margin_changed`, so that low-margin quotes need approval with no CPQ code.
Identity: project implementer, Workflows editor (platform).
Success: a manual recipe exists (trigger, `filterConditions` on `marginPercent` / `costCoverage`, `USER_TASK`, guard on status change); the demo seeds it disabled.
**Happy path:** margin 8% < 12% floor → task for the deal desk → approve → the guard allows `ready` → `with_customer`.
**Alternate paths:** coverage < 80% → route "costs incomplete" to the pricing manager instead.
**Failure paths:** the event is lost after commit → no task is created; a project that needs a hard stop registers a mutation guard (shown in the manual recipe) on the status route — it recomputes the margin from stored data and compares the `margin_hash` approved in the workflow instance context; CPQ ships no guard of its own. The workflow is misconfigured → no task; without a project guard nothing blocks (documented).

### WF5: Carry costs to order and subscription

**US-5.1** As an order manager, I convert an accepted quote and see its costs and margin on the order, so that costs are not lost after the sale.
Identity: order manager, Order detail + `order-cpq-tab`.
Success: conversion copies every quote cost line to a `CpqOrderLineCost` in the same transaction (same `cost_key`, `source_quote_line_cost_id`). The order shows them and the order margin to cost holders. Order costs never change the order price.
**Happy path:** convert → the order shows Costs per line.
**Alternate paths:** lines without costs → "No costs" (coverage shown).
**Failure paths:** conversion refused per US-3.5; a crash mid-conversion → one transaction, no partial order or costs.

**US-5.2** (Phase 3) As an order manager (or procurement with `cpq.costs.manage`), I re-confirm a cost on an order before activation, so that the subscription records the supplier's final price.
Identity: order manager / procurement with `cpq.costs.manage`, Order detail → Re-confirm cost (procurement reaches it from the Cost requests row link).
Success: the value / validity change on the `CpqOrderLineCost` (margin only); the price is untouched; the order margin is recomputed. At activation the subscription item cost is created or updated from it, with a `reconfirm` note in its history entry.
**Happy path:** the carrier confirms 270 instead of 276 → re-confirm → margin improves.
**Alternate paths:** a validity-only extension.
**Failure paths:** the order is already activated → `409` ("change it through an Amend", US-6.1); a re-confirmation racing activation → serialized by the quote-configuration lock that activation also takes; the loser gets `409` and nothing is written; a stale answer to an old request → `409 COST_REQUEST_SUPERSEDED`. No approval is invalidated (an order exists).

**US-5.3** As sales / ops, I see each subscription item's contracted cost, supplier and supplier term, and a Cost History of every order that changed it, so that I know what we pay for what we bill and how it got there.
Identity: rep (read-only) / order manager / pricing manager / procurement with `cpq.costs.view`, Subscription detail → item costs + Cost History.
Success: one `CpqSubscriptionItemCost` per item and cost key, with an id that stays the same for the life of the purchase; an `activation` history entry linked to the order; `item_cost_changed (activation)`; the billing payload is unchanged (I-9).
**Happy path:** activate → the item shows "Tail: 270 EUR/month, Carrier X, term to 2028-11-30" → Cost History lists "Activation · Order O-123 · 270 EUR".
**Alternate paths:** an item without costs → "No cost recorded"; after a later Amend (Phase 3) the same cost row shows 240, and Cost History lists both orders with before → after.
**Failure paths:** an activation retry → idempotent (unique `(source_order_id, item_cost_id)`), no duplicate rows or history entries; a user without `cpq.costs.view` → no cost columns or history, `403` on the cost API.

### WF6: Renegotiate costs through ARC

**US-6.1** (Phase 3) As procurement, I record a renegotiated supplier price on an Amend quote without changing the customer price, so that savings show as margin.
Identity: procurement / ARC operator, Amend quote detail.
Success: carried cost lines (R13); the price lock holds (I-11); activation updates the same item cost in place (same id) and appends an `amend` history entry with before → after and the Amend order; `item_cost_changed (amend)`; no billing change.
**Happy path:** Amend → tail 270 → 240 → activate → the item cost (same id) shows 240; Cost History shows the activation order (270) and the Amend order (270 → 240).
**Alternate paths:** a supplier switch (new supplier and quote ref) on the same cost key.
**Failure paths:** another ARC activated first → `409 COST_SOURCE_CHANGED` → refresh the mirror; the cost is edited on a cancel line → refused.

**US-6.2** (Phase 3) As an ARC operator, I re-price a cost-plus line from its new cost, so that a cost pass-through reaches the customer when the contract allows it.
Identity: ARC operator, Amend quote → line ⋯ → Re-price from cost.
Success: the line is un-frozen (`_arcRepriced`), the price is recomputed from current costs and markup, the line enters `modifiedItems` (sibling path) and billing re-rates through the existing connector path.
**Happy path:** Re-price → the new price is shown in `ArcLineDiff`.
**Alternate paths:** undo by refreshing the mirror line — after a confirmation that it also discards renegotiated carried costs on that line.
**Failure paths:** any price-basis cost unknown → `COST_PENDING`, line not ready.

**US-6.3** (Phase 3) As an ARC operator, I renew a subscription and get told which supplier costs need renegotiation, so that the renewal is priced on valid supplier terms.
Identity: ARC operator / procurement, Renew quote detail.
Success: costs whose validity or supplier term ends before the new term end become `estimated` ("renegotiation due"); conversion blocks until each is answered or kept (R13).
**Happy path:** Renew → 1 tail due → Request cost → answer → convert.
**Alternate paths:** **Keep current cost** with a new validity and evidence (new supplier quote ref or note, R11) → confirmed with no value change; index costs re-evaluated at today's value (Phase 4); the item's charge became cost-plus after the sale → R1c reconciliation instantiates today's cost elements (an `on_request` one opens a request) and the line prices from cost.
**Failure paths:** the supplier declines → the operator removes the item (cancel line) or the pricing manager adds another supplier's cost.

**US-6.4** (Phase 3) As an ARC operator, I cancel a subscription and see supplier early-exit exposure, so that I know which supplier contracts outlive the customer.
Identity: ARC operator, Cancel quote detail.
Success: per item, costs with `supplier_term_end` > cancel effective date are listed; on activation, item costs are closed at the effective date − 1.
**Happy path:** Cancel → "Carrier X tail term ends 2028-11-30 (exposure 12 months)".
**Alternate paths:** no exposure → no panel.
**Failure paths:** a missing supplier term → "Supplier term unknown" (not an error).

**US-6.5** (Phase 1, safety) As an ARC operator, I renew a cost-plus subscription before cost carry-over ships, so that the renewal keeps the contracted price instead of mis-pricing.
Identity: ARC operator, Renew quote detail (banner).
Success: Renew mirror lines with a cost-plus charge are frozen (sibling Amend scheme); banner "Costs are not carried to change quotes yet"; at activation, cancelled / removed items end their costs and re-priced mirror lines update them in place (minimal write-back, same ids, Cost History entries); untouched items keep theirs.
**Happy path:** Renew → frozen line at the contracted price → convert → activate.
**Alternate paths:** a reconfigured mirror line → re-priced from catalog costs (a new line's costs are instantiated, R1a).
**Failure paths:** that re-price hits an `on_request` cost → not ready until the pricing manager enters it (US-4.2).

### Default User Stories

**US-0.1** As someone evaluating this app, I run `yarn initialize` and get demo users per role, including a pricing manager and a procurement user with `cpq.costs.view` / `cpq.costs.manage`, so that I can test every persona.
Success: the US-0.1 template criteria (each §2 role seeded, one known password logged, idempotent, `{role}@demo.local` pattern); the rep sees cost details and margin read-only (no edit actions).

**US-0.2** As someone evaluating this app, I see GIX demo data with a cost table (cross-connects), a cost-plus "IP Transit with partner tail" (on-request tail with estimate), a cost index (Phase 4), and demo quotes in each cost state (pending, estimated / indicative, confirmed, expired; `requested` / `declined` added with Phase 2), so that I understand cost-plus without reading code.
Success: the US-0.2 template criteria; names carry "Demo"; the margin-approval workflow recipe (Phase 1) and the sourcing recipe (Phase 2) are seeded **disabled**.

#### Checklist (domain stories)
- [x] Every story has persona + action + measurable outcome + success criteria
- [x] Every story has alternate and failure paths (plus the common failure block)
- [x] Every story traces to a workflow step
- [x] Identity checkpoint per story; every surface exists in §3.5
- [x] No vague verbs

#### Checklist (default stories)
- [x] US-0.1
- [x] US-0.2

### Cross-Story Impact Matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|-------|--------------|-----------------|--------|------------|
| US-1.2 (deactivate element) | catalog cost elements | US-2.1/2.2 (open quotes), US-6.5 (reconfigured mirrors) | Open unlocked quotes lose a cost on the next recalculation; the price changes silently | Confirmation dialog with the open-quote count; locked quotes keep stored lines; `pricing_changed` on the next save |
| US-1.3 (cost table edit) | table entries | US-2.1/2.2 | Same as standard prices: unlocked quotes re-price on the next saved recalculation | Documented behaviour (I-8 parity with price tables); locked quotes frozen (R4) |
| US-1.4 (new index value) | index values | US-2.x unlocked quotes, US-6.3 renew | Prices move between saves | Snapshot only on saved recalculation; frozen at lock (R4) |
| US-1.6 (toggle off) | toggle | all | Re-pricing blocked, renewals blocked | R14 explicit error; data kept; usage endpoint checked before switching off (manual) |
| US-2.2 (reconfigure) | cost lines reset, request cancelled | US-3.2 (late answer), US-3.4 | A stale answer could price the wrong configuration | Request id (I-13) + `cost_request_cancelled` |
| US-3.2 (answer) | value, sourcing status | US-2.3 (margin), US-3.5 (conversion), US-4.4 (approval) | Margin / approval may change after approval | `margin_changed` re-emitted; price change on a locked quote impossible (R11) |
| US-3.4 (different answer, locked) | `proposedAmount` | US-3.5, US-4.4 | The quote could convert with an outdated cost if the guard only checks status | The guard also refuses while `proposedAmount` differs from the value (`COST_ANSWER_PENDING`) |
| US-4.1/4.2/4.3 (cost edits) | cost lines, markup | US-4.4 (approval), US-3.2 (open request) | An approval given on an old margin | `margin_changed` with `pricingRevision`; project guard compares stored margin; edits of price-basis values are locked after `ready` |
| US-4.2 (manual value while request open) | value, request cancelled | US-3.2 | Procurement answers a cancelled request | `cost_request_cancelled` → the workflow closes the task; a late answer → `409` |
| US-3.5 / US-5.1 (conversion) | order created; quote cost lines price-frozen | US-3.2/3.4 (answers after conversion) | Answers on quote lines after an order exists could re-price a converted quote | Post-conversion answers are margin-only re-confirmations (US-5.2); price never recomputed once an order exists (I-3) |
| US-5.3 (activation) | item costs | US-6.x (ARC mirrors) | ARC needs item costs to carry | Phase 1 writes item costs; Phase 3 reads them; Phase 1–2 Renew frozen (US-6.5) |
| US-6.1 (amend cost) | item cost updated in place + history entry | US-6.3 (open renew on same sub), US-5.3 | Two ARC quotes with carried costs from the same item | Hash guard I-12 → second activation `409 COST_SOURCE_CHANGED`; the sibling's `ensureNoConcurrentArcQuote` |
| US-6.2 (re-price) | price, `modifiedItems` | billing (sibling re-rate) | Price change reaches billing | The sibling's re-rate path; I-9 holds for cost-only changes |
| US-6.4 (cancel) | item costs closed | US-6.1/6.3 open quotes | Costs closed under an open amend | The existing ARC concurrency guard; I-12 |
| US-1.1 (method / markup change) | charge pricing method, markup | US-2.1/2.2 open quotes, US-6.3 Renew | Unlocked quotes re-price on the next save; Renew reconciles to the new method | Confirmation with open-quote count; locked quotes frozen; R1c reconciliation |
| US-1.5 (calculate-price) | none (read) | US-1.6 toggle | A stale public price after toggle-off | Toggle off → `priceOnRequest`, never a stale price |
| US-2.1 (add product) | cost lines, requests (Phase 2) | US-3.1 (request flood), US-2.3 | Bulk adds open many requests | At most one open request per cost line; saved recalculation only |
| US-2.3 (see margin) | none (read) | US-4.4 | A stale margin read during approval | Margin computed from stored data on every read; guard recomputes |
| US-2.4 (FX refresh) | `fx_rate` snapshot | US-2.3, US-4.4 | Price moves between saves while unlocked | Refresh only on saved recalculation; frozen at lock (R4); `margin_changed` |
| US-2.5 (clone) | new cost lines | US-3.2 (idempotency) | A real answer on the clone treated as a duplicate | Idempotency scoped per cost line (I-13) |
| US-3.1 (request) | open request | US-3.7, US-1.6 | Requests on dead quotes / disabled tenant | US-3.7 cancellation; the usage endpoint lists open requests; answers get retryable `409 COST_PLUS_DISABLED` |
| US-3.2 (answer, unlocked) | value → price | rep sending the quote (status change) | The rep sends a price they have not seen | Status transitions carry `expectedRevision` → `409 STALE_REVISION` (R11) |
| US-3.3 (decline) | value → `none` | US-2.x indicative send | An undeliverable quote sent as indicative | Decline clears the value; the line is not ready (R10a) |
| US-3.6 (expiry warning) | none (event) | US-6.3 | Expiry of a carried cost on an open Renew | Warning covers Renew quotes too; R13 already flags renegotiation due |
| US-3.7 (quote closed) | requests cancelled | US-3.2 workflows | Open procurement tasks for dead quotes | `cost_request_cancelled (quote_closed)` in the same transaction; answer `409 QUOTE_CLOSED` |
| US-4.4 (approval) | none (project) | US-4.1/4.2 lock-exempt writes | An approval outlives a margin drop | `margin_hash` (values only) + `approvalInvalidated` |
| US-5.2 (re-confirm) | quote cost line after conversion | activation (US-5.3), US-4.4 | Race with activation; approval re-fired on a converted quote | Same aggregate lock as activation; `approvalInvalidated` suppressed once an order exists |
| US-6.3 (renegotiation request) | requests on Renew lines | another ARC on the same subscription | Two ARC quotes sourcing the same cost | The existing ARC concurrency guard + I-12 at activation |
| US-6.5 (Phase 1 safety) | frozen Renew mirrors | Phase 3 rollout | Phase-1 Renew quotes in flight at the Phase 3 upgrade | Forward-compatibility criterion in Phase 3 |

**Matrix outcomes applied:**
- story US-3.7 (closing a quote cancels its requests);
- the decline clears the value (R10a);
- status transitions carry `expectedRevision` (R11);
- Renew reconciliation (R1c);
- the toggle never weakens guards (R14); usage endpoint instead of a toggle-page warning (architect #2);
- a new guard error `COST_ANSWER_PENDING` (added to R7);
- post-conversion answers as margin-only re-confirmations (US-3.4 / US-5.2).

After the Phase 2 challenger fixes, every story has a matrix row (directly or via the row of the story it extends). No unresolved contradiction remains.

---

## 6. User Story Gap Analysis `Architect`

Capability ladder: **1** existing feature · **2** configuration / seed · **3** extension point (events, guards, injection, notifications) · **4** workflow / notification primitives · **5** new code. Commit numbers refer to `app-spec-notes/cost-plus-commits-WF.md`. A shared commit is counted once, under its first story.

| Story | Platform Match (rung) | Atomic Commits | Notes |
|-------|---------------|----------------|-------|
| US-1.1 cost-plus charge | 2 toggle + RBAC (#1); 5 charge columns, editor (#2, #5) | 3 | grounded C1, C11 |
| US-1.2 cost elements | 5 (#4); reuses the applicability grammar (1) | 1 | grounded |
| US-1.3 cost table | 1 pricing tables + 5 `purpose` guard (#3) | 1 | grounded C2 |
| US-1.4 cost index | 5 (#35, #36, #37) | 3 | Phase 4; currencies providers cannot hold indices (architect #1) |
| US-1.5 calculate-price | 1 calculate-price API + 5 cost-plus branch (#15) | 1 | grounded; Puffin filter precedent C15 |
| US-1.6 toggle | 2 feature toggles (per-tenant override) | 0 | toggle-off behaviour in #16; grounded-elsewhere: override UI `CORE/feature_toggles/backend/feature-toggles/overrides/page.tsx`, CPQ precedent `P/services/priceAdjustments/adjustmentService.ts:57` |
| US-2.1 quote with costs | 1 waterfall, aggregate lock; 5 lookup refactor, engine, cost lines (#6, #7, #8) | 3 | grounded C3, C4 |
| US-2.2 reconfigure | 5 (in #8) | 0 | |
| US-2.3 see margin | 5 (#9, #10, #13, #14) | 4 | |
| US-2.4 FX | 1 `ExchangeRateService` + 5 snapshot (#26) | 1 | Phase 2; grounded-elsewhere |
| US-2.5 clone | 1 clone + 5 (#16) | 1 | grounded |
| US-3.1 request | 3 events (#23) + 3 notifications (#25) + 4 Workflows sourcing recipe (#28) | 3 | Phase 2; recipe docs-only (U2) |
| US-3.2 answer | 5 API (#22) + page (#24) | 2 | Phase 2 |
| US-3.3 decline | 5 (in #22, #24) | 0 | Phase 2 |
| US-3.4 locked answer | 5 (#22a) | 1 | Phase 2 |
| US-3.5 conversion guard | 1 conversion + 3 guard call site exists (`runCpqMutationGuards`) + 5 (#17) | 1 | grounded |
| US-3.6 expiry warning | 4 `SchedulerService` (#38) | 1 | Phase 4; grounded-elsewhere |
| US-4.1 custom cost | 1 `withQuotePricingWrite` + 5 (#11, #11b, #12) | 3 | grounded C4, commands |
| US-4.2 edit / confirm | 5 (#14a) | 1 | |
| US-4.3 markup override | 5 (in #11, #14a) | 0 | |
| US-4.4 margin approval | 3 events (#11a) + 4 Workflows approval recipe (seeded in #21) + 3 project mutation guard (`runCpqMutationGuards`, grounded) | 1 | recipe docs-only (U2) |
| US-5.1 order costs | 5 `CpqOrderLineCost` + conversion copy (#17b) | 1 | user decision 2026-11-12 |
| US-5.2 re-confirm | 5 (#27) | 1 | Phase 3 (architect #2) |
| US-5.3 item costs + cost history | 5, pattern `CpqSubscriptionChangeLog` (#18, #18b, #19) | 3 | grounded C7 |
| US-6.1 amend renegotiation | 5 hash helper, mirror, activation, diff (#29, #30, #33, #34) | 4 | Phase 3; hash helper new (architect #1) |
| US-6.2 re-price from cost | 1 `_arcRepriced` + 5 (#31) | 1 | Phase 3; grounded C8 |
| US-6.3 renew | 5 (#32) | 1 | Phase 3 |
| US-6.4 cancel exposure | 5 (in #32) | 0 | Phase 3 |
| US-6.5 Phase 1 ARC safety | 1 `arcPriceFreeze` + 5 (#20, #20a) | 2 | grounded C8 |
| US-0.1 demo users | 2 role defaults (in #1) | 0 | |
| US-0.2 demo data | 2 seed (#21) | 1 | grounded `xd-276` |

**Total: 45** (= §4). Docs-only mapping that decides a phase: the Workflows trigger / `USER_TASK` / `CALL_API` recipes — the approval recipe is seeded in Phase 1 (#21), the sourcing recipe in Phase 2 (#28). Logged in §10 U2 and verified in the feature specs. It does not block: CPQ works without any workflow (WF3 edge 4; recipes seeded disabled). The toggle override UI (U1) is grounded-elsewhere (architect #2).

#### Checklist
- [x] Every story mapped with a rung and an atomic-commit estimate `PM`
- [x] Phase-deciding mappings grounded or labelled `docs-only` and logged in §10 `Architect`
- [x] Architect checkpoint #2 (see `app-spec-notes/cost-plus-architect-checkpoint-2.md`) `Architect`

---

## 7. Phasing & Rollout `PM`

Order: business priority × gap × blocker status.
- **Phase 1** delivers cases 2 (fixed cost tables) and the Phase-1 path of case 1 (pricing manager enters the tail cost), plus margin.
- **Phase 2** turns case 1 into a tracked sourcing process.
- **Phase 3** completes ARC.
- **Phase 4** adds case 3 (index) — the least frequent cost source; its absence has a simple workaround (a `fixed` cost the pricing admin updates).

### Phase 1: Cost-plus from known costs, margin, carry-through

**Goal:** a pricing admin defines cost-plus charges and cost tables. A rep quotes them and the price is computed from cost + markup. A pricing manager sees and governs margin, enters unknown tail costs by hand, and adds custom costs. Costs reach the order and the subscription, and billing is unchanged. ARC cannot mis-price or leave stale costs.

**Why this order:** it is the smallest increment that removes the spreadsheet for table-costed offers and puts margin on every quote. Every later phase builds on its engine, cost lines and item costs.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-1.1, 1.2, 1.3, 1.5, 1.6 | toggle, ACL, cost-plus charges, cost elements, cost tables, calculate-price | 6 |
| US-2.1, 2.2, 2.3, 2.5 | lookup refactor, engine, cost lines, margin, read API, quote UI, clone + toggle-off | 8 |
| US-3.5 | conversion guard | 1 |
| US-4.1, 4.2, 4.3, 4.4 | write API (2), confidential commands, dialogs, `margin_changed` + approval recipe (seeded in #21) | 5 |
| US-5.1, 5.3 | order line costs, item costs (stable id) + cost history, order / subscription UI | 4 |
| US-6.5 | ARC safety | 2 |
| US-0.1, 0.2 | demo users / seed, manual | 1 |

**Total: 27 atomic commits**
**Workaround:** WF3 sourcing by hand (US-4.2); WF6 frozen Renew mirrors + minimal write-back.

**Acceptance criteria:** `DDD writes, PM challenges` — see the criteria blocks after the phases.

**Business criteria** `PM`:
- [ ] A pricing admin with `cpq.pricing.manage` + `cpq.costs.view` creates a cost table, a cost-plus charge with a 25% markup and a table cost element, and the cost preview shows cost and list price.
- [ ] A rep adds that product to a quote; the line prices at cost × 1.25; the rep sees no cost value anywhere (UI, API, events).
- [ ] A pricing manager enters a tail cost on an `on_request` line, adds a margin-only custom cost and overrides a markup; the Margin card updates; `margin_changed` is delivered.
- [ ] Conversion is refused while a price-basis cost is estimated or expired, and succeeds once confirmed.
- [ ] Conversion copies costs to the order; activation creates item costs with an activation entry in Cost History; the billing payload is byte-identical to the same quote without costs.
- [ ] A Renew of a cost-plus item keeps the contracted price; a Cancel closes the item costs.

**Value delivered:**
- **Business value:** table-costed offers are priced in CPQ, and margin is visible and governable.
- **ROI metric:** within one quarter of rollout, ≥ 95% of won quotes with table-costed cost-plus charges carry no `price_override` manual adjustment on those charges (discounts stay legal, R9); ≥ 90% of accepted quotes with cost-plus charges have cost coverage ≥ 80% (baseline: margin unknown).

**Platform ROI:** feature-toggle-gated L2 capability; server-side permission redaction; confidential command audit; non-broadcast events as approval hooks.
- **Copy test:** someone copying Phase 1 learns to extend a pricing engine through inputs + recomputed outputs under one aggregate lock, without leaking data through CRUD, audit or events.

### Phase 2: Supplier cost sourcing + foreign-currency costs

**Goal:** an unknown tail cost is requested automatically, worked by procurement from a queue (or a project workflow / supplier API), answered with request-id safety, and converted at a dated FX rate. Late answers on sent quotes never change a price silently.

**Why this order:** case 1 is the highest-value case, but its Phase 1 workaround already prices correctly. Phase 2 adds the measurable sourcing process (lead time, 0 lost requests) on top of a proven engine.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-3.1, 3.2, 3.3, 3.4, 3.7 | sourcing API, locked answers, events, queue page, notifications, sourcing workflow recipe | 6 |
| US-2.4 | FX | 1 |

**Total: 7 atomic commits**

**Business criteria** `PM`:
- [ ] Adding "IP Transit with partner tail" (demo) at a site opens a request; procurement is notified; answering with the current request id makes the line ready and notifies the rep.
- [ ] A stale answer gets `409`; a repeated answer with the same supplier quote ref is a no-op.
- [ ] A different answer on a sent quote shows **Reopen and apply supplier answer** and blocks conversion (`COST_ANSWER_PENDING`).
- [ ] A USD cost on a EUR quote converts at the stored dated rate.
- [ ] The demo workflow recipe, once enabled, creates a procurement task and answers through the API.

**Value delivered:**
- **Business value:** tail sourcing leaves email and becomes a tracked, measurable process.
- **ROI metric:** 100% of tail requests carry requested / answered timestamps; median lead time reported per supplier from month 1; ≥ 80% of `on_request` costs on won quotes answered through a request (not typed by hand) within the first quarter.

**Platform ROI:** events + Workflows `USER_TASK` / `CALL_API` as the process engine; notifications; currencies service.
- **Copy test:** async external answers handled with correlation ids and idempotency keys, without CPQ owning a process engine.

### Phase 3: Costs through Amend / Renew / Cancel

**Goal:**
- **Amend:** carries item costs, records renegotiated supplier prices with a price lock, and offers re-price-from-cost.
- **Renew:** flags supplier renegotiation.
- **Cancel:** shows supplier exposure.
- **Activation:** updates item costs in place (stable ids) and appends Cost History entries linked to the ARC orders.

**Why this order:** it depends on item costs (Phase 1) and sourcing (Phase 2, used for renegotiation-due requests). It also replaces the Phase 1 safety freeze.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-6.1, 6.2, 6.3, 6.4 | hash helper, carried mirrors + Renew reconciliation, price lock / re-price, renew / cancel, activation history, diff | 6 |
| US-5.2 | post-conversion re-confirmation (Q-D13) | 1 |

**Total: 7 atomic commits**

**Business criteria** `PM`:
- [ ] A cost-only Amend lowers a tail cost from E. The item cost keeps its id and shows the new value; Cost History shows both orders with before → after; the customer price and billing are unchanged.
- [ ] Re-price from cost changes the price, and the change reaches billing through the existing modify path.
- [ ] A Renew flags an expiring supplier term and blocks conversion until it is confirmed or kept.
- [ ] A Cancel lists supplier contracts outliving the cancel date.
- [ ] A concurrent ARC activation is refused with `COST_SOURCE_CHANGED`.

**Value delivered:**
- **Business value:** renewals and amendments start from the real supplier cost, and supplier savings show up as margin.
- **ROI metric:** 100% of renewals of costed items show the previous supplier cost and term; 100% of supplier price changes are recorded with an effective date in their month.

**Platform ROI:** stable-identity cost rows with an append-only history (the `CpqSubscriptionChangeLog` pattern); hash-guarded carry-over (reusable by the sibling's carry-over).
- **Copy test:** extending an existing ARC pipeline without touching billing.

### Phase 4: Index-linked costs + cost-expiry warnings

**Goal:** a pricing admin maintains market indices (e.g. Brent). Index-linked costs price quotes at the value in force on the quoting date, and Renew re-evaluates them. Procurement is warned before supplier quotes expire.

**Why this order:** index costs are the rarest source, and they have a working Phase 1 workaround (a `fixed` cost the admin updates). Expiry warnings are a convenience on top of Phase 2.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-1.4 | index entities, pages, engine | 3 |
| US-3.6 | expiry scheduler + notification | 1 |

**Total: 4 atomic commits**

**Business criteria** `PM`:
- [ ] Adding a Brent value for today changes the price of an unlocked quote on its next saved recalculation, and leaves a sent quote unchanged.
- [ ] A Renew re-evaluates index costs at today's value.
- [ ] A cost expiring in N days produces exactly one warning.

**Value delivered:**
- **Business value:** fuel- and energy-linked offers are quoted at the current market cost without manual updates.
- **ROI metric:** 0 manual cost edits on index-linked elements after rollout; conversions refused for an expired cost with no prior `cost_expiring` event = 0.

**Platform ROI:** reference data with append-only revisions; scheduler commands.
- **Copy test:** dated reference data snapshotted into a transactional aggregate.

### Acceptance criteria — domain `DDD writes`, PM challenges

Written by the DDD challenger (`app-spec-notes/cost-plus-challenger-phase4.md`); PM challenges recorded per phase.

**Phase 1 domain criteria** `DDD`:
- [ ] **I-8 golden test.** Every demo quote with no cost-plus charges and no cost lines produces `charges`, `pricingSummary`, `snapshotHash` and `pricing_changed` payloads byte-identical to a pre-migration fixture, with the toggle on and off. Migrations are additive (`purpose` defaults to `price`).
- [ ] **I-2 / I-3 / R2 property test.** The property test covers every markup rule × cost model:
  - the list total = markup(Σ known price-basis costs), rounded once;
  - unit × qty reproduces the per-instance total;
  - recalculating twice gives identical `charges` and `margin_hash`;
  - `none` → `COST_PENDING`;
  - no applicable price-basis line → `NO_PRICE_BASIS_COST`;
  - the fallback price never counts in totals.
- [ ] **I-1 / R1a.** Exactly one non-deleted catalog cost line exists per `(quote_line_id, cost_key)` (partial unique index). Lines removed or no longer applicable leave no orphans.
- [ ] **I-5 / R11.** Every cost write runs in `withQuotePricingWrite`: revision +1, `409 STALE_REVISION`. Lock-exempt writes keep `snapshotHash`. A locked price-basis change returns `409 COST_LOCKED` and nothing is stored. A concurrent confirm and convert are serialized.
- [ ] **I-4 leak sweep.** Sweep every channel as a user without `cpq.costs.view`, by key scan plus a sentinel value: quote / order / line APIs, calculate-price, broadcast events, audit log, undo snapshots, search documents and exports. None may carry a cost, markup or margin.
- [ ] **R8 `margin_changed`.** Emitted once per save, after commit, only when `margin_hash` changes. `approvalInvalidated` iff the status is out of `{new, incomplete, ready}` and no order exists. No per-line amounts. A guard recomputing from stored data gets the same hash.
- [ ] **R14.** With the toggle off:
  - conversion still enforces R7;
  - activation still writes item costs;
  - calculate-price returns `priceOnRequest` for cost-plus charges;
  - re-pricing a cost-plus charge returns `COST_PLUS_DISABLED`;
  - no stored data is deleted.
- [ ] **R4 (tables).** A cost-table entry edit never changes the cost lines or `charges` of a locked quote, including on lock-exempt writes.
- [ ] **R1b (value part).** A dimension change resets the `on_request` value (to `none` or the catalog estimate), keeps the old value in `note`, and leaves other known values untouched.
- [ ] **I-6 / R7.** Conversion is refused (`COSTS_NOT_CONFIRMED`) with zero order rows written; margin-only costs never block. A successful conversion copies every quote cost line to exactly one `CpqOrderLineCost` (same `cost_key`) in the same transaction.
- [ ] **I-7 / I-9 / I-10.** Activation creates one item cost per order line cost (unique `(subscription_item_id, cost_key)`) plus one `activation` history entry; retries are idempotent. The billing payload is byte-identical. Under US-6.5:
  - Cancel / removal sets `status = ended` with a `cancel` entry;
  - a re-priced mirror updates the same rows in place with history entries;
  - no item cost id ever changes.

**PM's challenges (Phase 1):** all accepted. They are cheap golden / property / sweep tests, and each protects an invariant whose breach is silent (I-4, I-8, I-9).

**Phase 2 domain criteria** `DDD`:
- [ ] **I-13.**
  - A stale request id → `409 COST_REQUEST_SUPERSEDED`, no state change.
  - A repeated `supplier_quote_ref` on the same cost line → `200` no-op, with no revision bump and no event.
  - A re-request cancels the previous one and increments `request_seq`.
  - At most one open request per cost line.
- [ ] **R11.** On a locked quote:
  - a same-value answer is confirmed lock-exempt;
  - a different-value answer stores only `proposedAmount`, `charges` stay unchanged, and conversion returns `422 COST_ANSWER_PENDING`.
- [ ] **R1b (request part).** A dimension change cancels the open request in the same transaction and emits exactly one `cost_request_cancelled (reconfigured)`.
- [ ] **Events.**
  - `cost_requested` is emitted once per opened request, after commit, with no cost.
  - `cost_valued` is emitted on every value / status change, with no amount and with `leadTimeHours`.
  - None of these events is broadcast.
- [ ] **R3 / R4.** `fx_rate` + date are snapshotted from `currencies`. A missing rate gives `CURRENCY_NO_RATE`, never 1:1. Previews store nothing. A locked quote's price never moves with the rate.
- [ ] **Converted quotes.** An answer on a converted quote → `409 QUOTE_CONVERTED`, nothing written (re-confirmation arrives in Phase 3).
- [ ] **US-3.7.** A terminal status or quote deletion cancels open requests in the same transaction. A later answer returns `409 QUOTE_CLOSED` with no write.

**PM's challenges (Phase 2):** "at most one open request" is enforced by a lock-path assertion; whether a DB constraint is also needed is deferred to the feature spec. A partial unique index on open requests is welcome but not a phase gate. Everything else accepted.

**Phase 3 domain criteria** `DDD`:
- [ ] **R13 / R1c.**
  - Amend mirrors carry every open item cost (same `cost_key`, `carried_from_hash`) and are never re-instantiated.
  - Renew mirrors reconcile with the catalog: matching costs are carried, missing elements instantiated, and inapplicable item costs shown as dropped.
- [ ] **I-11.** Carried-cost edits on a frozen mirror change only `margin_hash`. Re-price from cost un-freezes the line and flows through `modifiedItems`.
- [ ] **I-12.** When the source item cost changed, `409 COST_SOURCE_CHANGED` with nothing written. When two Amends activate in parallel, exactly one succeeds.
- [ ] **I-10.**
  - A changed cost updates its row in place (same id) and appends exactly one history entry whose `after` equals the new state; Cancel ends the row.
  - A merge re-points item costs to the merged item without changing their ids, with a `merge` entry.
  - `item_cost_changed` is emitted once per history entry, with its cause.
- [ ] **I-9.** A cost-only Amend produces a `modify` change with a zero billing diff.
- [ ] **Renew.** An MRC carried cost whose validity or supplier term ends before the new term becomes `estimated` with its value kept, and blocks conversion until it is confirmed or kept with evidence.
- [ ] **Forward compatibility.** A Renew created under the Phase 1 safety freeze still activates correctly after the Phase 3 upgrade.
- [ ] **Q-D13.** A post-conversion re-confirmation changes margin only (order `charges` unchanged), is serialized with activation by the same lock, and is refused once the order is activated.

**PM's challenges (Phase 3):** all accepted. The parallel-Amend and forward-compatibility tests protect live subscriptions.

**Phase 4 domain criteria** `DDD`:
- [ ] **Index values.**
  - Values are append-only, with server-assigned revisions.
  - The value in force is deterministic.
  - Future values are ignored before their date.
  - A value ≤ 0 is rejected (`422`).
- [ ] **R4.** A new value changes only unlocked quotes, and only on a saved recalculation. Locked quotes keep `index_snapshot` byte-identical. Item costs are not revalued (Q-D9).
- [ ] **Missing value.** No value at or before the date gives `INDEX_NO_VALUE` and the line is not ready.
- [ ] **Renew.** Index carried costs are re-evaluated at the recalculation date; other carried values are unchanged.
- [ ] **`cost_expiring`.**
  - Emitted exactly once per `(cost line, valid_until)`.
  - A missed day is caught up without duplicates.
  - Terminal and converted quotes are excluded.
  - Not broadcast, and no amount.
- [ ] **Referential safety.** Deleting or deactivating a referenced index is refused.

**PM's challenges (Phase 4):** "value ≤ 0 rejected" is accepted for v1 (oil and fuel indices). Negative-price indices (e.g. power spot) are logged as a later extension in §10 (Q-D15), not built now.

### Rollout Summary

```
Phase 1: Cost-plus from known costs, margin, carry-through   27 commits   WF1, WF2, WF4, WF5 (+ WF3 / WF6 workarounds)
Phase 2: Supplier cost sourcing + FX                          7 commits   WF3, WF2 (FX)
Phase 3: Costs through Amend / Renew / Cancel                 7 commits   WF6, WF5 (re-confirm)
Phase 4: Index-linked costs + expiry warnings                 4 commits   WF1 / WF2 (index), WF3 (expiry)
                                                             ---------
                                                             45 atomic commits total
                                                             41 commits for production-ready (Phases 1–3)
```

#### Checklist
- [x] Phases ordered by business priority × gap × blockers
- [x] Each phase a complete, usable increment
- [x] Workarounds documented for high-gap blockers
- [x] Commits per phase `Architect`
- [x] DDD domain criteria + PM business criteria `DDD + PM`
- [x] PM challenged the DDD criteria `PM`
- [x] Value + ROI per phase
- [x] No artificial phases

---

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs involved | Resolution |
|----------|---------------|------------|
| The cost lock extends the sibling's adjustment lock with exemptions (margin-only, confirmations, validity, sourcing, post-conversion re-confirmations) | sibling App Spec R7 / I-10 | The exemptions never change price or `snapshotHash`, so the sibling invariants hold; margin approvals key on `margin_hash` (R8) |
| Markup override raises price above the catalog list, while the sibling forbids manual markups (D3) | sibling D3 / R3 | A markup override is a **list-price input** of a cost-plus charge, not a manual adjustment; the waterfall's "never above standard" rule still holds for manual adjustments (R9) |
| Renew mirror lines are re-priced at today's standard (sibling Q8), but Phase 1–2 freeze cost-plus Renew mirrors | sibling R9 | Temporary safety (US-6.5) until Phase 3; non-cost-plus Renew mirrors keep the sibling behaviour |
| Carried-over adjustment hash guard (sibling Phase 2, not built) vs carried cost hash (here Phase 3) | sibling WF3 | Built once here as a shared item-state hash helper; whichever ships first owns it, the other reuses it |
| Calculate-price additive contract (sibling R13, `xd-187`) | calculate-price API | `priceOnRequest` / `indicative` are additive; no cost fields ever (R15) |
| `pricing_changed` / `status_changed` are broadcast | sibling events | Cost data only in non-broadcast events; `status_changed` gains booleans only |
| ARC frozen-line scheme `_arcPriceFrozen` / `_arcRepriced` | `arcPriceFreeze.ts`, sibling quote-pricing-integrity spec | Reused; "Re-price from cost" is a new trigger for the existing un-freeze |
| Pricing tables used for prices and costs | `xd-186-pricing-tables` spec | `purpose` column, default `price` → existing tables unchanged |

#### Checklist
- [x] Related specs listed
- [x] Identity model consistent (staff + RBAC only)
- [x] Terminology matches §1.3
- [x] Shared entities owned by one spec (costs: this spec; adjustments: sibling)
- [x] No phantom entities
- [x] Every conflict resolved

---

## 9. Reference App Quality Gate `Architect`

`@dainamite/cpq` is an L2 product package and `dainamite-core` is the L3 demo. The gate applies to the demo seed and to the package's patterns.

**Platform patterns to demonstrate:**
- feature-toggle-gated capability;
- server-side field redaction by feature;
- confidential command audit;
- non-broadcast events as workflow hooks;
- Workflows-driven sourcing with correlation ids;
- stable-identity cost rows with an append-only cost history.

**Anti-patterns to avoid:**
- costs in `charges` / `pricingSummary` / broadcast events;
- client-side-only hiding;
- a CPQ-owned process engine;
- reading Open Mercato catalog prices from CPQ;
- ORM relations to `customers` / `currencies`;
- hand-written migrations;
- demo-specific cost logic inside `packages/cpq`.

#### Checklist
- [x] Copy test per phase
- [x] Anti-patterns listed
- [x] Platform features demonstrated
- [x] No scaffold boilerplate added
- [x] Tests use the repo's jest / Playwright setup (`.ai/skills/unit-tests`, `.ai/skills/integration-tests`)
- [x] No app-local test config

---

## Production Readiness `PM`

| Workflow | Deployable | Blocker | What the client would say |
|----------|-----------|---------|---------------------------|
| WF1 | after Phase 1 (indices Phase 4) | — | "Oil-linked costs still need a manual monthly update until Phase 4." |
| WF2 | after Phase 1 (FX Phase 2) | — | "Our USD carrier costs need converting by hand until Phase 2." |
| WF3 | Phase 1 by hand; tracked after Phase 2 | — | "Phase 1: we still chase carriers by email, but the quote prices right." |
| WF4 | after Phase 1 | approval rule is project config | "We must set our margin floor in Workflows." |
| WF5 | after Phase 1 | — | — |
| WF6 | safe in Phase 1–2; complete after Phase 3 | — | "Until Phase 3, renewals don't show what the carrier charges us." |

#### Checklist
- [x] Each workflow assessed, with its blocker
- [x] "What would the client say?" test
- [x] No workflow stops midway

---


## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|----------|---------|--------|-------|--------|
| Q-P0.1 | Who pays — still the operator licensing `@dainamite/cpq`? | yes / other | business case | user | CONFIRMED by user (2026-11-12) |
| Q-P0.2 | Flywheel as in §1.1? | confirm / edit | ROI framing | user | CONFIRMED by user (2026-11-12) |
| Q-P0.3 | Primary goal metrics as in §1.2? | confirm / edit | phase ROI | user | CONFIRMED by user (2026-11-12) |
| Q-P0.4 | Scope exclusions as in §1.2 (no billing of costs, no customer-price indexation, no procurement / PO, no supplier portal, no usage cost-plus)? | confirm / edit | scope | user | CONFIRMED by user (2026-11-12) |
| Q-D1 | Who sees cost values and margin? | only `cpq.costs.view` holders / reps also see margin % / everyone with quote access | data confidentiality, rep autonomy | user | DECIDED by user (2026-11-12): **reps see cost details read-only** — `cpq.costs.view` is granted to `employee` by default, `cpq.costs.manage` stays `admin`; tenants can revoke it per role |
| Q-D2 | Can a quote with **estimated** (not supplier-confirmed) tail costs be sent to the customer? | **(rec.)** yes, as an indicative quote; conversion blocked until confirmed / no, estimates are internal only | budgetary-quote speed vs firm-price risk | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D3 | After the customer accepted, a confirmed cost differs from the estimate. | **(rec.)** price changes → quote back to `ready`, re-accept / keep accepted price, absorb the difference in margin | customer trust vs margin leakage | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D4 | Supplier costs in a foreign currency? | **(rec.)** allowed; converted with a dated exchange-rate snapshot from `currencies` / same currency as the quote only | carrier tails are often USD / EUR | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D5 | Process for obtaining an unknown cost? | **(rec.)** CPQ emits `cost_requested` (auto-opened when `requires_sourcing`) + offers a sourcing queue page and an answer / decline API; the process itself (procurement task, supplier API) is a project workflow; a demo recipe is seeded / CPQ ships its own built-in sourcing state machine | reuse of Workflows vs out-of-the-box UX | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D6 | ARC: when a supplier renegotiates during an Amend, does the customer price follow? | **(rec.)** no — price lock; explicit "Re-price from cost" / always re-price cost-plus charges from current cost | contract stability vs margin pass-through | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D7 | Markup granularity | **(rec.)** one markup rule per cost-plus charge (on the sum of its price-basis costs) / per cost element | catalog simplicity vs flexibility | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D8 | Package switch | **(rec.)** feature toggle `cpq.cost_plus`, default off (precedent `cpq.manual_price_adjustments`) / module config | discoverability, per-tenant control | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D9 | Index-linked costs on live subscriptions: revalue item costs when the index moves (margin only, never billing)? | **(rec.)** no — frozen at activation until the next ARC (R12); revisit with a scheduled revaluation later / yes, monthly revaluation job | margin accuracy over the term vs complexity | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D10 | Supplier early-termination charges on Cancel | **(rec.)** show exposure only (R13), no cost recorded / record as a margin-only NRC cost on the cancel quote | cancel margin accuracy | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D11 | Several supplier bids for one tail (pick the best carrier) | **(rec.)** out of scope for v1 — one cost line holds the chosen answer; bids live in the sourcing workflow / model alternatives as cost-line candidates | procurement UX | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D12 | A supplier changes its price mid-term with no customer change | **(rec.)** an Amend quote with only cost changes (price lock, no billing impact) / a lightweight "item cost change" command outside ARC | auditability vs effort | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D13 | Tail price re-confirmed between conversion and activation | **(rec.)** allow re-confirming value / validity on the quote cost lines (lock-exempt, margin only) until activation (margin only; price fixed by the order) / never — snapshot only | margin accuracy | user | CONFIRMED by user (2026-11-12) — recommended option |
| Q-D15 | Negative index values (e.g. power spot prices) | v1 rejects ≤ 0; later: allow negative values with the unit cost floored at 0 | Phase 4 scope | PM | CONFIRMED by user (2026-11-12) — recommended option |
| U1 | Per-tenant override UI of `feature_toggles` (US-1.6) | grounded-elsewhere `CORE/feature_toggles/backend/feature-toggles/overrides/page.tsx` | Phase 1 toggle UX | Architect | DECIDED — exists (architect #2) |
| U2 | Workflows trigger `filterConditions`, `USER_TASK` form, `CALL_API` to CPQ answer route (US-4.4 approval recipe in Phase 1, WF3 sourcing recipe in Phase 2) | verify in the Phase 1 and Phase 2 feature specs | recipes only (docs-only) | Architect | OPEN — non-blocking (CPQ works without a workflow; recipes seeded disabled) |
| Q-D14 | Rounding of cost-plus list prices | **(rec.)** round the per-instance list total once to currency precision (R2) / "pretty" price rounding rules (e.g. to 0.99) | price presentation | Architect | CONFIRMED by user (2026-11-12) — recommended option |

---

## Changelog

### 2026-11-12 (user review)
- Phase 0 answers confirmed by the user: Q-P0.1–Q-P0.4 and every Q-D default except Q-D1.
- **Q-D1 changed:** reps see cost details and margin read-only (`cpq.costs.view` granted to `employee` by default; `cpq.costs.manage` stays `admin`).
- **Order and subscription cost model changed** (user decision; supersedes the architect #1 removal of the order copy):
  - `CpqOrderLineCost` is restored as the order's own cost entity, copied at conversion.
  - `CpqSubscriptionItemCost` keeps **one stable id per item and cost key for the whole life of the purchase**: updated in place by ARC, re-pointed on merge, ended on cancel. The earlier close-and-reopen rows are dropped.
  - New append-only `CpqSubscriptionItemCostChange` provides a **Cost History** shown like the subscription's Change History, with quote and order links and before → after values.
  - WF5 +2 commits; total 45 (Phase 1: 27).

### 2026-11-12
- Amendment from the first feature spec (`2026-11-12-cpq-cost-plus-quote-pricing-margin.md`, Resolved assumption Q1): the conversion guard + post-conversion price freeze (commit #17) moves from the order / subscription costs feature into the quote pricing and margin feature. Reason: that feature alone must not let an indicative quote become an order (I-6). Feature commits: quote pricing and margin 20 → 21; order / subscription costs 5 → 4. Phase totals unchanged.
- That spec also fixes three contract details the App Spec left open: cost commands are not undoable, with redacted logs (I-4); markup overrides live in `cpq_quote_markup_overrides`; and the status route gains an optional `expectedRevision`.

### 2026-11-11
- Phase 0 drafted from the user's brief, the shipped price-adjustment capability and a code survey (§0). Proposed answers recorded in §10.
- Autonomous run (user instruction 2026-11-11): every §10 decision took the recommended option.
- Phase 1 (workflows, UI, gap matrix) + challenger (5 CRITICAL fixed) + architect checkpoint #1 (order copy table and stored margin dropped, `cost_model`, confidential commands, hash helper not yet built).
- Phase 2 (stories, cross-story impact matrix) + challenger (7 CRITICAL fixed: method switch-back, Renew reconciliation R1c, US-3.7 close-cancellation, decline clears value, toggle never weakens guards, status transitions carry `expectedRevision`).
- Phase 3 (§6) + architect checkpoint #2 (FX `autoFetch: false`, write API 2 commits, re-confirmation to Phase 3, Phase 1 decoupled from Phase 2): 43 atomic commits.
- Phase 4 (§7) with DDD-written domain criteria and PM challenges; final consistency challenger (5 CRITICAL text fixes applied).
- Phase 5 decomposition:

| Feature | Phase | Draws on | Gap (atomic commits) | Brief |
|---|---|---|---|---|
| Cost-plus charges, cost catalog and quote margin (known costs) | 1 | WF1, WF2, WF4; US-1.1–1.3, 1.5, 1.6, 2.1–2.3, 2.5, 3.5, 4.1–4.4, 0.1, 0.2 | 21 (incl. #17 since 2026-11-12) | `briefs/2026-11-11-cpq-cost-plus-quote-pricing-margin.md` |
| Carry quote costs to orders and subscriptions with ARC safety | 1 | WF5, WF6 safety; US-5.1, 5.3, 6.5 | 4 | `briefs/2026-11-11-cpq-cost-plus-order-subscription-costs.md` |
| Supplier cost sourcing for on-request costs | 2 | WF3; US-3.1–3.4, 3.7 | 6 | `briefs/2026-11-11-cpq-cost-plus-supplier-sourcing.md` |
| Foreign-currency supplier costs | 2 | WF2; US-2.4 | 1 | `briefs/2026-11-11-cpq-cost-plus-foreign-currency-costs.md` |
| Supplier costs through Amend / Renew / Cancel | 3 | WF6, WF5; US-5.2, 6.1–6.4 | 7 | `briefs/2026-11-11-cpq-cost-plus-arc-costs.md` |
| Index-linked costs and expiry warnings | 4 | WF1, WF2, WF3; US-1.4, 3.6 | 4 | `briefs/2026-11-11-cpq-cost-plus-index-costs-expiry.md` |

- Phase 0 challenger (`app-spec-notes/cost-plus-challenger-phase0.md`): split cost status into value / sourcing status with request ids (I-13); supplier terms; margin and order costs moved to cost-owned tables (I-4 widened); `cost_key` lineage; `NO_PRICE_BASIS_COST`; rounding, FX direction, snapshot freeze, lock exemptions, clone rules; Q-D9..Q-D14 added.
