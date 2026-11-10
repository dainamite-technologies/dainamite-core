# App Spec: CPQ Quote Price Adjustments (discounts, overrides, time-based pricing)

> The App Spec is a business architecture document that sits above feature specs.
> It captures domain knowledge, validates cross-spec consistency, and ensures
> the capability solves a real business problem using the platform correctly.
>
> This document is the SINGLE SOURCE OF TRUTH for what this capability is, who it serves,
> and how it maps to the platform. Feature specs are generated from this document.
> If a spec contradicts this document, this document wins.
>
> Each section has a checklist with an owner. A section is done when all checks pass.

**Status:** Phases 0–4 complete — every challenger gate and both architect checkpoints passed with fixes applied; confirmed for hand-off under the user's autonomous-run instruction (Phase 5: feature briefs + first feature spec)
**Capability catalog:** [`app-spec-notes/capability-catalog.md`](app-spec-notes/capability-catalog.md) (framework entries docs-only; CPQ / billing entries grounded in repo source)
**Gate notes (`app-spec-notes/`):** `challenger-phase0-domain.md` · `challenger-phase1-workflows.md` · `architect-checkpoint-1.md` · `challenger-phase2-stories.md` · `challenger-phase01-recheck.md` · `architect-checkpoint-2.md` · `challenger-phase4-criteria.md`
**Decision basis:** the user asked for an autonomous run (2026-11-10). Every open question was resolved with the recommended option; the user confirmed them on 2026-11-10 ("stick to those suggestions") and asked for the easiest correct behaviour on the billing corner cases (U12, U13) — all marked `DECIDED` in §10.

---

## 0. Current state (research, 2026-11-10)

| # | Fact | Evidence |
|---|---|---|
| C1 | The engine resolves each charge (fixed price or pricing table; flat / per_unit / volume / tiered), then applies **price rules** in `sortOrder`, appending a `RuleAdjustment` per applied rule. Rules can lower **or raise** a price. | `cpqPricingService.ts:75-238` |
| C2 | The pre-rule price is not a stored field; it is derivable from `adjustments[0].unitPriceBefore` when a rule fired. | `cpqPricingService.ts:164-238` |
| C3 | `discount_absolute` / `surcharge_absolute` act on the **per-instance charge total**; `discount_percent` / `surcharge_percent` / `price_override` on the **unit** price; discounts clamp at 0; the line quantity multiplies afterwards. | `cpqPricingService.ts:181-219`, `cpqQuotingService.ts:1228-1237` |
| C4 | `CpqQuoteLineConfiguration.charges` is engine output, overwritten on every recalculation; every save path ends in `recalculateInternal`. For free-form lines (no offering / product) `charges` is input and output. | `cpqQuotingService.ts:320, 464, 521, 698, 812-856` |
| C5 | No way to edit a price or add a discount. Sales line `discountAmount` / `discountPercent` and header `discountTotalAmount` are always `'0'`. | `cpqQuotingService.ts:138, 258-259` |
| C6 | `pricingSummary.discountTotal` / `surchargeTotal` aggregate rule adjustments only. | `cpqQuotingService.ts:1269-1283`, `xd-201-quoting.md:432` |
| C7 | Conversion copies `charges` and totals; subscription items store `charges` + `mrcAmount` / `nrcAmount`; items have no start date. | `cpqOrderService.ts:314, 644-646`, `entities.ts:1002-1082` |
| C8 | Activation emits one `recurring` (item `mrcTotal`) + one `one_time` charge per item; the connector creates one billing item per charge, start date only, `sourceRef = cpq-<sub>-<item>-<type>` (unique per account); the monthly amount is passed as `unit_price` whatever the account cycle. `BillingItem.bill_end_date` exists; `billing.items.update` accepts `rateJson`; billing items can be deleted; negative amounts are allowed on `one_time` items only. | `cpqOrderService.ts:1164-1198`, `chargeMapper.ts:47-93`, `billing/data/entities.ts:186-198`, `billing/commands/items.ts:167-180`, `billing/data/validators.ts:91-101`, `billing/api/items/route.ts:26` |
| C9 | Accounts bill in arrears on a cycle (monthly / quarterly / annually / weekly) with an anchor; a `recurring` item is charged once per **full** cycle inside its dates; partial cycles need a connector-posted `one_time` proration. Amend posts proration for added items; activation and removals do not. | `billing/data/entities.ts:65-72`, `billing/lib/itemSelector.ts:104-118`, `invoiceWriter.ts:220`, `cpq-subscription-amended.ts:156-167`, `cpq-subscription-activated.ts:111` |
| C10 | Renew clears / extends every item with a `bill_end_date`; cancel end-dates every item; both can move an earlier end date later. | `cpq-subscription-renewed.ts:56-65`, `cpq-subscription-cancelled.ts:54-63` |
| C11 | Status is operator-driven (any → any); auto-managed `new / incomplete / ready` bypass `transitionStatus`. Line edits are blocked only in terminal statuses; `recalculate` has no status check and saves with `cpq.quotes.view`. | `services/types.ts:55-65`, `cpqQuotingService.ts:177, 336, 475, 544, 899-901`, `recalculate/route.ts:8-10` |
| C12 | ARC mirror lines are `modify` (`cancel` on cancel quotes), keep `offeringId` / `productId` and are **re-priced at today's standard** when set; NRC is mirrored too; `startDate` / `termMonths` null. | `cpqQuotingService.ts:2480-2546, 812-831` |
| C13 | Amend / renew events carry only `add` items and removed ids, no change-log id; `modify` changes update CPQ inventory only. Every mirror line produces a `modify` change. Merge clones items under new ids; the merged subscriber only re-points. | `cpqOrderService.ts:1111-1117, 1220-1302`, `cpqInventoryService.ts:1020-1027, 1250-1279, 1731-1772`, `cpq-subscription-merged.ts:47-54` |
| C14 | Conversion blocks only `cancelled` / `rejected`. Activation emits events after commit and swallows failures (`console.error`); renew returns silently without a billing account. | `cpqOrderService.ts:155-159, ~398-404`, `cpq-subscription-renewed.ts` |
| C15 | No approval engine; CPQ emits no quote events; no CPQ route calls a mutation guard; quote routes do not export `openApi`. `ensureNoConcurrentArcQuote` ignores accepted-not-activated ARC orders. | `xd-201-quoting.md:917-919`, `cpq/events.ts`, `api/quotes/[quoteId]/status/route.ts:11-26`, `cpqQuotingService.ts:2276` |
| C16 | Price-rule calendar effective dates and per-tier rule application are planned, not built. | `xd-188-price-rules.md:509-520` |

---

## 1. Business Context `PM`

### 1.1 Business Model

`@dainamite/cpq` is an L2 product module licensed by operators (demo tenants: GIX — interconnect / peering, Puffin — cloud). Sales reps build quotes the engine prices from catalog data. Real deals are negotiated — a competitor match, a hand-rounded price, an introductory promotion — and none of that can be expressed in CPQ today (C5), so negotiated pricing happens off-system and quote, order, subscription and invoice disagree.

**Who pays (Q1, user-confirmed):** the operator licensing `@dainamite/cpq` — negotiated deals quoted, ordered and billed from one system, plus the discount data their approval process needs. Daily user: the sales rep. Consumers: sales manager / deal desk, billing operator.

**Flywheel:**
```
Rep negotiates the price inside the quote (not in a spreadsheet)
  → order, subscription and billing carry exactly the contracted price
  → no billing corrections, no invoice disputes → reps trust CPQ for every deal
  → every deal records list vs standard vs offer → discount depth is measurable
  → pricing admins tune price rules and approval thresholds from real discount data
  → standard prices land closer to deal prices → fewer, smaller manual adjustments
  → faster quotes, more deals priced in-system
```

#### Checklist
- [x] Paying customer identified
- [x] Flywheel articulated

### 1.2 Business Goals

**Primary goal (Q1, user-confirmed):** every negotiated deal is priced inside CPQ and billed exactly as quoted.
- ≥ 95% of won quotes with a non-standard price have it set in CPQ, per tenant per quarter.
- For every subscription item and billing cycle, the billed recurring amount equals the contracted price in force at the start of that cycle — checked by the reconciliation report (US-2.5): 0 unexplained drift.

**Secondary goal:** every quote exposes list / standard / offer deal values and signed discount depth so a project configures approvals with Open Mercato Workflows without CPQ code. Measurable: every `cpqStatus` change (manual or automatic) emits `cpq.quote.status_changed` with the pricing snapshot.

**What is NOT important (scope exclusions):**
- **Approvals** — routing, thresholds, approver UI, self-approval prevention: project configuration (Workflows + mutation guards). This spec delivers data, events and guard hooks.
- **Manual markups** — never above standard (D3).
- **List-price computation and price-rule semantics** — unchanged; rules only write the shared adjustment record (Q9, user-confirmed). Rule time windows / calendar dates stay separate (C16).
- **Usage charges** — not manually adjustable (D2).
- **Customer-facing quote documents and the portal.**
- **Freezing line edits / rule re-pricing during approval** — signalled by the snapshot hash, not prevented (U5).
- **Merge-renew price propagation** — logged U14; reconciliation reports drift.
- **The first partial cycle after activation** — pre-existing behaviour kept (U3).

#### Checklist
- [x] Primary goal stated with measurable outcome
- [x] Scope exclusions listed

### 1.3 Ubiquitous Language

| Term | Definition | Source of data | Period |
|------|-----------|----------------|--------|
| Charge | One priced component of a quote line, **identified** by its catalog `chargeCode` and **classified** by `chargeType`: `nrc`, `mrc`, `usage`. A line can carry several charges of one type. | CPQ engine (`ResolvedCharge`) | — |
| Charge model | `flat`, `per_unit`, `volume`, `tiered`. | `CpqProductCharge.chargeModel` | — |
| List price | Catalog price before any adjustment. | CPQ engine | — |
| Price rule | Catalog-level adjustment granted by default to every matching quote; may lower or raise the price. | `CpqPriceRule` | — |
| Standard price | List price after all matching price rules. | CPQ engine | — |
| Manual adjustment | Price change on one quote: `discount_percent`, `discount_absolute` (off the per-instance charge total) or `price_override` (new unit price). Never above standard. Two classes: **rep-created** and **carried-over**. | quote | permanent or window |
| Carried-over adjustment | A manual adjustment the system re-creates on a re-priced Amend mirror line from the source item's manual adjustment: same type, value, window and reason, at charge level, with the source item's state hash. | ARC amend | remaining window |
| Adjustment level | **charge** (line + `chargeCode`), **line** (its charges, optionally one charge type; cascades to bundle child lines), **quote** (all eligible lines, optionally one charge type). | Sales rep | — |
| Eligible line | A line that can receive line- / quote-level adjustments: engine-priced (has offering / product) and not frozen. | derived | — |
| Price adjustment | One step between list and offer price, origin `rule` or `manual`, recorded in one shape on the charge. | engine + quote | — |
| Price waterfall | list → rule adjustments → standard → at most one manual adjustment per charge per month → offer. | derived | — |
| Offer price | Price quoted to and paid by the customer; for MRC it can differ per window. | derived | per window |
| Regular price | MRC offer price outside every bounded window. Held in the existing `unitPrice` / `totalPrice` / `mrcTotal` / `mrcAmount` (unchanged meaning without bounded windows). | derived | after the last window |
| Contracted price | The offer price in force on a subscription item, per its charges / schedule. | subscription item | dated |
| Current price | Contracted price on a given date. | derived | a date |
| Price start date | Date a line's price takes effect: the activation date of a new item, or the ARC effective date for an added / re-priced item. Column `price_start_date` on subscription items (Phase 3). | activation / ARC apply | date |
| Provisional anchor | The date used to evaluate absolute windows while a quote is not yet activated: today. Replaced by the real price start date at activation. | quote | date |
| Price month | Month *n* from the price start date (calendar arithmetic, end-of-month clamping). | derived | months |
| Price window | Relative `[fromMonth, toMonth]` (rep-created) or absolute `[fromDate, toDate]` (carried-over only). `toMonth` / `toDate` null = open-ended; `[1, null]` = permanent; an end = **bounded**. One window kind per charge. | Sales rep / system | months or dates |
| Price schedule | Contiguous segments (window → offer) for an MRC charge with bounded windows; last segment open-ended = regular price. The **item schedule** merges all MRC charges of an item (union of boundaries, sum of prices × line quantity). Dates materialised at activation. | derived | dates |
| Frozen mirror line | An engine-priced mirror line on an **Amend** quote that keeps the source item's stored waterfall (no engine call) until the rep changes its configuration, quantity, or adds an adjustment. | ARC amend | — |
| Changed line | On an ARC quote: a non-mirrored line, or a mirror line whose recurring offer price or schedule differs from the source item. Only changed lines enter deal value and `modifiedItems`. | derived | — |
| Re-rate | Replacing a subscription item's billed recurring price from its billing-effective date: end-date the open recurring billing items the day before, create new ones. | connector | date |
| Billing-effective date | The first billing-cycle start on or after a nominal price-change date (re-rate effective date or schedule boundary) that is not already billed. Price changes are billed per whole cycle — no mid-cycle prorations for price changes. | connector | date |
| Deal value | NRC + Σ monthly offer prices over the horizon (`termMonths`, else max(12, last bounded window end)); usage excluded; list / standard / offer; changed lines only on ARC quotes. | derived | horizon |
| Discount depth | Signed fraction `1 − after / before` (null when `before = 0`; negative = markup): rule (standard vs list), manual (offer vs standard), total (offer vs list); per line and quote; `maxLineManual`. | derived | horizon |
| Invalid adjustment | A stored manual adjustment that cannot apply: target missing / ambiguous, override above standard, currency mismatch, window beyond term, or source item changed since carry-over. Skipped for its months; resolution falls back to the next valid adjustment, else standard; line `incomplete`. | derived | — |
| Adjustment lock | No create / change while `cpqStatus ∉ {new, incomplete, ready}` or an order exists for the quote; deleting an invalid adjustment stays allowed in non-terminal statuses. Standard prices and line edits are not frozen. | quote | — |
| Pricing snapshot hash | Hash of the priced state (per charge offer / standard / schedule + adjustment set) in `pricingSummary` and events. | derived | — |
| Adjustment reason | Code from the tenant dictionary `cpq.price_adjustment_reason` + optional note. | Sales rep | — |

#### Checklist
- [x] Every domain term defined once
- [x] Same word = same meaning everywhere
- [x] Source of data and period specified

### 1.4 Domain Model

#### 1.4.1 Core idea — one waterfall, two origins

A price rule is an adjustment the engine grants by default; a manual adjustment is one a sales rep grants on one quote. Both run through **one evaluation** and land in the **same adjustment record** on the charge, tagged by origin.

```
List price ──(price rules: origin=rule, sortOrder, unchanged)──▶ Standard price
           ──(≤ 1 manual adjustment per charge per price month: origin=manual)──▶ Offer price (per window)
```

Manual adjustments are **inputs** (own table); the waterfall is **output**, recomputed on every recalculation. Same inputs → same outputs.

**Aggregate:** `CpqQuoteConfiguration` is the aggregate root of a quote's pricing. **Every price-affecting write** — adjustment create / change / delete, line add / edit / remove, saved recalculation, clone, carry-over, status transition — locks its row and increments `pricing_revision`. Clients may send `expectedRevision`; a mismatch → `409`.

#### 1.4.2 Entities and ownership

| Entity / data | Owner | Created by | Read by | Updated by |
|---|---|---|---|---|
| `CpqQuotePriceAdjustment` (new table) | cpq | rep (API / UI); system on clone and carry-over | pricing service, UI, clone, conversion guard | rep while not locked; soft-deleted with line / quote |
| `CpqQuoteConfiguration.pricing_revision` (new column) | cpq | system | all price-affecting writes | system |
| `ResolvedCharge` waterfall fields (jsonb, additive) | cpq | pricing service | UI, events, connector | system |
| `pricingSummary` additions (jsonb) | cpq | pricing service | UI, events | system |
| `CpqInventorySubscriptionItem.price_start_date` (new column, Phase 3) | cpq | activation / ARC apply | schedule dates, carry-over, connector | system |
| Order line / subscription item `charges` | cpq | copied at conversion / activation (+ dates at activation) | UI, ARC, connector | system |
| Billing items per item segment | billing (via connector) | connector | bill runs | connector |
| Dictionary `cpq.price_adjustment_reason` (visible) | dictionaries | `cpq/setup.ts` per tenant | adjustment form | tenant admin (docs-only, U7) |

#### 1.4.3 `CpqQuotePriceAdjustment` — fields

Table `cpq_quote_price_adjustments`; standard columns `id` (uuid PK), `organization_id`, `tenant_id` (uuid, required, indexed), `created_at`, `updated_at`, `deleted_at`.

| Field | Type | Multi | Required | Rules |
|---|---|---|---|---|
| `quote_configuration_id` | uuid (FK string) | no | yes | no ORM relation |
| `quote_id` | uuid (FK string → `sales_quotes.id`) | no | yes | denormalised |
| `level` | select `charge` \| `line` \| `quote` | no | yes | |
| `quote_line_id` | uuid (FK string → `sales_quote_lines.id`) | no | for `charge`, `line` | same quote |
| `charge_code` | text | no | for `charge` | must resolve to exactly one charge on the line |
| `charge_type_filter` | select `nrc` \| `mrc` | no | no | `line` / `quote` only; null = both |
| `adjustment_type` | select `discount_percent` \| `discount_absolute` \| `price_override` | no | yes | `line` / `quote`: `discount_percent` only; `price_override` only on `flat` / `per_unit` |
| `value` | numeric(18,4) | no | yes | % 0 < v ≤ 100; amount > 0 (per instance, per month for MRC / once for NRC); override ≥ 0 (unit) |
| `currency_code` | text (ISO 4217) | no | for amount / override | = quote currency |
| `window_kind` | select `relative` \| `absolute` | no | yes (default `relative`) | `absolute` only for carried-over rows |
| `from_month` / `to_month` | integer / integer | no | relative: `from_month` (default 1) | `to_month` null = open; ≥ `from_month`; ≤ `termMonths` when set |
| `from_date` / `to_date` | date / date | no | no | absolute only; `to_date` null = open |
| `reason_code` | text (dictionary entry) | no | yes | carry-over keeps the source code |
| `reason_note` | text ≤ 500 | no | when `reason_code = other` | |
| `carried_from_subscription_item_id` | uuid (FK string) | no | carried-over only | |
| `carried_from_item_hash` | text | no | carried-over only | source item state hash at carry-over (R8 `SOURCE_CHANGED`) |
| `created_by_user_id` / `updated_by_user_id` | uuid / uuid | no | `created_by` yes | |

Indexes: `(organization_id, tenant_id, quote_configuration_id)`, `(organization_id, tenant_id, quote_line_id)`.

#### 1.4.4 Waterfall output (jsonb, additive)

`ResolvedCharge` gains `listUnitPrice` / `listTotalPrice`, `standardUnitPrice` / `standardTotalPrice` (legacy charges: read helper from `adjustments[0].unitPriceBefore`, else current price); `unitPrice` / `totalPrice` stay = regular offer; `schedule` (MRC with bounded windows: `[{ fromMonth, toMonth, fromDate?, toDate?, unitPrice, totalPrice, adjustmentId }]`); `adjustments[]` entries gain `origin`, and manual entries `adjustmentId`, `class: 'rep' | 'carried'`, `level`, `windowKind`, `fromMonth`, `toMonth`, `fromDate`, `toDate`, `reasonCode`; `adjustmentErrors[]` with codes.

`pricingSummary` gains `listNrcTotal`, `listMrcTotal`, `standardNrcTotal`, `standardMrcTotal`, `ruleDiscountTotal`, `manualDiscountTotal`, `dealValue {list, standard, offer}`, `discountDepth {rule, manual, total, maxLineManual}`, `hasTimeBasedAdjustments`, `snapshotHash`; `discountTotal` keeps today's meaning and formula (rule savings, deprecated); `ruleDiscountTotal` and `manualDiscountTotal` both include the line quantity (§8).

Mirror-line marker in line configuration: `_arcPriceFrozen: true` (alongside the existing `_arcMirrored*` markers).

#### 1.4.5 Business rules

- **R1 Resolution.** Per charge and price month, the first valid match in this order applies: rep-created `charge` > rep-created own `line` > rep-created nearest ancestor `line` (bundles) > **carried-over** (charge level) > rep-created `quote`. Never compounded. Example: quote 10% permanent + line months 1–3 at 50% on MRC → months 1–3: 50%, month 4+: 10%. A rep's quote-wide discount never replaces a customer's carried-over contracted discount.
- **R2 Application.** Applied to the standard price with the matching rule formula (C3); floored at 0; line quantity multiplies afterwards (% and override scale with quantity, amount-off stays per instance).
- **R3 No markup.** An override above the current standard is invalid (R8).
- **R4 Windows.** Bounded windows only on MRC (charge-level MRC, or line / quote with `charge_type_filter = mrc`); NRC permanent; one window kind per charge.
- **R5 Regular price** = offer for the month after the last bounded window touching the charge.
- **R6 Deal value & depth** per §1.3.
- **R7 Adjustment lock** per §1.3; saved recalculation (`save:true`) and line edits are refused in terminal statuses (`409`) so an accepted quote's stored snapshot cannot change.
- **R8 Invalid adjustments** (missing / ambiguous target, above standard, currency, beyond term, `SOURCE_CHANGED`) are kept, skipped for their months with fallback (§1.3), flagged with a code, and make the line `incomplete`. Conversion uses the **stored** snapshot and is refused (`422`) while it contains an invalid adjustment; the way out on an accepted quote is moving it back to `ready`, fixing, re-accepting. ARC activation is refused (`409`) when a carried-over adjustment's source item hash no longer matches.
- **R9 ARC.** **Amend:** engine-priced mirror lines start **frozen**; a change of configuration / quantity or a new adjustment re-prices the line at today's standard and re-creates the source item's manual adjustments as carried-over (original type, value, window, reason; charge level). **Renew** (Q8, user-confirmed): mirror lines are always re-priced at today's standard; no carry-over; `ArcLineDiff` shows the previous contracted price. **Cancel:** no adjustments. **Free-form mirror lines:** always frozen, accept no adjustments. Line / quote levels apply to **eligible lines** only. **Rollout rules:** frozen Amend mirror lines ship in Phase 1 (carry-over in Phase 2); until Phase 2, **ARC mirror lines (Amend and Renew)** accept no manual adjustments (`LINE_NOT_ELIGIBLE` — `modify` price changes reach inventory but not billing, C13); new `add` lines on ARC quotes are adjustable (they reach billing as added items); `modifiedItems` are emitted only for ARC quotes created with the frozen-line scheme (post-Phase-1) — older in-flight ARC orders keep today's behaviour.
- **R10 Absolute windows** are evaluated against the provisional anchor on the quote and clipped at the real effective date at activation (segments ending before it are dropped).
- **R11 Clone** copies all non-deleted adjustments (new ids, remapped lines, inactive reasons kept); line removal soft-deletes its adjustments.
- **R12 Permission.** Writes need `cpq.quotes.manage` + `cpq.quotes.adjust_price` (default `admin`, `employee`).
- **R13 Calculate-price API** never applies manual adjustments; list / standard fields are returned only on request (`includeWaterfall: true`), `origin: 'rule'` is additive — anonymous storefront proxies (Puffin) get no new data by default.
- **R14 Billing translation (connector).**
  - **Rate per cycle** = monthly price × months per cycle (quarterly 3, annual 12, weekly 12/52) for every billing item the connector creates; existing items keep their rate (U12).
  - **Activation:** one recurring billing item per item segment (item schedule) at the segment rate; segment 1 starts at activation (today's behaviour, U3), every later segment boundary is moved to its **billing-effective date**. No prorations.
  - **Re-rate** (`modifiedItems`, nominal date E; renew: E = max(`newTermStart`, `oldTermEnd` + 1)): B = billing-effective date of E; end-date the item's open **recurring** items at B − 1 (never later than an existing end date; future, never-billed items are deleted); create new items from B. No prorations and no difference items — already-billed cycles are never touched. NRC is never re-billed. (Added and removed items keep today's amend behaviour.)
  - **End dates are never moved later**, except renew extending items whose end date equals `oldTermEnd`.
- **R15 sourceRef grammar:** activation segment 1 `cpq-<sub>-<item>-<type>` (unchanged), segment n ≥ 2 `…-<type>-s<n>`; re-rate `…-<type>-<changeLogId>-s<n>`.

#### 1.4.6 Invariants

| # | Invariant |
|---|---|
| I-1 | Every manual adjustment belongs to one quote; its target line to the same quote. |
| I-2 | Same class + same level adjustments that can match the same charge never overlap (checked under the aggregate lock). |
| I-3 | Per charge and price month at most one manual adjustment applies. |
| I-4 | `0 ≤ offer ≤ standard` wherever a valid manual adjustment applies. |
| I-5 | A schedule is contiguous from month 1, no overlaps, last segment open = regular price. |
| I-6 | Recalculation is idempotent; frozen and free-form lines never re-apply adjustments. |
| I-7 | Order lines and subscription items carry the quote line waterfall verbatim, except activation-time date materialisation and window clipping. |
| I-8 | **Money (eventually consistent after connector processing):** for every item and billing cycle, billed recurring amount = the contracted price in force at the cycle's start × months per cycle; price changes take effect at their billing-effective date (except the first partial cycle, U3). |
| I-9 | A quote without manual adjustments prices identically before and after this capability. |
| I-10 | No adjustment is created or changed while locked (except deleting invalid ones). |
| I-11 | An invalid adjustment is never silently dropped, capped or applied elsewhere. |
| I-12 | The connector never moves a billing item's end date later, except renew extending items that end exactly at `oldTermEnd`. |
| I-13 | **(eventually consistent)** Billing matches CPQ for added, removed and changed items after every activation / amend / renew / cancel; drift is detectable by reconciliation (US-2.5). |

#### 1.4.7 Domain events (after commit, outside `withAtomicFlush`; signals — stored snapshot is authoritative)

| Event id | When | Payload (beyond tenant / org) |
|---|---|---|
| `cpq.quote.pricing_changed` (new) | a save changes `snapshotHash`; one per save; never from previews; a legacy quote's first hash is a silent baseline unless offers change | `quoteId`, `cpqStatus`, `quoteType`, `currencyCode`, `pricingRevision`, `snapshotHash`, `dealValue`, `discountDepth`, `hasTimeBasedAdjustments`, `cause: 'adjustment' \| 'line' \| 'recalculate' \| 'carry_over' \| 'clone'` |
| `cpq.quote.status_changed` (new) | every `cpqStatus` change, manual or automatic | `quoteId`, `fromStatus`, `toStatus`, `cause: 'manual' \| 'auto'`, `actorUserId`, `quoteType` + pricing snapshot — **approval hook** |
| `cpq.subscription.activated` (existing) | — | recurring charges gain optional item `schedule` with dates (Phase 3) |
| `cpq.subscription.amended` / `.renewed` (existing) | — | gain `changeLogId`, `modifiedItems[] { subscriptionItemId, productName, recurring rate or schedule, effectiveDate }` (changed lines only, recurring only; Phase 2; schedules Phase 3); renewed gains `oldTermEnd` |

#### 1.4.8 Access control

| Action | Feature |
|---|---|
| See waterfall, schedule, adjustments | `cpq.quotes.view` / `cpq.orders.view` / `cpq.inventory.view` |
| Create / change / delete adjustments, preview | `cpq.quotes.manage` + `cpq.quotes.adjust_price` (new) |
| Recalculate (the UI always saves) | `cpq.quotes.manage` (tightened from `view`, C11) |
| Price rules | `cpq.pricing.manage` |
| Approve / block | project workflow + mutation guard |

#### Checklist
- [x] Entities with ownership
- [x] Rules, invariants, calculations
- [x] Access control
- [x] Data ownership
- [x] Fields precise

---

## 2. Identity Model `PM`

| Persona | Role key | Identity | Org scope | Sees | Does |
|---------|----------|----------|-----------|------|------|
| Sales rep | `employee` | internal | own organization | quotes, waterfall, schedules | creates / edits manual adjustments on unlocked quotes |
| Sales manager / deal desk | `admin` (or role with `cpq.quotes.view`; editing needs `cpq.quotes.manage` + `cpq.quotes.adjust_price`) | internal | own organization | depth, reasons | reviews; approves via project workflow |
| Pricing admin | role with `cpq.pricing.manage` | internal | own organization | rule vs manual split | maintains price rules |
| Billing operator | role with billing features | internal | own organization | dated billing items, reconciliation report | runs bill runs, reconciliation |
| Project implementer | `admin` | internal | tenant | events | configures workflows / guards |

**Portal decision:** NOT USED — the customer does not act here, and list / standard prices are internal. One identity system (staff auth + RBAC features).

#### Checklist
- [x] One identity type per persona `PM`
- [x] Justified `PM`
- [x] No dual accounts `Architect`
- [x] Org scoping `Architect`
- [x] Portal decision justified `PM`

---

## 3. Workflows `PM`

### WF1: Negotiate the price on a quote

**Journey:** rep builds the quote → opens a charge, a line or the quote summary → grants % / amount off / new unit price, permanent or for a window, with a reason → preview → save → offer, schedule, deal value, depth update → quote `ready` → accepted.

**ROI:** ≥ 95% of won quotes with a non-standard price priced in CPQ (today 0%); a 10-line quote discounted in 1 action (quote level).

**Personas:** sales rep; sales manager.

**Boundaries:** starts when a line has engine-resolved charges; ends when the quote is accepted with offers and schedules stored. NOT: billing (WF2), ARC (WF3), approval decisions.

**Edge cases:** (1) configuration change removes the adjusted charge → invalid, conversion refused; (2) standard drops below an override → invalid; (3) two reps edit → aggregate lock / `409`; (4) quantity change after amount-off → per instance, "× qty"; (5) bundle parent without own charges → line discount cascades.

**Platform readiness:**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Engine prices the line | CPQ engine | no | grounded |
| List / standard capture | — | yes | C2 |
| Store adjustments | — | yes | own table |
| One waterfall | rule formulas | partial | C3 |
| Preview | `recalculate(save:false)` | partial | saved state only |
| Permission | RBAC | config | grounded `cpq/acl.ts`, `cpq/setup.ts:20` |
| Reasons | dictionaries | config | seeding grounded `billing/setup.ts:74-107`; admin editing docs-only |
| UI | quote page + dialogs | yes | |

### WF2: Bill the contracted price

**Journey:** accepted quote → conversion (stored snapshot; refused while invalid) → order and subscription carry the waterfall → activation (Phase 3: price start date, schedule dates) → activation event → connector creates billing items at per-cycle rates (Phase 3: one per item segment + boundary prorations) → invoices follow the contracted price → reconciliation confirms.

**ROI:** 0 manual billing corrections for negotiated / promotional prices; billing operator time per promo deal → 0 (today a manual credit every promo month).

**Personas:** billing operator, system.

**Boundaries:** starts at conversion; ends when every cycle has been billed at the contracted price. NOT: ARC (WF3), usage, the first partial cycle (U3).

**Edge cases (main path first):** (1) segment boundary inside a cycle — the normal case, any cycle kind → boundary moved to the billing-effective date; (2) event lost after commit → reconciliation + replay; (3) redelivered event → `sourceRef` dedupe; (4) segment 2 creation fails → retry creates only segment 2; (5) no billing account → subscriber throws → persistent retry.

**Platform readiness:**

| Step | Platform capability | Gap? | Notes |
|------|--------------------|------|-------|
| Offer totals → billing | activation + connector | no | grounded C8 |
| Per-cycle rate | connector mapper | yes | C8 / U12 |
| Price start date, schedule dates | — | yes | Phase 3 |
| Segment items | `BillingItem` dates, `sourceRef` | partial | R15 |
| Billing-effective date | `cycleContaining` | partial | grounded amend subscriber; U6 |
| Reconciliation | — | yes | C14 |

**Decision — segments vs credits:** the billing spec's negative `one_time` discount (C8) would keep the regular item and post one prorated credit per promo cycle. Rejected: an item per cycle, voiding on cancel / amend, positive "credits" for non-monotonic schedules. Dated recurring segments keep each invoice line at the actual price.

### WF3: Keep or change the contracted price through Amend and Renew

**Journey (amend):** Amend quote → engine-priced mirror lines frozen at the contracted price → rep changes what the amendment is about; touched lines are re-priced and the source's manual adjustments carried over (rep may add own, which win) → activation (stale carry-over refused; absolute windows clipped) → `modifiedItems` (changed recurring prices only) → connector re-rates.
**Journey (renew):** Renew quote → lines re-priced at today's standard; `ArcLineDiff` shows previous contracted price → rep re-negotiates (WF1) → renewal activation → `modifiedItems` → connector re-rates from E = max(`newTermStart`, `oldTermEnd` + 1).

**ROI:** every price change on a live subscription reaches billing (today none does, C13); no contracted price lost or silently changed on amend.

**Personas:** ARC operator (sales rep).

**Boundaries:** starts when an Amend / Renew quote mirrors items; ends when billing items match. NOT: cancel quotes (existing), merge-renew (U14).

**Edge cases:** (1) untouched mirror lines → frozen, not in `modifiedItems`; (2) another ARC change activates on the same subscription first → carried-over adjustments `SOURCE_CHANGED`, activation refused; (3) carried-over override above new standard → invalid, rep decides; (4) effective date inside an already-billed cycle → new price from the first unbilled cycle; (5) renew `newTermStart` = old term end → E shifted by one day.

**Platform readiness:** ARC mirror (grounded); `ArcLineDiff` (grounded, 0 commits); gaps: frozen lines, carry-over, `modifiedItems`, connector re-rate, end-date rules.

### WF4: Route a discounted quote for approval (project-configured)

**Journey:** price change → summary / depth / hash recomputed → `pricing_changed` when the hash changed → rep submits → `status_changed` with snapshot → project workflow (`filterConditions` on `discountDepth.manual`) creates a `USER_TASK`; project mutation guards on status / conversion routes can block → adjustments locked while out of `ready`.

**ROI:** approval setup on a customer project = configuration only, 0 CPQ commits (today impossible: no events, no guard calls, C15).

**Personas:** sales manager, project implementer.

**Boundaries:** starts on price / status change; ends when the event is delivered and guards consulted. NOT: approval logic.

**Edge cases:** (1) no-op recalculation → no event; (2) line edit after approval (C11) → `pricing_changed` with `cpqStatus = approved`, new hash; (3) crash between commit and emit → guards read stored hash / status; a lost `status_changed` leaves no task → project workflow timer (recipe); (4) `ready → approved` jump → `status_changed` + project guard; (5) automatic `ready → incomplete` → `status_changed` with `cause: 'auto'`.

**Platform readiness:** `createModuleEvents` (grounded); Workflows (docs-only); mutation guards (docs-only, zero call sites — C15).

#### Checklist (per workflow)
- [x] End-to-end journey `PM`
- [x] Measurable ROI `PM`
- [x] Boundaries `PM`
- [x] 3–5 edge cases `PM`
- [x] Steps mapped `Architect`

#### Checklist (overall)
- [x] 3–7 workflows `PM`
- [x] > 200-line workflows re-checked — no platform capability prices CPQ charges or re-rates billing items; sales `AdjustmentKind`, billing credits and "update rate in place" rejected (§4.5) `Architect`

### Production reality check

| Workflow | Runs end to end? |
|---|---|
| WF1 | Yes with WF2's existing totals path (Phase 1). |
| WF2 | Permanent prices: yes (Phase 1, monthly accounts; per-cycle fix Phase 2). Schedules: only when quote side and connector ship together (Phase 3). |
| WF3 | Phase 1 ships frozen Amend mirror lines (untouched items keep their contracted price in CPQ inventory); lines the rep reconfigures are re-priced as today, with a banner that manual prices are not carried over yet; ARC mirror lines (Amend and Renew) accept no manual adjustments yet. Billing is unaffected in Phase 1 (`modify` does not reach billing). Carry-over and billing propagation complete WF3 in Phase 2. |
| WF4 | Phase 1 (signals + guard hooks). |

---

## 3.5 UI Architecture `PM + UX`

### Navigation
No new sidebar items. Sales: CPQ → Quotes. Pricing admin: CPQ → Price Rules. Tenant admin: dictionaries (adjustment reasons). Billing operator: reconciliation is a CLI report in this scope.

### Dashboard Widgets
None.

### Custom Pages (changes on existing pages)

| Page | URL pattern | Role | Change | Building block |
|------|------------|------|--------|----------------|
| Quote detail | `/backend/cpq/quotes/[id]` | rep / manager | Line row: List, Offer, signed depth badge, `promo` badge. `ChargeBreakdown`: waterfall rows, each showing its source (rule code / name, or adjustment reason + author) and delta, plus schedule table. Actions: **Adjust price** (charge), **Discount line**, **Discount quote** (summary card, Phase 4). Summary: list / standard / offer deal value, rule / manual / total depth. **Price adjustments** panel (level, target, type, value, window, reason, author, date; edit / delete; badges `Invalid: <reason>`, `Carried over`, `Frozen`). Locked: tooltip "Adjustments are locked in status X — move the quote back to Ready to change them"; invalid adjustments keep delete. No permission: read-only. ARC Phase-1 banner (WF3 workaround). | existing page + dialogs |
| Adjust price dialog | dialog | rep | Type (filtered by level and charge model), value, period (Whole term / First N months / Custom — MRC, Phase 3), reason, note. Live preview via the preview endpoint; `Cmd/Ctrl+Enter` save, `Esc` cancel; navigating away stores nothing; `409` → "Prices changed, reload". | dialog |
| Order detail | `/backend/cpq/orders/[id]` + `order-cpq-tab` | sales / ops | Read-only waterfall; schedule dates once activated. | existing |
| Subscription item | `/backend/cpq/inventory/...` | sales / ops | Contracted, current and regular price; "promo until <date>" (Phase 3). | existing |
| ARC line diff | `ArcLineDiff` | ARC operator | Existing: previous contracted price vs new (0 commits). | existing |

`CpqQuotePriceAdjustment` has no standalone page: a child of the quote (like `CpqQuoteLineConfiguration`), listed in the panel, with injection slot `data-table:cpq.quote_price_adjustments`.

### Key User Flows

| Persona | Task | Flow | Clicks |
|---------|------|------|--------|
| Sales rep | Override a charge price | CPQ → Quotes → quote → expand line → Adjust price → Save | 3 to dialog |
| Sales rep | 3-month promo on a line | … quote → line ⋯ → Discount line → First 3 months → Save | 3 to dialog |
| Sales rep | Discount the quote | … quote → Discount quote → Save | 2 to dialog |
| Sales manager | Check depth | CPQ → Quotes → quote | 2 |

### Empty States

| Page/Widget | Message | Action |
|-------------|---------|--------|
| Price adjustments panel | "No manual price adjustments. Prices follow the catalog and price rules." | Adjust price on a charge |
| Schedule table | hidden without bounded windows | — |

#### Checklist
- [x] Login-to-task flow per persona `PM`
- [x] Navigation grouping `UX`
- [x] Widgets — none `UX`
- [x] Empty states `UX`
- [x] Platform building blocks `Architect`
- [x] ≤ 3 clicks `UX`

---

## 4. Workflow Gap Analysis `Architect`

Atomic commits; scope `app` = packages in this repo; evidence `grounded` (repo source) or `docs-only` (`.ai/guides`, U1). Phase numbers per §7.

#### WF1: Negotiate the price on a quote — Total: 19

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Waterfall capture + legacy read helper | CPQ engine | 2 | cpq | 1 | 1 | grounded |
| Entity + migration + validators + `pricing_revision` | — | 3 | cpq | 1 | 1 | |
| Resolution (classes, levels, bundles, models, invalid) | rule formulas | 3 | cpq | 1 | 1 | |
| Application, summary, depth, hash | — | 2 | cpq | 1 | 1 | |
| Transaction / lock refactor: one `em.transactional` per price-affecting write, pessimistic write lock on the quote configuration (incl. conversion), post-commit events | quoting / order services | 3 | cpq | 1 | 1 | grounded: no transactional usage in CPQ today |
| Integration + terminal recalc refusal + recalculate requires `cpq.quotes.manage` | quoting service, route metadata | 2 | cpq | 1 | 1 | grounded C4, C11 |
| Adjustments API (CRUD, lock, revision, guards, `openApi`) | CPQ route style | 2 | cpq | 1 | 1 | |
| Preview endpoint | `save:false` path | 2 | cpq | 1 | 1 | grounded |
| ACL + visible reasons dictionary | RBAC, dictionaries | 1 | cpq | 1 | 1 | seeding grounded; editing docs-only |
| Clone, removal, conversion guard | clone / conversion | 2 | cpq | 1 | 1 | grounded |
| UI waterfall + badges | quote page | 2 | cpq | 1 | 1 | |
| UI dialog | dialogs | 2 | cpq | 1 | 1 | |
| UI panel + lock states + ARC banner | — | 2 | cpq | 1 | 1 | |
| Order / subscription display | existing pages | 1 | cpq | 1 | 1 | |
| Windows validation + schedule | — | 3 | cpq | 2 | 3 | |
| Window UI | dialog | 1 | cpq | 1 | 3 | |
| Quote level + dialog | — | 2 | cpq | 2 | 4 | |

#### WF2: Bill the contracted price — Total: 9

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Offer totals → billing | activation + connector | 0 | — | 0 | 1 | grounded C8 |
| Per-cycle rate conversion (U12) | `chargeMapper` | 1 | connector | 1 | 2 | grounded `invoiceWriter.ts:220` |
| Reconciliation report + replay; no-account throws | — | 3 | connector | 2 | 2 | |
| `price_start_date` + schedule dates at activation | inventory | 2 | cpq | 1 | 3 | |
| Activation / added payload item schedules | CPQ events | 1 | cpq | 1 | 3 | |
| Segment items + `sourceRef` | `BillingItem` | 2 | connector | 1 | 3 | grounded |
| Current / regular price display | subscription page | 1 | cpq | 1 | 3 | |
| Cancel deletes future never-billed segments | cancel subscriber | 1 | connector | 1 | 3 | billing items CRUD `DELETE` |
| Reconciliation understands segments | Phase-2 CLI | 1 | connector | 1 | 3 | |
| Windows gated by feature toggle `cpq.price_windows` | `feature_toggles` module | 1 | cpq | 0 | 3 | in window-validation commit; docs-only |

#### WF3: Keep or change the price through ARC — Total: 8

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| Frozen mirror lines (amend) + ARC mirror-line eligibility block (Phase-1 rule) | ARC mirror | 2 | cpq | 1 | 1 | grounded `cpqQuotingService.ts:2480-2546` |
| Carry-over (original type, hash, `SOURCE_CHANGED`, activation refusal) | — | 2 | cpq | 1 | 2 | |
| `modifiedItems` (diff-based, recurring-only), `changeLogId`, `oldTermEnd` | CPQ events | 2 | cpq | 1 | 2 | grounded C13 |
| Re-rate at the billing-effective date: end-date open recurring + new items + `sourceRef`; renew E rule | items API, `cycleContaining` | 2 | connector | 1 | 2 | U13 decided |
| Renew extension only at `oldTermEnd`; never-later rule (renew, amend) | renewed / amended subscribers | 2 | connector | 1 | 2 | |
| Cancel never moves an earlier end date later | cancel subscriber | 1 | connector | 1 | 2 | grounded `cpq-subscription-cancelled.ts:54-63` |
| Absolute-window carry-over + clip at activation | — | 2 | cpq | 1 | 3 | |
| `modifiedItems` schedules (connector) | — | 1 | connector | 1 | 3 | split from cpq payload commit |

#### WF4: Route a discounted quote for approval — Total: 4

| Step | Platform capability | Gap | Scope | Commits | Phase | Notes |
|------|--------------------|-----|-------|---------|-------|-------|
| `pricing_changed` + `status_changed` (manual + auto) | `createModuleEvents` | 2 | cpq | 1 | 1 | grounded |
| Mutation guards + `openApi` on status, items, recalculate, convert | mutation guards | 3 | cpq | 2 | 1 | docs-only; zero call sites |
| Approval workflow | Workflows | 0 | — | 0 | — | docs-only; project config |
| Manual + approval recipe | — | 1 | docs | 1 | 1 | |

Plus demo seed (US-0.2): 1 commit Phase 1, extended in Phase 3 (counted in the window UI commit).

### Gap Summary

| Workflow | Priority | Commits (raw) | Workaround? | Commits (effective) | Blocks ROI? |
|----------|----------|---------------|-------------|---------------------|-------------|
| WF1 | P1 | 19 | quote level → per-line until Phase 4 | 19 | yes |
| WF4 | P1 | 4 | none | 4 | secondary goal |
| WF3 | P1 / P2 | 8 | Phase 1: frozen lines + re-apply banner; Renew lines not adjustable | 8 | price continuity |
| WF2 | P1 / P3 | 9 | permanent prices bill today | 9 | promos, non-monthly accounts |

Commit plans: [`app-spec-notes/commits-WF.md`](app-spec-notes/commits-WF.md).

#### Checklist
- [x] Every step scored `PM`
- [x] Architect checkpoint #1 — re-mapped (`architect-checkpoint-1.md`) `Architect`

---

## 4.5 Module Architecture `Architect`

### Platform capabilities used

| Capability | Usage | Extension points | Notes |
|-----------|-------|------------------|-------|
| RBAC features | extend | `acl.ts` + `setup.ts defaultRoleFeatures` | `cpq.quotes.adjust_price` |
| Dictionaries | as-is | per-tenant seed, visible | `cpq.price_adjustment_reason` |
| Events | extend | `cpq/events.ts` | 2 new ids, 3 payload extensions |
| Mutation guards | as-is | `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` | first call sites in CPQ |
| Workflows | as-is (projects) | event triggers, `USER_TASK` | not used by CPQ code |
| Sales quote / line | as-is | `unitPriceNet` = offer (unchanged) | sales discount fields stay 0 (D6, U2) |
| Billing items | as-is | items API: create, update end date, delete | no billing package change |

**Rejected alternatives:**
- Sales `AdjustmentKind` adjustments — no charge / month dimension; CPQ owns line pricing; two sources of truth.
- Billing per-cycle negative credits for promotions — see WF2 decision.
- Re-rate by updating `rateJson` in place + one signed correction — works only for an effective date of today; cannot express future-dated renewals or schedule segments; one mechanism (end-date + new items) for every case.

### Shared modules

| Module | Status | Usage | Extension points | Rationale |
|--------|--------|-------|-----------------|-----------|
| `@dainamite/cpq` | EXISTING | extend | entities, routes, events | generic for every CPQ tenant (D1) |
| `@dainamite/cpq-billing-connector` | EXISTING | extend | subscribers, `chargeMapper`, CLI | re-rate, segments, end-date rules, reconciliation |
| `@dainamite/billing` | EXISTING | use | items API | unchanged |

### App modules
None; demo modules get seed examples only.

#### Checklist
- [x] Capabilities with usage + extension points `Architect`
- [x] Trace to workflows / stories `Architect`
- [x] Shared modules listed `Architect`
- [x] No `platform`-scoped gap `Architect`
- [x] Reusability `Architect`
- [x] App modules: 0 `Architect`
- [x] No platform modification `PM + Architect`
- [x] Bounded contexts: pricing in CPQ, dated rates in billing, translation in the connector `DDD`

---

## 5. User Stories `PM`

Phases per §7: **P1** new deals + approval signals, **P2** ARC continuity + billing integrity, **P3** time-based prices, **P4** quote-wide.

**Common failure paths for every write story (US-1.1–1.4, 1.7, 1.8):** stale `expectedRevision` → `409`, nothing saved, dialog asks to reload; concurrent write → serialised by the aggregate lock; closing the dialog or navigating away → nothing stored; locked quote → `409`; missing `cpq.quotes.adjust_price` → `403` and read-only UI.

### WF1: Negotiate the price on a quote

**US-1.1 (P1)** As a sales rep, I set a new unit price or take an amount off one charge so that the quote shows the price I negotiated.
Success: offer stored and shown with list and standard; totals, depth and hash update; survives recalculation.
**Happy:** `setup_fee` 100 → Set unit price 80, reason `competitive_match` → offer 80, badge `−20%`, panel row.
**Alternate:** edit to 85 → one `pricing_changed`; delete → standard; per-unit charge 4 × 25 with 20 off → 80 per instance, "× line qty" shown; tiered charge → only % / amount offered.
**Failure:** above standard → `422`, nothing saved; overlapping charge-level → `422`; free-form ARC line → action hidden, API `422`; currency ≠ quote → `422`.

**US-1.2 (P1)** As a sales rep, I give a percentage discount on one charge or a whole line (optionally MRC or NRC only) so that the customer gets the agreed discount.
Success: each matching charge without a more specific valid adjustment shows `standard × (1 − %)`.
**Happy:** line 15% → every charge −15%.
**Alternate:** filter MRC → NRC unchanged; bundle parent → child lines discounted unless they have their own; one charge with a charge-level override keeps it.
**Failure:** 0 or > 100 → `422`; two line-level adjustments both matching MRC → `422`; ARC mirror line → `422 LINE_NOT_ELIGIBLE` in Phase 1; from Phase 2 the line is re-priced first and carry-over applies (US-3.1).

**US-1.3 (P3)** As a sales rep, I discount an MRC charge or a line's MRC for a price window (first N months, or several windows as a ramp) so that the customer gets an introductory or stepped price.
Success: schedule (months → price), regular price after the last window, deal value over the schedule.
**Happy:** 50% for months 1–3 → 1–3: 50, 4+: 100.
**Alternate:** ramp 1–12: 80, 13–24: 90 → three segments; evergreen line → horizon max(12, 24); two MRC charges with different windows → item schedule merges both.
**Failure:** window on NRC → `422`; `to_month` > term → `422`; same-level overlap → `422`; term later shortened → invalid, line `incomplete`.

**US-1.4 (P4)** As a sales rep, I apply a percentage discount to the whole quote (optionally MRC / NRC only, optionally for a window) so that a multi-line deal is discounted in one action, including eligible lines added later.
Success: every eligible line without a more specific valid adjustment shows the discount after the next save; frozen and free-form lines unchanged.
**Happy:** 10% → every eligible line −10%.
**Alternate:** later line → discounted on save; line with its own discount → line wins; Renew quote → all re-priced lines included.
**Failure:** second overlapping quote-level → `422`.

**US-1.5 (P1)** As a sales rep, I see each charge's waterfall so that I can explain the price.
Success: each row shows source (rule code / name, or adjustment reason + author) and delta; rows sum from list to offer.
**Alternate:** no rules / no adjustments → one row; quote from before this capability → list / standard derived; tiered → tier breakdown under list.
**Failure:** invalid adjustment → greyed row with its error, fallback shown.

**US-1.6 (P1)** As a sales rep, I preview an adjustment before saving so that I do not experiment on the live quote.
**Happy:** typing updates offer / depth; nothing stored; no event.
**Alternate:** cancel → no trace.
**Failure:** invalid draft → the error the save would return.

**US-1.7 (P1)** As a sales rep, when an adjustment becomes invalid (charge removed, override above a lowered standard, currency or term change, ambiguous code, source changed) I see it flagged and can delete or replace it so that no negotiated price is silently lost or wrongly billed.
**Happy:** config change → line `incomplete`, badge `Invalid: target missing`.
**Alternate:** delete while `in_approval` → allowed; accepted quote with a stored invalid adjustment → move back to `ready`, fix, re-accept.
**Failure:** convert while invalid → `422` naming the line; edit an invalid adjustment while locked → `409`.

**US-1.8 (P1)** As a sales rep, I clone a quote and keep its adjustments; removing a line removes its adjustments.
**Happy:** clone → identical offers, new ids, `pricing_changed` (`clone`).
**Alternate:** quote-level and inactive-reason adjustments copied.
**Failure:** invalid adjustments copied as invalid.

**US-1.9 (P1)** As a tenant admin, I maintain the adjustment reason list so that reasons match our sales policy.
**Happy:** add `partner_deal` → selectable.
**Alternate:** deactivate a reason in use → existing adjustments keep it, labelled inactive (docs-only: dictionary editing UI, U7).
**Failure:** `other` without a note → `422` on the adjustment.

### WF2: Bill the contracted price

**US-2.1 (P1)** As a billing operator, when an accepted quote with permanent manual prices is converted and activated, the subscription and its billing items carry the offer price so that the first full-cycle invoice equals the quote.
**Happy:** override 80 → order line, item `mrcAmount` 80, billing rate 80 (monthly account); waterfall visible on order and subscription.
**Alternate:** NRC amount off → one-time item at the offer amount.
**Failure:** invalid adjustment → conversion `422`, no order; activation committed but event not queued → subscription active, billing missing → detected by US-2.5.

**US-2.2 (P3)** As a billing operator, a subscription with a price schedule is billed per segment, each price applying from its billing-effective date, without manual action.
**Happy (monthly, anchor 1st):** activation 15 Mar 2027, 50% for months 1–3 on a 100 MRC → nominal boundary 15 Jun moves to 1 Jul → items [15 Mar – 30 Jun] @50, [1 Jul – ∞) @100; April, May, June billed 50; July+ 100 — three billed promo months. (March follows today's activation behaviour, U3.)
**Alternate:** activation on the anchor → boundary already on a cycle start; quarterly account → per-cycle rates 150 / 300, boundary moved to the next quarter start.
**Failure:** segment 2 creation fails → retry creates only segment 2; payload without schedule → single item as today.

**US-2.3 (cancel rule P2; future-segment deletion P3)** As a billing operator, cancelling, renewing or amending a subscription never re-opens ended segments and never bills future segments of a cancelled item.
**Happy:** cancel during the promo → open segment end-dated at the cancel date; future segment deleted (never billed).
**Alternate:** renew after the promo → only items ending at `oldTermEnd` extended.
**Failure:** any attempt to move an earlier end date later → skipped and logged.

**US-2.4 (P3)** As a sales rep or billing operator, I see the contracted, current and regular price and "promo until <date>" on the subscription so that I can answer the customer.
Success: current price equals the schedule segment containing today; dates match the billing items.
**Alternate:** no schedule → current = regular.
**Failure:** pre-Phase-3 subscription → no dates, months shown.

**US-2.5 (P2)** As a billing operator, I run a reconciliation report comparing CPQ subscription items with billing items (by `sourceRef` and rate) and replay missing events so that a lost event never leaves billing silently stale.
**Happy:** report lists 0 drift.
**Alternate:** drift found → `--replay` re-emits the event; `sourceRef` dedupe makes it safe.
**Failure:** no billing account → listed as drift; the subscriber throws (retried) instead of returning silently.

### WF3: Keep or change the price through ARC

**US-3.1 (frozen lines P1; carry-over P2; absolute windows P3)** As a sales rep amending a subscription, untouched lines keep the contracted price, and lines I change keep the customer's manual adjustments (carried over) unless I set new ones, so that the amendment changes only what it is about.
**Happy:** amend adds a port; existing port at 80 stays frozen at 80, not in `modifiedItems`.
**Alternate:** I change the existing port's speed → re-priced at today's standard 120, source 20% carried over → 96, badge `Carried over`; I add my own 25% → mine wins; running promo (P3) → absolute window until its end date, clipped at activation.
**Failure:** another ARC order on the same subscription activates first → `SOURCE_CHANGED`, conversion / activation refused, rep re-creates the quote; carried-over override above the new standard → invalid, rep deletes → standard; free-form line → frozen, no adjustments.

**US-3.2 (P2)** As a sales rep renewing, lines start at today's standard and the diff shows the previous contracted price, today's standard and the delta, so that I re-negotiate knowingly; the renewed price reaches billing.
**Happy:** previous 80, standard 100, I set 90 → renewal activation → billing 90 from E.
**Alternate:** `newTermStart` = old term end → E = next day; I keep 100 → billing 100 from E.
**Failure:** connector fails mid-way → persistent retry, new items created before old ones are end-dated; event lost → US-2.5.

**US-3.3 (P2)** As a billing operator, every recurring price change on a changed item reaches billing exactly once so that CPQ and billing never drift.
**Happy (monthly, anchor 1st):** amend effective 10 May 2027, 80 → 90 → billing-effective 1 Jun: old item ends 31 May, new item from 1 Jun; May billed 80, June+ 90.
**Alternate:** changed line without a recurring price change → not in `modifiedItems`; effective 10 Apr with April already billed → new price from 1 May (first unbilled cycle).
**Failure:** duplicate event → `sourceRef` with `changeLogId` dedupes; NRC never re-billed.

### WF4: Route a discounted quote for approval

**US-4.1 (P1)** As a sales manager, I see list / standard / offer deal value and rule / manual / total depth per line and quote so that I can judge the deal.
**Happy:** quote with one 20% line → manual depth 0.20 on that line, 0.08 on the quote, total depth incl. rules shown.
**Alternate:** surcharge rule → negative rule depth shown as markup; ARC quote → changed lines only.
**Failure:** zero-priced line → "—".

**US-4.2 (P1)** As a sales rep, after I submit a quote (or once an order exists) its adjustments are locked; moving it back to `ready` unlocks them (when no order exists).
**Happy:** `ready → in_approval` → actions disabled with tooltip.
**Alternate:** back to `ready` → editable; `status_changed` lets a workflow cancel its task. Enforcing that what was approved is what is sent requires the project guard (US-4.3).
**Failure:** API write while locked → `409`; order exists → `409` even in `ready`.

**US-4.3 (P1)** As a project implementer, I configure a workflow on `cpq.quote.status_changed` filtered on `discountDepth.manual` and, optionally, mutation guards on the status and conversion routes, so that approvals route and are enforced without CPQ code.
**Happy:** manual depth 0.20 > 0.15 → manager task.
**Alternate:** `pricing_changed` after approval with a new hash → workflow re-opens approval.
**Failure:** event lost → guard reads the stored hash / status; workflow timer catches quotes stuck in `in_approval` without a task (recipe).

### Default User Stories

**US-0.1** As someone evaluating CPQ, I run the documented init / seed and get `admin` and `employee` users so that I can try adjustments with and without `cpq.quotes.adjust_price`. Success: `employee` gets the feature by default; seeding idempotent.

**US-0.2 (P1, extended P3)** As someone evaluating CPQ, the demo tenants contain priced examples so that the waterfall and schedule are visible without setup. Success: GIX "Demo — Acme port upgrade": `setup_fee` override 290 → 250 (`competitive_match`), line 10% on MRC (`strategic_deal`); Puffin "Demo — Globex cloud promo" (P3): compute MRC 50% for months 1–3; names contain "Demo"; idempotent.

#### Cross-story impact matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|-------|--------------|-----------------|--------|------------|
| US-1.1–1.4 | adjustments, offer, hash | US-4.1, 4.3 | metrics / events must reflect the save | summary recomputed in the transaction; one `pricing_changed` after commit |
| US-1.5, 1.6 | none | — | — | read-only / no persistence |
| Price rule edit (outside scope) | standard on next recalc | US-1.1, 1.7 | override may exceed standard | invalid, never capped; accepted quotes not recalculated (R7) |
| Line config / term / currency edit | charges, term, currency | US-1.1–1.4, 1.7, 2.1 | stale adjustments | invalid detection each recalc; conversion guard on stored snapshot |
| US-4.2 lock vs writes | status, adjustments | US-1.x | submit vs save race | aggregate lock + `pricing_revision` on every price-affecting write |
| Line edits while locked (C11) | offers via % | US-4.3 | approved price drifts | `pricing_changed` with new hash (U5) |
| US-1.4 quote level | offers of eligible lines | US-1.2, 3.1 | compounding / leaking into frozen lines | R1 classes + specificity; eligible lines only |
| US-1.8 clone | adjustment rows | US-1.7, 1.9 | invalid / inactive reasons copied | copied as-is, visible |
| Line removal | adjustments soft-deleted | US-1.5, 4.1 | orphans | cascade + summary recomputed |
| US-1.9 deactivate reason | dictionary | US-1.8, 3.1 | clone / carry-over of inactive codes | inactive ≠ invalid; kept |
| US-2.1 activation | items, billing | US-2.5, 3.x | lost event | reconciliation + replay |
| Order cancelled after conversion | order | US-1.7 | quote adjustments stranded (re-conversion blocked by existing order check) | pre-existing, U11 |
| US-3.1 carry-over vs another ARC activation | source item | US-3.1, 3.3 | stale pin undoes the other change | item hash → `SOURCE_CHANGED`, activation refused |
| Renew vs amend on the same subscription | items | US-3.1, 3.2 | both re-rate | `changeLogId` per re-rate; source hash check |
| US-3.2 / 3.3 re-rate | billing items | US-2.3 | renew re-opens ended items | extension only at `oldTermEnd` (I-12) |
| US-2.3 cancel | billing items | US-2.2 | ended segments extended | never-later rule; future items deleted |
| US-4.3 event lost | — | WF4 | quote stuck in `in_approval` | stored snapshot + workflow timer |
| Event cascade | — | WF4 | `pricing_changed` → workflow → status → `status_changed` | CPQ never reacts to its own events; chain bounded by the project workflow |
| US-0.x seed | demo data | — | — | idempotent |

Missing stories found and added: US-1.6, US-1.7, US-2.3, US-2.5, US-3.3. Contradictions resolved: carry-over vs rep adjustments (R1 classes); amend re-pricing untouched items (frozen lines).

#### Checklist (domain stories)
- [x] persona + action + outcome + success
- [x] alternate and failure paths
- [x] trace to workflows
- [x] identity checkpoint — internal, backend pages in §3.5
- [x] no vague verbs

#### Checklist (default stories)
- [x] US-0.1
- [x] US-0.2

---

## 6. User Story Gap Analysis `Architect`

| Story | Platform match (ladder rung) | Commits | Phase | Notes |
|-------|-----------------------------|---------|-------|-------|
| US-1.1 / 1.2 | 5 new code on rung-1 engine | 10 | 1 | waterfall 1, entity 1, resolution 1, application 1, transaction / lock refactor 1, integration 1, API 1, UI waterfall 1, dialog 1, panel 1 |
| US-1.3 | 5 (+ `feature_toggles` gate, rung 2) | 3 | 3 | windows + schedule 2, window UI 1 |
| US-1.4 | 5 | 2 | 4 | |
| US-1.5 | 5 UI | 0 | 1 | in UI waterfall commit |
| US-1.6 | 3 extend `save:false` path | 1 | 1 | grounded |
| US-1.7 / 1.8 | 5 validation, clone, conversion guard | 1 | 1 | grounded clone / conversion paths |
| US-1.9 | 2 dictionary seed + RBAC | 1 | 1 | seeding grounded; editing docs-only |
| US-2.1 | 1 existing totals flow + display | 1 | 1 | grounded C8 |
| US-2.2 | 4 billing items + cycle helper | 3 | 3 | start date 1, payload 1, segments at billing-effective dates 1 |
| US-2.3 | 5 connector rules | 2 | 2 / 3 | cancel never-later (P2), future-segment deletion (P3) |
| US-2.4 | 5 UI | 1 | 3 | |
| US-2.5 | 5 connector CLI | 2 (+1 P3) | 2 | segment support in P3 |
| US-3.1 | 5 mirror helper | 1 (P1) + 1 (P2) + 1 (P3) | 1–3 | frozen lines P1, carry-over P2, absolute windows P3 |
| US-3.2 | 1 `ArcLineDiff` + US-3.3 | 0 | 2 | grounded |
| US-3.3 | 4 connector subscribers | 3 (+1 P3) | 2 | payload 1, re-rate at billing-effective date 1, renew / amend end-date rules 1 |
| — per-cycle rate (U12) | connector mapper | 1 | 2 | existing items keep their rate |
| US-4.1 / 4.2 | 5 | 0 | 1 | in application / API commits |
| US-4.3 | 3 events + guards; 4 Workflows (projects) | 4 | 1 | events 1, guards + `openApi` 2, recipe 1 |
| US-0.1 | 1 seed + role features | 0 | 1 | in ACL commit |
| US-0.2 | 2 demo seed | 1 | 1 | extended in P3 |

**Totals:** P1 20 · P2 8 · P3 11 · P4 2 = **41** atomic commits (= §4 workflow view: WF1 19 + WF2 9 + WF3 8 + WF4 4 + demo seed 1). Phase-deciding docs-only mappings: mutation guards, Workflows (US-4.3), dictionary editing (US-1.9), feature toggles (US-1.3) — logged U1 / U7. Resolution and integration commits may split (+1–2).

#### Checklist
- [x] Every story mapped with an estimate `PM`
- [x] Phase-deciding mappings grounded or docs-only + logged `Architect`
- [x] Architect checkpoint #2 — re-mapped (`architect-checkpoint-2.md`) `Architect`

---

## 7. Phasing & Rollout `PM`

> Phasing logic: business priority × gap score × blocker status. Every phase ships a complete increment. Acceptance criteria by role reversal: the DDD challenger wrote the domain criteria, the PM challenged them ([`challenger-phase4-criteria.md`](app-spec-notes/challenger-phase4-criteria.md)).

### Phase 1: Negotiated prices on new deals (with safe ARC behaviour)

**Goal:** a rep sets permanent negotiated prices (charge override / amount off, charge or line %) on a new-sale quote; the manager sees discount depth; order, subscription and invoice carry the offer price; projects can hook approvals; Amend no longer re-prices untouched items.

**Why this order:** highest business priority (primary goal), lowest gap; billing already receives offer totals (C8), so the new-sale journey works without connector changes. Frozen Amend lines ship here so Phase 1 cannot corrupt subscription prices.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-1.1, 1.2, 1.5 | waterfall, entity, resolution, application, transaction / lock refactor, integration, API, UI waterfall / dialog / panel | 10 |
| US-1.6 | preview | 1 |
| US-1.7, 1.8 | invalid handling, clone, conversion guard | 1 |
| US-1.9, US-0.1 | ACL + reasons | 1 |
| US-2.1 | order / subscription display | 1 |
| US-3.1 (part) | frozen Amend mirror lines + ARC mirror-line eligibility block | 1 |
| US-4.1, 4.2 | depth, lock (in the commits above) | 0 |
| US-4.3 | events, guards + `openApi`, recipe + manuals + `MIGRATION.md` | 4 |
| US-0.2 | demo seed | 1 |

**Total: 20 atomic commits** — delivered as two feature specs: `quote-pricing-integrity` (recalculate hardening, frozen Amend lines, guards + `openApi` on existing routes; 4) and `manual-adjustments` (16).
**Workaround:** ARC mirror lines (Amend and Renew) are not adjustable until Phase 2; reconfigured Amend lines re-price as today (banner); billing unaffected (`modify` does not reach billing before Phase 2, C13).

**Domain criteria** `DDD`:
- [ ] **I-9 / migration:** quotes without manual adjustments recalculate to identical `unitPrice`, `totalPrice`, `mrcTotal`, NRC total and `discountTotal`; only additive fields differ; new table and `pricing_revision` (default 0) leave existing rows unchanged; legacy charges get list / standard from the read helper.
- [ ] **R1–R3, I-3, I-4, I-11:** table tests over charge model × type × level: at most one manual adjustment per charge, `0 ≤ offer ≤ standard`; above-standard / currency / missing / ambiguous adjustments kept, skipped, flagged, line `incomplete`, never capped; `level = quote` and bounded windows → `422`.
- [ ] **Aggregate (I-2, I-10, R7):** every price-affecting write incl. status transitions bumps `pricing_revision` by exactly 1; stale `expectedRevision` → `409`, 0 rows changed; two concurrent overlapping creates → exactly one succeeds; locked writes → `409` except deleting invalid ones; `save:true` in terminal status → `409`.
- [ ] **Events:** exactly one `pricing_changed` per save that changes `snapshotHash`; none for preview, no-op recalc, refused / rolled-back writes, or a legacy quote's baseline hash; `status_changed` on every manual and automatic change, after commit only.
- [ ] **I-6:** two consecutive recalculations give byte-identical `charges` and hash.
- [ ] **I-7, R8, R11, R13:** conversion copies the stored waterfall without re-pricing; a stored invalid adjustment → `422`, no order; billing item rate = offer `mrcTotal`; clone remaps lines; line removal soft-deletes its adjustments; calculate-price never returns `origin: manual`.
- [ ] **ARC safety:** activating an Amend leaves untouched (frozen) mirror lines byte-identical to the source item's `charges` and changes no billing item.

**Business criteria** `PM`:
- [ ] A rep overrides a charge, takes an amount off and discounts a line by %, each with a reason, and sees list → rules → standard → manual → offer.
- [ ] A rep without `cpq.quotes.adjust_price` sees prices read-only.
- [ ] Submitting the quote locks adjustments; moving back to `ready` unlocks them.
- [ ] Converting and activating a quote with an override of 80 produces a subscription item and a billing item at 80 (monthly account).
- [ ] A project workflow on `cpq.quote.status_changed` with `discountDepth.manual > 0.15` creates a task (recipe executed on the GIX demo tenant).
- [ ] An Amend that adds a port leaves the existing ports' contracted prices unchanged in CPQ.

**Value delivered:**
- **Business value:** negotiated deals for new customers move into CPQ and are billed as sold.
- **ROI metric:** share of won quotes with a non-standard price priced in CPQ — ≥ 95% within one quarter per tenant.

**PM's challenges to the DDD criteria:** all accepted — each protects price integrity or the approval contract; the concurrency criterion stays despite its test cost because a lost negotiated price is a billing dispute.

### Phase 2: Price continuity through Amend / Renew and billing integrity

**Goal:** changed Amend lines carry manual adjustments over; renewals can be re-negotiated; every recurring price change reaches billing exactly once, from its billing-effective date, on any cycle; drift is detectable.

**Why this order:** removes the Phase-1 workarounds and the pre-existing drift (C13) before time-based prices multiply price changes; the re-rate machinery is the base Phase 3 reuses.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-3.1 | carry-over (`SOURCE_CHANGED`, activation refusal); Renew lines adjustable | 1 |
| US-3.2, 3.3 | `modifiedItems` payload (post-Phase-1 quotes only), connector re-rate at the billing-effective date, renew / amend end-date rules | 3 |
| US-2.3 (part) | cancel never moves an end date later | 1 |
| per-cycle rate (U12) | connector mapper, existing items keep their rate | 1 |
| US-2.5 | reconciliation + replay, no-account throws | 2 |

**Total: 8 atomic commits**

**Domain criteria** `DDD`:
- [ ] **R9, I-6:** frozen lines byte-identical to the source; untouched lines and NRC-only changes absent from `modifiedItems`; each activation emits exactly one amended / renewed event with `changeLogId` (+ `oldTermEnd` on renew); in-flight pre-Phase-1 ARC orders emit no `modifiedItems`.
- [ ] **Carry-over:** re-pricing a line creates exactly one carried-over row per source adjustment (charge level, source hash); re-pricing again creates none; a rep's charge / line adjustment wins; Renew and Cancel create none.
- [ ] **R8 `SOURCE_CHANGED`:** after another ARC change activates first, conversion → `422`, activation → `409`, nothing committed.
- [ ] **I-8:** property test over monthly / quarterly / annual / weekly × E (on anchor, mid-cycle, already billed): billed amount per cycle = contracted price at the cycle start × months per cycle; no cycle billed twice or skipped; NRC never re-billed; new items created before old ones are end-dated.
- [ ] **R15 idempotency:** replaying an event, or crashing after any single item write and retrying, creates 0 duplicates.
- [ ] **I-12:** no end date moves later after a re-rate, renew or cancel, except renew at `oldTermEnd`; cancel after a re-rate keeps the old item ended at E − 1.
- [ ] **I-13:** demo scenarios show 0 drift; a dropped event is found and fixed by one replay; a missing billing account makes the subscriber throw; grandfathered items reported as `legacy-rate`, not drift.

**Business criteria** `PM`:
- [ ] Amend changing a port's speed carries its 20% discount over; billing re-rates from the next billing cycle.
- [ ] Renew at a re-negotiated 90 bills 90 from the day after the old term end.
- [ ] Reconciliation on the demo tenants reports 0 drift after the scenarios above; a deliberately dropped event is found and replayed.
- [ ] A new item on a quarterly account is billed 3 × the monthly price per cycle.

**Value delivered:**
- **Business value:** live-subscription price changes stop drifting between CPQ and billing.
- **ROI metric:** reconciliation drift per tenant → 0 open items older than one bill run.

**PM's challenges to the DDD criteria:** the U12 criterion was changed from "all items billed per cycle" to "new and re-rated items per cycle, existing items grandfathered as `legacy-rate`" — a backfill would change invoices of existing customers without a commercial decision. Weekly cycles kept in the property test (cheap; billing supports them).

### Phase 3: Time-based prices (promotions and ramps), billed per schedule

**Goal:** a rep grants "first N months" or stepped prices; the subscription shows current / regular price and promo end; billing follows the schedule cycle by cycle; amendments during a promo keep the remaining promo.

**Why this order:** depends on the Phase-2 re-rate machinery; promotions are the main source of manual billing corrections.

| Story | What ships | Commits |
|-------|-----------|---------|
| US-1.3 | windows (behind toggle `cpq.price_windows`), schedule, window UI | 3 |
| US-2.2 | price start date + dates, payload schedules, segment items at billing-effective dates | 3 |
| US-2.3 (part) | cancel deletes future never-billed segments | 1 |
| US-2.4 | current / regular price display | 1 |
| US-2.5 (part) | reconciliation understands segments | 1 |
| US-3.1 (windows), US-3.3 (schedules) | absolute-window carry-over, connector `modifiedItems` schedules | 2 |

**Total: 11 atomic commits**

**Domain criteria** `DDD`:
- [ ] **I-5, R4, R5:** property test: segments contiguous from month 1, last open segment = regular price; window on NRC / beyond term / same-level overlap → `422`; lines without windows have no `schedule`.
- [ ] **I-7, R10:** activation sets `price_start_date` and segment dates (EOM clamping); absolute windows clipped at the real start; migration leaves legacy items and source-item hashes unchanged (no spurious `SOURCE_CHANGED`).
- [ ] **Segments:** one recurring billing item per segment with `-s<n>` refs; US-2.2 amounts exact; boundaries land on cycle starts for every cycle kind; retry creates only the missing segment.
- [ ] **Cancel:** future never-billed segments deleted; ended segments untouched.
- [ ] **ARC:** amend in month 2 keeps the promo until its original end date; `modifiedItems` schedules re-rate idempotently.
- [ ] **Compatibility:** payload without `schedule` handled as today; windows unavailable while the toggle is off; promo subscriptions reconcile with 0 drift.

**Business criteria** `PM`:
- [ ] The US-2.2 scenario bills April / May / June at 50 and July at 100 on a monthly account.
- [ ] Cancelling during the promo stops billing at the cancel date; no future segment is billed.
- [ ] Amending in month 2 of a 3-month promo keeps the promo until its original end date.

**Value delivered:**
- **Business value:** promotions are sold and billed from CPQ without manual credits.
- **ROI metric:** manual billing corrections for promotional deals → 0.

**PM's challenges to the DDD criteria:** all accepted.

### Phase 4: Quote-wide discounts

**Goal:** one action discounts every eligible line, including lines added later.

**Why this order:** convenience on top of line-level discounts (workaround exists).

| Story | What ships | Commits |
|-------|-----------|---------|
| US-1.4 | quote level + dialog | 2 |

**Total: 2 atomic commits**

**Domain criteria** `DDD`:
- [ ] **R1:** charge > own line > ancestor line > carried-over > quote; no compounding; frozen and free-form lines unchanged.
- [ ] Saving a newly added eligible line applies the quote discount and emits one `pricing_changed`.
- [ ] **I-2:** a second overlapping quote-level adjustment → `422` under the lock; MRC-only and NRC-only filters coexist.
- [ ] A bounded window is accepted only with `charge_type_filter = mrc`.
- [ ] A carried-over charge-level adjustment beats a quote-level one (explicit test).

**Business criteria** `PM`:
- [ ] A 10% quote discount applies to all eligible lines, and a line-level 20% on one line wins on that line.

**Value delivered:**
- **Business value:** multi-line deals discounted consistently in one step.
- **ROI metric:** quote-level discounts replace ≥ 80% of identical per-line discounts within a quarter.

**PM's challenges to the DDD criteria:** all accepted.

### Rollout Summary

```
Phase 1: Negotiated prices on new deals            20 commits   WF1 (permanent), WF2 (existing path), WF3 (frozen lines), WF4
Phase 2: Price continuity + billing integrity       8 commits   WF3, WF2 (per-cycle, reconciliation, cancel rule)
Phase 3: Time-based prices billed per schedule     11 commits   WF1 (windows), WF2 (schedules), WF3 (windows)
Phase 4: Quote-wide discounts                       2 commits   WF1 (quote level)
                                                   ---------
                                                   41 atomic commits total
                                                   28 commits for production-ready negotiated pricing (Phases 1–2)
```

#### Checklist
- [x] Ordered by priority × gap × blockers
- [x] Each phase a complete increment
- [x] Workarounds documented
- [x] Commits per phase `Architect`
- [x] Acceptance criteria: DDD domain criteria + PM business criteria `DDD + PM`
- [x] PM challenged the DDD criteria `PM`
- [x] Business value + ROI per phase
- [x] No artificial phases

---

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs involved | Resolution |
|----------|---------------|------------|
| `discountTotal` = rule savings; code omits the line quantity | `xd-201-quoting.md:432`, `cpqQuotingService.ts:1269-1283` | `discountTotal` left unchanged (deprecated); new `ruleDiscountTotal` / `manualDiscountTotal` computed consistently with the line quantity; `MIGRATION.md`. |
| Calculate-price API contract | `xd-187`, pricing skill | Additive only (R13). |
| Rule effective dates (calendar) | `xd-188:519` | Distinct concept; coexist. |
| Rule type semantics | `xd-188`, `xd-217` | Reused exactly. |
| ARC mirror re-pricing; `modify` not billed | `xd-250-arc-spec.md` | Frozen mirror lines on Amend, carry-over, `modifiedItems` (Phase 2) — MODIFIED ARC behaviour, needs a Delta in the feature spec. |
| Billing discount pattern = negative `one_time` | `xd-249:194-196` | Not used: schedules and re-rates are dated recurring items at non-negative rates. |
| Renew / cancel / amend end-dating | `xd-249` l.776-780 | R14 / I-12. |
| Connector passes monthly MRC for every cycle | `xd-249`, `chargeMapper.ts` | Per-cycle rate for new items (U12, Phase 2). |
| First partial cycle after activation unbilled | `xd-249`, connector | Kept (U3). |
| Conversion from any status | conversion manual | Invalid-adjustment guard; status enforcement is a project guard. |

#### Checklist
- [x] Related specs listed
- [x] Identity consistent
- [x] Terminology matches glossary
- [x] Shared entities single-owned
- [x] Entities referenced by stories
- [x] Conflicts resolved

## 9. Reference App Quality Gate `Architect`

N/A — product package; CPQ Definition of Done applies.

---

## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|----------|---------|--------|-------|--------|
| Q1 | Goal / who pays | — | §1 | User | DECIDED (user-confirmed): priced in CPQ, billed as quoted; licensee pays. |
| Q2 | List price | before / after rules | fields | User | DECIDED (user-confirmed): before rules (list / standard / offer). |
| Q3 | Levels | charge · line · quote | entity | User | DECIDED (user-confirmed): all three; quote level Phase 4. |
| Q4 | Stacking | most specific · compound | R1 | User | DECIDED (user-confirmed): most specific (rep beats carried-over). |
| Q5 | Time-based shape | first N · windows · dates | schedule | User | DECIDED (user-confirmed): price-month windows; absolute dates for carry-over only. |
| Q6 | Downstream | quote · order · billing | phases | User | DECIDED (user-confirmed): through billing. |
| Q7 | Editable statuses | draft · any | R7 | User | DECIDED (user-confirmed): `new` / `incomplete` / `ready`, no order yet. |
| Q8 | ARC | amend keeps / renew drops · … | R9 | User | DECIDED (user-confirmed): amend keeps (frozen + carry-over), renew re-prices. |
| Q9 | Price rules adoption | — | scope | User | DECIDED (user-confirmed): shared waterfall only. |
| D1 | Placement | — | layering | Architect | DECIDED: L2 `@dainamite/cpq` + connector. |
| D2 | Charge types | — | scope | PM | DECIDED: MRC + NRC; usage excluded. |
| D3 | Markup | — | R3 | PM | DECIDED: never. |
| D4 | Reason | — | data | PM | DECIDED: required code; note for `other`. |
| D5 | Permission | — | ACL | Architect | DECIDED: `cpq.quotes.adjust_price` (admin, employee). |
| D6 | Sales line mirror | — | sales | Architect | DECIDED: `unitPriceNet` = offer; sales discount fields 0. |
| U1 | Framework not installed in worktree | — | confidence | Architect | LOGGED: guards / Workflows docs-only. |
| U2 | Sales recompute from `discountAmount`? | — | D6 | Architect | LOGGED (docs-only). |
| U3 | First partial cycle after activation unbilled | fix · keep | all subscriptions | Billing | LOGGED: kept. |
| U4 | Quote currency change | — | R8 | Architect | DECIDED: amount / override invalid. |
| U5 | Freeze line edits during approval | — | approvals | PM | LOGGED: out of scope; hash signals. |
| U6 | `cycleContaining` from billing internals | — | connector | Architect | LOGGED: reused, not widened. |
| U7 | Dictionary editing by tenant admins | — | US-1.9 | Architect | LOGGED (docs-only): seeding proven, editing / inactive labels unverified; seed visible. |
| U8 | Carry-over pin vs re-apply | — | R9 | PM | DECIDED: re-apply original adjustment (frozen lines keep the contracted price). |
| U9 | Amend re-pricing untouched lines | — | ARC | PM | DECIDED: frozen mirror lines (Phase 2). |
| U10 | `openApi` missing on quote routes | — | API-first | Architect | DECIDED: added on every route touched; untouched routes separate work. |
| U11 | Order cancelled after conversion strands the quote | — | re-quoting | PM | LOGGED: pre-existing. |
| U12 | Monthly MRC passed as per-cycle rate | fix · keep | non-monthly accounts | Billing | DECIDED (user, 2026-11-10 — easiest correct): items created from Phase 2 on use monthly × months per cycle; existing items keep their rate (reported `legacy-rate`), no backfill. |
| U13 | Mid-cycle price changes | prorate · whole cycles | re-rates, schedule boundaries | Billing | DECIDED (user, 2026-11-10 — easiest correct): price changes take effect at the billing-effective date (next unbilled cycle start); no prorations or difference items. Added / removed items and cancel keep today's behaviour. |
| U14 | Merge-renew price propagation | — | merge | PM | LOGGED: out of scope; reconciliation reports drift. |
| U15 | Inventory shows renewed price before the new term | — | display | PM | LOGGED: fixed by dated segments in Phase 3. |
| U16 | CPQ / connector version skew for windows | toggle · none | promo billing | Architect | DECIDED: windows behind feature toggle `cpq.price_windows` (docs-only: `feature_toggles` module), enabled with a schedule-capable connector. |
| U17 | In-flight ARC orders at the Phase-2 deploy | re-rate · legacy | billing | Architect | DECIDED: only quotes built with the frozen-line scheme emit `modifiedItems`; older orders keep today's behaviour. |
| U18 | Legacy quote's first snapshot hash | event · baseline | approvals | Architect | DECIDED: silent baseline unless offers change. |
| U19 | Puffin public calculator forwards CPQ charges incl. rule `adjustments[]` (pre-rule price) to anonymous visitors | strip · keep | storefront data exposure | PM (demo_puffin) | LOGGED: pre-existing; R13 makes new waterfall fields opt-in so nothing new leaks; stripping `adjustments` in the proxy is a demo_puffin follow-up. |

#### Checklist
- [x] Options, impact, owner, status
- [x] No unresolved BLOCKER before its phase
- [x] Rationale recorded

---

## Production Readiness `PM`

| Workflow | Deployable | Blocker | What the client would say |
|----------|-----------|---------|---------------------------|
| WF1 (permanent) | after Phase 1 | — | "Finally the discount is in the quote." |
| WF2 (permanent, monthly) | after Phase 1 | lost events undetected until Phase 2 | "If an invoice is missing nobody notices." |
| WF3 | after Phase 2 | Phase 1: changed Amend lines need manual re-apply; Renew lines not adjustable | "Why do I have to re-enter the discount when I change an item?" |
| WF2 (non-monthly accounts) | after Phase 2 for new items | U12 (existing items keep their rate) | "Old quarterly items still show a third of the price." (pre-existing) |
| WF1 / WF2 time-based | after Phase 3 | — | "Promos still need manual credits." (until Phase 3) |
| WF4 | after Phase 1 | project configuration | "Approvals need a workflow set up first." |

#### Checklist
- [x] Deployable per workflow, binary, with blocker
- [x] Client complaint stated
- [x] No workflow stops midway (Phase-1 ARC banner)

---

## Changelog

### 2026-11-10
- Draft: current state, glossary, waterfall model, open questions.
- Autonomous run: Q1–Q9 ASSUMED; D1–D6 decided; Phases 0–1.
- Challenger fixes (Phase 0 / 1, architect #1): charge identity, signed depth, invalid handling, free-form lines, carry-over level, `modifiedItems`, start anchor, adjustment lock + hash, quantity semantics, usage excluded, bundles, concurrency, segments vs credits, never-later rule, guards, preview, fewer columns / events, WF1–WF4.
- Phases 2–3: stories, impact matrix, story mapping.
- Re-check + stories challenger + architect #2: rep-created beats carried-over; frozen mirror lines; carry-over re-creates original type; source-item hash; terminal recalc refusal; per-cycle rates; item schedule merge; provisional anchor; aggregate lock on all writes; auto status events; re-rate algorithm (two prorations, billed-cycle difference, renew E); renew extension at `oldTermEnd`; reconciliation; 4-phase rollout (41 commits).
- Phase 4: phasing + business criteria; role reversal — DDD domain criteria written by the challenger, PM challenges recorded; phasing fixes: frozen Amend lines and Renew-line block moved to Phase 1, cancel never-later rule to Phase 2, legacy ARC orders excluded from `modifiedItems`, per-cycle fix grandfathers existing items, windows behind a feature toggle, reconciliation segment support, carried-over beats quote level (R1), legacy hash baseline. Total 43 commits.
- Feature-spec review (staff-engineer, fresh context): ARC mirror lines blocked for adjustments until Phase 2 (Amend too); Phase 1 split into `quote-pricing-integrity` + `manual-adjustments`; explicit transaction / lock refactor (+1 commit, total 44); `discountTotal` left unchanged with consistent new rule / manual totals; calculate-price waterfall opt-in; recalculate route requires `cpq.quotes.manage`; U19 logged.
- User confirmed the recommended answers (2026-11-10); billing corner cases resolved with the easiest correct behaviour: price changes and schedule boundaries billed from the next unbilled cycle start (no prorations / difference items), per-cycle rates for new items only. Total 41 commits.
- Phase 5 hand-off: 7 feature briefs in `.ai/specs/briefs/` (quote-pricing-integrity → manual-adjustments → arc-continuity, billing-rerate → time-windows, schedule-billing → quote-wide-discount); Phase-1 feature specs `.ai/specs/2026-11-10-cpq-quote-pricing-integrity.md` and `.ai/specs/2026-11-10-cpq-manual-price-adjustments.md`.
