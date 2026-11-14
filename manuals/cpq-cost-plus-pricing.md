# CPQ — Cost-plus pricing, quote costs and margin

Spec: `.ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md` ·
App Spec: `.ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md` (feature 1 of 6)

Some offers are sold as *what it costs us plus a markup*: a partner carrier's
tail circuit, hardware bought at a supplier's rate table. With cost-plus pricing
CPQ prices such a charge from its **costs**, shows the sales team how much of
the price is cost, and lets a pricing manager see — and govern — the **margin**
of a quote. Everything downstream is unchanged: price rules and negotiated
adjustments apply to a cost-plus price exactly as to any other list price.

This release covers **known costs on new-sale quotes**. See
[Coming with later features](#coming-with-later-features).

## Concepts

| Term | Meaning |
|---|---|
| **Cost-plus charge** | An NRC or MRC charge whose pricing method is `cost_plus`: flat or per-unit, with a **markup rule** and value, and at least one active price-basis cost element. |
| **Cost element** | A charge's catalog default cost: code, name, role, cost type (NRC / MRC), source (`fixed`, `table`, `on_request`), cost model (`flat` / `per_unit` / `tiered` / `volume`). The code becomes the **cost key** on the quote and never changes. |
| **Price-basis cost** | Part of the price: the charge's list price is computed from the sum of its price-basis costs. |
| **Margin-only cost** | Counts toward margin but never toward the price (internal monitoring, extra labour). |
| **Cost table** | An ordinary pricing table with `purpose = cost`. Only users with `cpq.costs.view` can see it. |
| **Cost line** | One cost on one quote line: a copy of a catalog element (origin `catalog`) or a cost the pricing manager added (origin `manual`). It has a value status: `none` (pending), `estimated` or `confirmed`. |
| **Fallback price** | Optional fixed price on a cost-plus charge, shown as "≈ …" while its cost is pending. Never stored as the list price and never counted in totals. |

### How the list price is computed

Per charge and per instance, `C` is the sum of the price-basis cost lines'
per-instance amounts (full precision). Then, with markup value `m`
(`25` means 25 %) or `a` (an absolute amount in the charge currency):

| Markup rule | List total |
|---|---|
| `markup_percent` | `C × (1 + m / 100)` |
| `target_margin_percent` (m < 100) | `C ÷ (1 − m / 100)` |
| `markup_absolute` | `C + a` (once per instance) |

An absolute markup `a` is in the **charge** currency. On a quote in another
currency the charge has no price (`CURRENCY_NO_RATE`) — it is never added 1:1
before FX conversion ships. The absolute amount of a markup **override** is
entered in the quote currency.

The total is rounded **once**, to the currency precision. For per-unit charges
the unit price is the total divided by the quantity, kept at 4 decimals. Price
rules and negotiated adjustments then apply to the standard price derived from
cost; percent rules scale the exact total, so there is no unit × quantity drift.

**Worked example.** Cross-connect 300 plus partner tail 100 per month, markup
25 %: `C = 400`, list = `400 × 1.25 = 500.00`. With a 10 % line discount the
offer is `450.00`; the margin on the offer is `450 − 400 = 50` (11.1 %).

A cost-plus charge with an unknown (`none`) price-basis cost has **no price**:
`unitPrice` / `totalPrice` are `null`, the line carries `COST_PENDING`, and the
quote cannot reach **Ready**. With no applicable price-basis cost at all the
error is `NO_PRICE_BASIS_COST`; an unusable markup gives `MARKUP_INVALID`, an
absolute markup in a foreign currency `CURRENCY_NO_RATE`. An **estimated** cost
does price the charge; the quote is then *indicative* (see below).

## Enabling the feature

Cost-plus is a per-tenant rollout, **off by default**.

1. After `yarn mercato db migrate`, run `yarn mercato cpq seed-cost-plus`
   (idempotent) to register the toggle `cpq.cost_plus`, then
   `yarn mercato auth sync-role-acls` so existing roles pick up the new features.
   New tenants get both at initialization. The toggle is registered **off**.
2. Turn `cpq.cost_plus` on for the tenant under Feature Toggles (tenant override).

With the toggle off: cost-plus charges cannot be created (`422 COST_PLUS_DISABLED`),
the cost endpoints return `404`, and a stored cost-plus charge re-priced on a
quote gets `COST_PLUS_DISABLED` instead of a price.

> **Turning it off is not neutral.** Quotes that already contain cost-plus
> charges lose their price on the next re-pricing. Before switching it off, call
> `GET /api/cpq/cost-plus/usage` (needs `cpq.costs.view`; works with the toggle
> off). It returns `costPlusCharges`, `openQuotes`, `openRequests` and
> `liveSubscriptions`. Switch off only when `openQuotes` is 0 (and, from later
> features, `liveSubscriptions` / `openRequests`), or accept that those quotes
> become unpriced.

## Roles and confidentiality

| Feature | Grants | Default |
|---|---|---|
| `cpq.costs.view` | See costs, suppliers, markup, margin and cost tables. Read-only. | `admin`, `employee` |
| `cpq.costs.manage` | Add and edit costs, confirm values, override markup, change a charge's markup. Used together with `cpq.quotes.manage` (quote) or `cpq.products.manage` (catalog). | `admin` |

Personas map to roles: a **sales rep** is `employee` (sees costs and margin,
cannot change them); a **pricing manager** or **procurement** user is any role
with `cpq.costs.view` + `cpq.costs.manage` (default `admin`); a **pricing admin**
holds `cpq.pricing.manage` + `cpq.costs.view` to maintain cost tables. In the
GIX demo, `pricing@gix.com` is a `pricing_manager` role with those grants.

Users **without** `cpq.costs.view` — custom roles, API keys, the public
calculator — never receive a cost value, supplier, markup or margin, anywhere:
not in `charges`, `pricingSummary`, quote / order responses, calculate-price,
broadcast events, action-log snapshots or search. They see only **cost status**
(pending / estimated / expired). Cost tables and their entries are absent from
pricing-table lists and `404` by id. `markupRule` / `markupValue` are stripped
from product-charge responses; `pricingMethod: cost_plus` stays visible.

Product-charge **writes** follow the same rule: creating a cost-plus charge,
setting a markup, and **any** write on a stored cost-plus charge — including
switching it to another pricing method (which wipes its markup and deactivates
its price-basis elements) and deleting it — need `cpq.costs.view`
(`403 COSTS_VIEW_REQUIRED`). The check runs before any validation, so a `400`
never reveals the stored markup. Clearing markup (`null`) on a fixed or table
charge needs nothing extra.

One deliberate exception: the non-broadcast event `cpq.quote.margin_changed`
carries **quote-level** aggregates (contract margin, margin %, coverage). It is
readable by anyone who can view workflow definitions, instances and their stored
context. Grant those views accordingly.

## Setting up the catalog

1. **Cost table** (optional). Create a pricing table, set **Purpose = Cost**,
   add dimensions and cost columns. The purpose cannot change once a charge or
   cost element references the table (`422 PURPOSE_LOCKED`).
2. **Charge.** On the offering page, make a charge **Cost-plus**: pick the
   markup rule and value, optionally a fallback price (needs a currency). The
   charge needs at least one active price-basis element, so add the elements
   first (a new cost-plus charge is created inactive, given elements, then
   activated). Activating the charge and deactivating its last price-basis
   element take the same lock on the charge row, so two concurrent edits cannot
   leave an active cost-plus charge without a price basis.
3. **Cost elements** (`/api/cpq/charge-cost-elements`):
   - `fixed` — an amount and currency;
   - `table` — a cost table and column; tiered / volume models require a table;
   - `on_request` — no value; an optional **estimate** (needs a currency),
     default supplier and validity days. A catalog estimate starts the quote
     cost line as `estimated`, no estimate starts it as `none`.
   A price-basis element must have the charge's cost type (`COST_TYPE_MISMATCH`)
   and sits on a cost-plus charge (`PRICE_BASIS_REQUIRES_COST_PLUS`). Element
   codes are unique across every charge priced together on one line
   (`DUPLICATE_CODE`) and immutable. The last active price-basis element cannot
   be deactivated or deleted (`NO_PRICE_BASIS_ELEMENT`).
4. **Preview.** `POST /api/cpq/cost-preview` returns the costs and list price of
   a sample configuration without saving anything.

## The quote flow

Add a costed offering to a quote. CPQ creates one catalog **cost line** per
applicable element on every saved recalculation and resolves `fixed` and `table`
values (a value from a table is `confirmed`). The line's **Costs panel** lists
each cost with its status badge:

| Status | Price | Meaning |
|---|---|---|
| `none` — **pending** | no price | No value yet (no estimate; no matching table row, or the matching row has no value in the element's cost column = `TABLE_NO_MATCH` — never a confirmed 0; a row only in another currency = `CURRENCY_NO_RATE`). |
| `estimated` | priced | A catalog estimate or an unconfirmed entry. The quote shows **Indicative — costs not confirmed**; it can reach Ready and *With customer*. |
| `confirmed` | priced | Known cost. |
| **expired** | priced | Supplier validity (`validUntil`) is in the past; blocks conversion until renewed. |

> A cost-table row with **no value** in a cost column is an unknown cost. The
> spreadsheet import of pricing tables stores a **blank cell as 0**, which is a
> known zero cost: leave the column out of the row (edit it in the table) when the
> cost is not known.

Pricing managers (`cpq.costs.manage`) can:

- **Enter or confirm a value** on any cost line (`PATCH .../costs/{costId}`).
  Overwriting a catalog value needs a note (`NOTE_REQUIRED`). Extending a
  validity or supplier term needs a new supplier quote reference or a note
  (`VALIDITY_EVIDENCE_REQUIRED`). The line then has `valueOrigin = manual` and
  stays put on recalculation until a driving attribute changes (re-configuring
  an attribute that the element's applicability or table dimensions use resets
  an on-request cost to its catalog estimate or `none`; the previous value goes
  into the note).
- **Add a manual cost** (`POST .../costs`): key `manual:<8 hex>`. It may be
  price-basis only on a cost-plus charge; otherwise margin-only. Catalog lines
  follow the catalog and cannot be deleted (`CATALOG_COST_NOT_DELETABLE`).
- **Override the markup** of a cost-plus charge on one line
  (`PUT .../markup-overrides`, note required; `DELETE` clears it). Raising a
  cost-plus price is done with a markup override, never with a negotiated
  adjustment, which cannot go above the standard price.

A rep with only `cpq.costs.view` sees the same panel read-only.

### Cost lock and exemptions

Price-basis costs and markup overrides lock with the same rule as negotiated
prices: the quote has left **New / Incomplete / Ready**, or an order exists.
While locked, price-affecting writes return `409 COST_LOCKED`. Always allowed in
statuses other than Rejected / Cancelled: margin-only cost changes,
**confirming an unchanged value** (estimated → confirmed), and extending
validity or supplier term. An **Accepted** quote keeps these exemptions — it is
where a pricing manager confirms the remaining estimated costs before
conversion. Rejected and Cancelled quotes refuse every cost write. To
change a price-basis value on a locked quote, move the quote back to Ready,
edit, and resend. Every cost write bumps the quote's `pricingRevision`; the
write routes accept `expectedRevision` and answer `409 STALE_REVISION` on
mismatch. Status transitions also accept an optional `expectedRevision`, which
the quote page always sends, so a rep never sends a price they have not seen.

**Lines priced from costs are frozen too.** With the toggle on, on a locked
quote, adding a line whose offering (or product) has an active cost-plus charge,
or changing the **configuration or quantity** of such a line, returns
`409 COST_LOCKED`: the stored costs (per-unit amounts, table lookups) would no
longer match the configuration, and a line added while locked never gets cost
lines. Term and dates stay editable, and resubmitting an unchanged configuration
is accepted. Lines without a cost-plus charge are not affected. Move the quote
back to Ready to reconfigure.

### ARC quotes (Amend / Renew / Cancel)

Costs are not yet carried over from a subscription (see
[later features](#coming-with-later-features)). On an ARC quote:

- **Renew** mirror lines (re-priced at today's standard) and **reconfigured
  Amend** mirror lines get catalog cost lines like any other line. A pricing
  manager enters and confirms their values (`PATCH .../costs/{costId}`), so the
  quote can convert. Manual costs and markup overrides are not available on
  mirror lines (`422 LINE_NOT_ELIGIBLE`).
- **Frozen Amend** mirror lines keep the subscription item's stored price: they
  get no cost lines and accept no cost write (`422 LINE_NOT_ELIGIBLE`).
- **Removing an item** on an Amend / Renew quote turns its line into a cancel
  line: its cost lines (catalog and manual) and markup overrides are deleted
  at once, whatever the toggle or the lock. Restoring the item brings the
  catalog costs back on the next saved recalculation (Renew; a restored Amend
  line is frozen again).
- **Cancel-quote** lines keep the catalog costs their price is computed from
  but accept no cost write.
- Cancel lines (removed items, Cancel-quote lines) never block conversion.

## Margin

Holders of `cpq.costs.view` see the **Margin card** on the quote page and
`margin` in `GET /api/cpq/quotes/{quoteId}/costs`: per charge, line, bundle
roll-up and quote — NRC / MRC cost and offer, margin, margin %, markup %,
**contract margin** (NRC once plus MRC × term months, default 12) and **cost
coverage** (the share of deal value that has cost lines; uncovered lines count
as cost 0 — read low coverage as "margin overstated"). Flags: `hasPendingCosts`,
`hasEstimatedCosts`, `hasExpiredCosts` — over **every** cost line, margin-only
included. Margin is **computed, never stored**.
Percentages are 0–100 numbers, `null` when undefined.

`margin_hash` covers cost amounts, currency, FX, role, markups, offers and each
line's **term** (months, 12 when unset — shortening a term moves the contract
margin) — not statuses. When it changes after a write, CPQ emits `cpq.quote.margin_changed`
(after commit, once per write, not broadcast to browsers):
`marginHash`, `previousMarginHash` (`null` when the write created the quote's
first costs), `approvalInvalidated` (true when the quote is past
New / Incomplete / Ready and has no order), `contractMargin`, `marginPercent`,
`costCoverage`, the three margin flags, `cause`. Confirming at the same value
changes nothing and emits nothing. `cpq.quote.status_changed` also carries
`hasPendingCosts` and `hasEstimatedCosts` on quotes that carry costs — for
**price-basis** cost lines only: they say the *price* is pending / indicative,
so a margin-only estimate does not set them. Neither event carries a cost,
markup or per-line margin.

## Conversion guard

Converting a quote to an order (`POST /api/cpq/orders`) is refused with
`422 COSTS_NOT_CONFIRMED` while, on any live line:

- a **price-basis** cost line is not `confirmed`, or has expired on the
  conversion date; or
- a **cost-plus charge has no price** (stored `unitPrice: null`: a pending or
  missing price-basis cost, no applicable price-basis element, an invalid or
  foreign-currency markup, the toggle off). The guard never relies on cost
  lines existing.

The body names the offenders per line:
`lines: [{ quoteLineId, costKeys, chargeCodes }]` — the blocking cost keys and
the unpriced cost-plus charge codes; either list may be empty. The check runs
regardless of the toggle. Margin-only costs never block, and ARC cancel lines
are ignored. Confirm at the same value (or renew the supplier validity) and
convert; for an unpriced charge move the quote back to Ready, resolve its costs,
re-price and resend. After conversion the quote's costs are locked and no longer
change prices.

## Calculate-price

`POST /api/cpq/quotes/price` prices cost-plus charges without a quote, from
catalog costs resolved in memory. Additive charge fields: `indicative: true`
(priced from at least one estimated price-basis cost) and `priceOnRequest: true` (cannot be
priced — pending cost, no price basis or toggle off; `unitPrice` and
`totalPrice` are `null` and the charge is excluded from totals). Costs,
suppliers and markup are never returned, and the Puffin public proxy forwards
nothing new.

## Approving low-margin quotes (project recipe)

CPQ ships **no** approval workflow; the margin signal is the building block.
Recipe with Open Mercato **Workflows** (create it in your project, **disabled**
until you tune it):

1. **Route approvals.** Trigger: event `cpq.quote.margin_changed` (or
   `cpq.quote.status_changed` with `toStatus = in_approval`). `filterConditions`:
   `marginPercent < 15` **or** `hasPendingCosts = true`. A user task goes to the
   deal desk; `contextMapping` carries `quoteId` and `marginHash`.
2. **Remember what was approved.** When the task is approved, store the quote's
   `marginHash` as the approved hash.
3. **Enforce it with a mutation guard**, from the stored hash and not from the
   event, so a lost event never lets an unapproved margin through:

```ts
// src/modules/@app/margin_approval/data/guards.ts
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const marginApprovalGuard: MutationGuard = {
  id: 'margin_approval.require-approved-hash',
  targetEntity: 'cpq.quote',
  operations: ['update'],
  priority: 40,
  async validate(input) {
    const payload = input.mutationPayload ?? {}
    const sending = payload.action === 'transition_status' && payload.targetStatus === 'with_customer'
    if (!sending && payload.action !== 'convert_to_order') return { ok: true }
    const approved = await loadApprovedHash(input.resourceId) // your own store
    const current = await loadCurrentMarginHash(input.resourceId) // read the quote's margin
    if (approved === current) return { ok: true }
    return { ok: false, status: 422, message: 'Margin not approved for the current costs' }
  },
}
export const guards: MutationGuard[] = [marginApprovalGuard]
```

Guards run first on status changes, conversion and on the cost write routes
(resource kinds `cpq.quote`, `cpq.quote_line_cost`, `cpq.quote_markup_override`).
`approvalInvalidated: true` on `margin_changed` tells your workflow to
invalidate an earlier approval after a lock-exempt cost edit.

## API

| Method | Path | Feature | Notes |
|---|---|---|---|
| GET / POST / PUT / DELETE | `/api/cpq/charge-cost-elements` | `cpq.products.view` + `cpq.costs.view` (writes: manage) | Cost elements of a charge. |
| POST | `/api/cpq/cost-preview` | `cpq.pricing.view` + `cpq.costs.view` | Costs and list price of a configuration. Persists nothing. |
| GET | `/api/cpq/cost-plus/usage` | `cpq.costs.view` | Counts to check before turning the toggle off. |
| GET | `/api/cpq/quotes/{quoteId}/costs` | `cpq.quotes.view` | Cost lines (status only without `cpq.costs.view`); with it: markup overrides and `margin`. |
| POST | `/api/cpq/quotes/{quoteId}/costs` | `cpq.quotes.manage` + `cpq.costs.manage` | Manual cost. |
| PATCH / DELETE | `/api/cpq/quotes/{quoteId}/costs/{costId}` | same | Enter / confirm / edit; delete manual only. |
| PUT / DELETE | `/api/cpq/quotes/{quoteId}/markup-overrides` | same | Set / clear a markup override. |
| POST | `/api/cpq/quotes/{quoteId}/status` | `cpq.quotes.manage` | Optional `expectedRevision`. |

Full contracts: the `openApi` export on each route.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 403 | `COSTS_VIEW_REQUIRED` | Cost-plus catalog writes (create, edit, switch away from or delete a cost-plus charge, set markup) need `cpq.costs.view`; checked before validation. |
| 404 | — | Cost endpoints with the toggle off; a cost table or entries without `cpq.costs.view`. |
| 409 | `COST_LOCKED` | Price-basis cost or markup write on a locked quote; or adding / reconfiguring (configuration, quantity) a line with an active cost-plus charge on a locked quote. |
| 409 | `STALE_REVISION` | `expectedRevision` differs from the quote's `pricingRevision`. |
| 422 | `COST_PLUS_DISABLED` | Toggle is off. |
| 422 | `NO_PRICE_BASIS_ELEMENT` | Cost-plus charge without an active price-basis element. |
| 422 | `PRICE_BASIS_REQUIRES_COST_PLUS` | Price-basis element on a non-cost-plus charge (or cost cost-plus line). |
| 422 | `COST_TYPE_MISMATCH` | Price-basis element type differs from the charge type. |
| 422 | `WRONG_TABLE_PURPOSE` / `COST_TABLE_NOT_FOUND` / `COLUMN_NOT_FOUND` / `TABLE_REQUIRED` | Table element misconfigured. |
| 422 | `MODEL_REQUIRES_TABLE` / `QUANTITY_ATTRIBUTE_REQUIRED` / `SOURCE_NOT_AVAILABLE` | Cost model or source not allowed in this shape (`index` arrives later). |
| 422 | `AMOUNT_REQUIRED` / `CURRENCY_REQUIRED` / `FIELD_NOT_ALLOWED` | Value shape errors. |
| 422 | `DUPLICATE_CODE` | Element code already used by a charge priced together with this one. |
| 422 | `PURPOSE_LOCKED` | Table purpose cannot change while referenced. |
| 422 | `NOTE_REQUIRED` / `VALIDITY_EVIDENCE_REQUIRED` | Overwrite or validity extension without a reason. |
| 422 | `CATALOG_COST_NOT_DELETABLE` / `LINE_NOT_ELIGIBLE` / `CHARGE_NOT_FOUND` / `CHARGE_NOT_COST_PLUS` | Wrong target of a cost or markup write. |
| 422 | `CURRENCY_NO_RATE` | Cost in a currency other than the quote's (no FX before a later feature). Also a line error on a cost line, and on a charge whose absolute markup is in another currency. |
| 422 | `COSTS_NOT_CONFIRMED` | Conversion blocked by unconfirmed or expired price-basis costs, or an unpriced cost-plus charge (`lines[].costKeys` / `chargeCodes`). |
| line error | `COST_PENDING` / `NO_PRICE_BASIS_COST` / `MARKUP_INVALID` / `TABLE_NO_MATCH` / `CURRENCY_NO_RATE` | On the charge or cost line; the line is not ready. |

## Coming with later features

Order and subscription costs (copied at conversion, frozen at activation),
supplier sourcing requests and answers, foreign-currency (FX) costs, ARC
(amend / renew / cancel) carrying of costs, and index-linked costs are added by
the later cost-plus features. Until then costs live on quotes only, and
`CURRENCY_NO_RATE` is the answer to any non-quote-currency cost.
