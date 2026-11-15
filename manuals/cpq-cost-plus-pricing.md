# CPQ — Cost-plus pricing, quote costs and margin

Spec: `.ai/specs/2026-11-12-cpq-cost-plus-quote-pricing-margin.md` ·
App Spec: `.ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md` (feature 1 of 6)

Some offers are sold as *what it costs us plus a markup*: a partner carrier's
tail circuit, hardware bought at a supplier's rate table. With cost-plus pricing
CPQ prices such a charge from its **costs**, shows the sales team how much of
the price is cost, and lets a pricing manager see — and govern — the **margin**
of a quote. Everything downstream is unchanged: price rules and negotiated
adjustments apply to a cost-plus price exactly as to any other list price.

This release covers **known costs on quotes**, their **carry-through to
orders, subscriptions and assets**, **supplier cost sourcing** (asking a
carrier for a cost and recording the answer) and **foreign-currency costs**
(a USD tail on a EUR quote, converted at a dated rate). See
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
(only **costs** are converted, see
[Foreign-currency costs](#foreign-currency-costs); a markup amount is not). The
absolute amount of a markup **override** is entered in the quote currency.

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

A quote's costs are carried to the order and the subscription (see
[Orders and subscriptions](#orders-and-subscriptions)); what an ARC quote does with
them is described there. On an ARC quote:

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

## Orders and subscriptions

Costs follow the deal after the quote is accepted, so the contracted cost and
margin stay visible for the whole life of the subscription. Nothing in this
section changes a price or a billing event: the billing payload of an activation
is byte-identical to the one of the same quote without costs.

### At conversion

Converting an accepted quote to an order **copies every cost line** of the quote
to the order (one copy per quote cost line, with its value, supplier, validity
and status). The copy happens in the same transaction as the order, so a
conversion that is refused (see [Conversion guard](#conversion-guard)) writes
nothing. The order is then a frozen record of what the deal costs: later edits
of the catalog or of the quote never change it.

### At activation

Activating the order creates **one inventory cost per order cost**:

- the costs of a **subscription line** belong to its **subscription item**;
- the costs of an **assetizable line** (a server, a router) belong to the
  **asset** created for it, not to an item.

Activation is **atomic**: if any step fails, no subscription, item, asset, cost
or Change History row is saved and no event is sent; activating again starts
clean. Costs are written **whatever the tenant toggle says** — turning
`cpq.cost_plus` off later never removes costs from a live subscription.

### Where costs show

| Place | What |
|---|---|
| **Order page** (and the order tab on the sales order) | A Costs section per order line, with a link to the asset a line became. Holders of `cpq.costs.view` also see the **Order margin** card. |
| **Subscription page** | Costs inside each item's panel with the **item margin**, a Costs section with the **subscription roll-up** (items and assets) and the costs and margin of each cost-owning asset, and an **Ended costs** toggle (ended costs are hidden by default). An item or asset without costs says "No cost recorded". |
| **Asset page** | A Costs section with the asset's costs and margin; an asset that hangs under an item links to it. |
| **Change History** (subscription page) | Under each entry, a **Cost changes** block lists the costs that changed between the *before* and *after* snapshots: `changed` ("Tail · 270 EUR -> 300 EUR · Carrier X"), `added`, `ended` and `moved` (a merge re-points costs from the merged contracts to the new one). A filter above the list narrows the cost changes to one item or asset. The `created` entry lists every cost written at activation, including those of new-sale assets. |

### Who sees what

Users **without** `cpq.costs.view` get the **status-only projection** everywhere:
the cost names, roles and **status chips** (pending / estimated / confirmed /
expired, Ended) and never an amount, supplier, margin or markup. The Change
History of such a user has no cost diff at all (the API removes the `costs`
keys from the snapshots, so there is nothing to show). Costs are read-only on
orders and subscriptions for everyone: they are corrected on a **change quote**
(below), never edited in place. With the toggle off the cost sections are
hidden (`404` from the cost endpoints).

### Change quotes (Amend, Renew, Cancel)

- **Renew freezes a cost-plus price.** The Renew mirror line of a cost-plus item
  (an item whose stored charges contain a cost-plus charge) keeps the
  **contracted price** instead of being re-priced at today's standard, exactly
  like an Amend mirror. The quote page shows the banner *"Costs are not carried
  to change quotes yet"* on such lines (to everyone, no amounts). Changing a
  pricing input of the line **un-freezes** it and re-prices it from today's costs.
  Renew mirrors of non-cost-plus items behave as before.
- **Reconfigured lines get cost lines.** A mirror line whose pricing inputs
  changed (configuration, quantity) gets catalog cost lines like a new line; an
  unchanged mirror never does, so it keeps the stored costs.
- **Activation writes the costs back.** A reconfigured line updates the item's
  costs **in place** (same cost ids; a cost whose value did not change is not
  touched and is not reported as a change); an added item creates its costs; a
  removed item ends them. The item cost ids never change, so history and links
  stay valid. Every change is recorded in the Change History snapshots.
- **Cancel ends every cost.** Cancelling a subscription (or removing an item)
  ends its open costs, and the costs of the assets that are cancelled with it.
  Ended costs stay in the history; they are no longer *open* and do not count in
  margins.
- **Merge keeps the ids.** Merging contracts **re-points** the item and asset
  costs to the cloned items and migrated assets of the new contract (the same
  cost ids); the merged contracts keep no cost.

### Rolling back

The Change History snapshots of an upgraded tenant carry cost values. Before
rolling the code back, run `yarn mercato cpq scrub-change-log-costs --dry-run`
(add `--tenant <id>` for one tenant), then without `--dry-run`. The command
removes only the `costs` keys of the snapshots, is idempotent and pages through
the rows. The order is **scrub, then code, then down-migration**; see
`packages/cpq/MIGRATION.md`.

## Supplier cost sourcing

A third-party cost (a partner tail circuit, a carrier cross-connect) is unknown
until the supplier quotes it. A **cost request** records who asked for it, when,
and which answer belongs to it. A request is **a state of a cost line**, not a
separate document: a cost line holds at most one open request, identified by a
`costRequestId` and a sequence number (`requestSeq`).

### Lifecycle

| `sourcingStatus` | Meaning |
|---|---|
| `not_requested` | Nothing asked yet (also every cost line of a cloned quote). |
| `requested` | A request is open; the Cost requests page lists it. |
| `answered` | The supplier answered and the value is applied (or, on a locked quote, confirmed or waiting as a proposal). |
| `declined` | The supplier cannot supply. |
| `cancelled` | The request became meaningless (reason below). |

**Opening a request.**
- *Automatically*, on a **saved** recalculation, for every `on_request` cost line
  whose element has **Requires sourcing**, whose value is not yet confirmed and
  that was never requested (or was just reset by a reconfiguration). Previews
  never open one; locked quotes, unreconfigured ARC mirror lines and a tenant with
  the toggle off never auto-open. A cloned quote starts `not_requested`; its first
  saved recalculation does not open requests either (a later one may).
- *Manually*, with **Request cost** on the quote's Costs panel
  (`POST /api/cpq/quotes/{quoteId}/costs/{costId}/request`). Allowed on any cost
  line except those of a **Cancel line** and frozen cost lines that cannot be
  re-priced (`422 LINE_NOT_ELIGIBLE`), and also on locked quotes. Requesting again
  closes the open request as `re_requested` and opens the next sequence number.

**Closing a request.** An open request is cancelled, in the same write as its
cause, when:

| `cancelReason` | Cause |
|---|---|
| `reconfigured` | A driving attribute changed and the cost was reset to its estimate. |
| `line_removed` | The quote line was removed. |
| `element_deactivated` | The cost element was deactivated (or no longer applies to the charge). |
| `re_requested` | A new request replaced it. |
| `manual_value` | Someone entered a value or status by hand (a note or supplier-data edit does not cancel). |
| `quote_closed` | The quote was rejected, cancelled, deleted in CPQ, or **converted** to an order. |
| `cancelled_by_user` | **Cancel request** on the Costs panel (`POST …/cancel-request`) — closes the request without touching the value. |

Accepting a quote keeps its requests open: an accepted but still indicative quote
needs its answer. Re-opening a closed quote does not re-open requests; request
again. Element deactivation cancels each quote's requests in a write of its own
right after the catalog change (best effort); the quote's next saved
recalculation and the answer-side check below back it up.

### Answering and declining

An answer is posted by procurement on the **Cost requests** page or by a project
workflow / integration through the API:

```http
POST /api/cpq/quotes/{quoteId}/costs/{costId}/answer
{
  "costRequestId": "…",          // the cost line's CURRENT request id
  "unitAmount": 280,             // per instance, 0..999 999 999 999
  "currencyCode": "EUR",         // ISO 4217 format, upper-case
  "valueStatus": "confirmed",    // or "estimated" (a budgetary answer); default confirmed
  "supplierQuoteRef": "CARR-889",// required, 1..100 chars: the idempotency key
  "validUntil": "2026-12-31",    // optional, not before today
  "supplierTermEnd": "…", "supplierMinTermMonths": 12,
  "supplierId": "…", "supplierName": "…", "note": "…"
}
```

The response is `{ outcome, cost, lineReady, pricingRevision }`; `cost` carries
the amount only for holders of `cpq.costs.view` (the answer route needs it anyway).
The answer takes the quote's lock itself, so there is no `expectedRevision`.

| `outcome` | When |
|---|---|
| `applied` | Unlocked quote: the value is stored (`value_origin = supplier`) and the quote re-prices. |
| `confirmed_unchanged` | Locked quote, same amount and currency: the line becomes confirmed, the price does not change. |
| `proposed` | Locked quote, a different value: stored as a **proposal** only; see below. |
| `noop` | An exact repeat (idempotency). No write, no revision bump, no event. |

**Order of the checks** (the first that fails answers, nothing is written): cost
line `404` -> `QUOTE_CLOSED` -> `QUOTE_CONVERTED` -> `COST_PLUS_DISABLED` ->
`LINE_NOT_ELIGIBLE` -> `COST_REQUEST_SUPERSEDED` (a stale request id, or a cost
element that is now inactive) -> **noop** (same `supplierQuoteRef` and same
payload hash) -> `SUPPLIER_QUOTE_REF_CONFLICT` (same reference, different payload)
-> `REQUEST_NOT_OPEN`. Only after these do the format checks `INVALID_CURRENCY_CODE`
and `VALID_UNTIL_IN_PAST` run (`422`), so a retried answer never fails on a date
that has passed in the meantime. The payload hash covers the request id, amount
(4 decimals), currency, status, dates and supplier fields; it is stored on the
cost line, so a retried answer is recognised even after the request was applied.
A cloned quote accepts the reference its source used: the hash is per cost line.

**Declining.** `POST …/decline` with `{ costRequestId, reason }` (1..500
characters). On an unlocked quote the value becomes `none` (an estimate moves
into the note) and the line is not ready until an alternative supplier's value is
entered on the same cost line. On a locked quote the amount is kept and its
status drops to `estimated`, so conversion is refused (`COSTS_NOT_CONFIRMED`)
until the quote is reopened. `409 REQUEST_NOT_OPEN` when the request is already
closed.

**Foreign-currency answers.** An answer in a currency other than the quote's is
recorded with the supplier's own amount and currency and converted like any
foreign-currency cost (see [Foreign-currency costs](#foreign-currency-costs)).
When no rate exists it stays `none` with `CURRENCY_NO_RATE` (the answered
notification says "exchange rate missing") until a rate is maintained and the
quote is next recalculated.

**Margin-only costs** are exempt from the cost lock: an answer is always applied
(never a proposal) and a decline follows the unlocked rule.

### Locked quotes: proposals and "Reopen and apply"

On a `with_customer` / `accepted` quote the price must not move under the
customer. A different-value answer is therefore a **proposal**
(`hasAnswerPending`): the line keeps its value, the page shows "Supplier answered
with a different cost", and **conversion is refused with `422 COST_ANSWER_PENDING`**
(listing the lines; checked before `COSTS_NOT_CONFIRMED`, because the proposal is
the actionable reason). **Reopen and apply supplier answer**
(`POST …/costs/{costId}/apply-answer` with the current `expectedRevision`, needs
`cpq.quotes.manage` + `cpq.costs.manage`) moves the quote back to `ready`, applies
the proposal under the same request id, clears it and re-prices in one write. The
earlier customer acceptance must be repeated. A manual value entered on the line
discards an unapplied proposal.

### Conflicts (`409`) and who handles them

| Code | Meaning | Integration should |
|---|---|---|
| `COST_REQUEST_SUPERSEDED` | The id is not the current one (reconfigured, re-requested, cancelled) or the element is inactive. | Stop; read the cost line (or wait for the new `cost_requested` event) and answer the new id. |
| `QUOTE_CLOSED` | Quote rejected, cancelled or deleted. | Stop. |
| `QUOTE_CONVERTED` | An order exists; the response carries **`orderId`**. | Stop; the cost is now an order cost and no longer changes the quote. |
| `COST_PLUS_DISABLED` | Tenant toggle off (answer / decline only). | Retry later; the same call succeeds once the toggle is back on. |
| `SUPPLIER_QUOTE_REF_CONFLICT` | Same reference, different payload. | Do not retry; use a new reference for a corrected answer. |
| `REQUEST_NOT_OPEN` | Already answered, declined or cancelled. | Stop. |
| `STALE_REVISION` | Request / cancel-request / apply-answer sent an outdated `expectedRevision`. | Reload and retry. |

The other sourcing routes (`request`, `cancel-request`, `apply-answer`) answer
`404` while the toggle is off; cancellation on quote close runs regardless of it.

### The Cost requests page and the queue API

**Cost requests** (`/backend/cpq/cost-requests`, group CPQ) lists requests across
quotes: quote, customer, product, cost name, the line attributes that drive the
cost, supplier, age in working days, an **Overdue** badge and an **Answer
pending** badge; filters for status (default `requested`), cancel reason,
supplier, quote id and **Overdue only**; row actions Answer, Decline (open
requests) and Open quote. **Cancel request** and **Reopen and apply supplier
answer** are on the quote's Costs panel. Notification links open the page
filtered on the quote. Requests closed by a conversion
appear under `cancelled` with reason `quote_closed`.

- `GET /api/cpq/cost-requests` needs `cpq.quotes.view` + `cpq.costs.view`.
  **Sales reps hold `cpq.costs.view` by default** (the `employee` role has it, the
  `admin` role has both costs features), so they can read the queue and see what
  procurement is working on. The list carries **no amounts, currencies or
  supplier answers**: identity, status and timing only.
- The **page** and the Answer / Decline dialogs need `cpq.costs.view` +
  `cpq.costs.manage`, so a rep without `cpq.costs.manage` does not get the page
  in the menu and cannot answer. Grant `cpq.costs.manage` to your procurement role.
- `GET /api/cpq/cost-requests/{costId}` expands one row (configuration, request
  history, current value and, for a proposal, the proposed answer).
- Rows of deleted quotes are hidden by the queue itself. (Core does not emit
  `sales.quote.deleted` today; CPQ listens for it, but the deleted-quote filter and
  the `QUOTE_CLOSED` answer check are what actually cover a quote deleted through
  the sales module.)
- Deleting a quote through CPQ (`DELETE /api/cpq/quotes/{quoteId}`) now cancels its
  open requests (`quote_closed`) in the same transaction. Behaviour is otherwise
  unchanged: `409` for an `accepted`, `rejected` or `cancelled` quote, mutation
  guards first.

**Overdue.** A request is overdue when it has been open **strictly more than N
working days** (Monday to Friday, UTC, no holiday calendar); N is the tenant
feature toggle **`cpq.cost_requests.overdue_working_days`** (default **5**, a
per-tenant number override under Settings -> Feature toggles).
`overdueThresholdWorkingDays` in the list response shows the effective value.

### Events and notifications

Three events, all **non-broadcast** (never sent to browsers), emitted after the
commit, and **carrying no amount, currency amount, markup or margin**:

| Event | When | Notable fields |
|---|---|---|
| `cpq.quote.cost_requested` | A request opens. | `quoteId` (the CPQ quote id; `salesQuoteId` too), `costLineId`, `costKey`, `costRequestId`, `requestSeq`, `attributes`, `auto`. |
| `cpq.quote.cost_request_cancelled` | A request closes without an answer. | `reason` (table above), `costRequestId`. |
| `cpq.quote.cost_valued` | A sourcing action, manual value write or reset changes a value or status. Not for catalog re-resolution. | `cause` (`answer`, `decline`, `apply_answer`, `manual_value`, `reset`), `valueStatus`, `previousValueStatus`, `answerPending`, `lineReady`, `leadTimeHours`. |

Four notification types (English texts ship in `i18n/en.json`; other locales fall
back to them): `cpq.cost_request.opened` goes to **every user of the quote's
organization holding both `cpq.costs.view` and `cpq.costs.manage`**;
`answered`, `answer_pending` and `declined` go to the **user who opened the
request** (for an auto-opened one, whose saved recalculation opened it). Texts
carry the quote number and cost name, never an amount. The `notifications` module
is optional: without it CPQ simply sends none.

### Workflow recipe (project integration)

CPQ never depends on a workflow existing; the events and the answer API are the
contract. The `demo_gix` tenant ships a recipe, **`cpq_cost_sourcing`** ("CPQ -
obtain carrier quote for partner tail"), **seeded disabled**:

1. Trigger on `cpq.quote.cost_requested`, filtered to the partner-tail cost key.
2. A user task for procurement ("Obtain carrier quote") with an outcome
   (answer / decline), amount, currency, supplier quote reference, valid-until
   and a decline reason.
3. A `CALL_API` step posts the **answer** or **decline** to the cost routes with
   the `costRequestId` the event carried, three attempts with backoff.

To use it: open **Workflows -> Definitions**, review the definition and switch
**Enabled** on. Its execution principal is granted exactly `cpq.costs.view` and
`cpq.costs.manage` by the seed (an event-triggered run has no human initiator, so
`CALL_API` needs the principal); re-save the definition in the studio if the
grant ever needs re-provisioning. Notes for operators:

- The task form fields are **optional** (the form cannot require a field only for
  one outcome). A blank amount reaches the answer route as an unresolved value and
  fails there with `422`, so the step fails visibly in the instance instead of
  recording a wrong cost; fix it by completing a new request.
- **Payload visibility:** the event payload becomes the workflow context and is
  readable by everyone who can open the workflow instance. This is why the events
  carry identity, keys and statuses only; the answer the procurement user types
  into the task form (including the amount) is stored in the instance, like any
  user-task data, so give the Workflows features only to people allowed to see
  costs.
- **Closing the task when the request is cancelled** is not automatic. A
  reconfiguration, re-request or conversion cancels the request (event
  `cpq.quote.cost_request_cancelled`), but the open user task stays until someone
  completes or cancels it. Completing it late is safe: its answer or decline gets
  `409 COST_REQUEST_SUPERSEDED` (or `QUOTE_CLOSED` / `QUOTE_CONVERTED`) and writes
  nothing. A project that wants the task closed adds a second trigger on
  `cost_request_cancelled` (same `costRequestId`) to its own definition.

### Demo data

The `demo_gix` seed adds three quotes in the IP Transit family for demos: a
requested tail that is overdue, a declined one ("No coverage at site") and a
`with_customer` quote whose supplier answer is pending as a proposal. Each is
identified by its `quoteContext.scenario`.

## Foreign-currency costs

Supplier costs often arrive in the supplier's currency: a carrier quotes the
partner tail in USD for a EUR quote. CPQ keeps the cost in **its own currency
and amount** (`300 USD`) and converts it into the quote currency with a **dated
exchange rate** from the framework **Currencies** module wherever costs are
added up (list price, margin, order and subscription costs). The rate is stored
beside the cost line — `fx_rate`, its date, its source (provider) and how it was
derived — so the price can always be explained.

**Worked example.** A 300 USD tail on a EUR quote, USD→EUR rate `0.92` dated
2026-11-11, markup 25 %: converted cost `300 × 0.92 = 276.00 EUR`, list price
`276.00 × 1.25 = 345.00 EUR`. The Costs panel shows the original amount and
`≈ 276.00 EUR · 0.92 · <source> · 2026-11-11`. The multiplication runs at full
precision and the total is rounded **once**.

### Where the rate comes from

- **Maintain rates in Currencies** (the Currencies module's exchange-rate page, or
  `POST /api/currencies/exchange-rates`): from `USD`, to `EUR`, the rate
  (`to` units per 1 `from` unit), the **date** and a **source** name (for
  example `Manual`).
- The date must be **UTC midnight** of the day the rate applies to (UTC is the
  reference day everywhere in this feature; run the servers in UTC). The look-up
  matches that instant exactly.
- **Built-in providers do not feed this today (upstream issue UP-FX-1, to be
  filed — draft in the run folder, `.ai/runs/2026-11-15-cpq-cost-plus-foreign-currency-costs/UP-FX-1-issue.md`).**
  The NBP and Raiffeisen fetchers store their rows at Warsaw-midnight (or
  intra-day) timestamps that the look-up never matches, and only for pairs
  against PLN — there is no USD→EUR row. A tenant that relies on them gets
  `CURRENCY_NO_RATE` for every foreign cost (safe: never a wrong rate). Until
  the upstream issue is fixed, maintain the rates you need **manually** or use a
  custom provider that stores UTC-midnight rates. CPQ does not work around this.
- Which rate is used (the **provider rule**). The Currencies module has no
  default-provider setting, so CPQ adds the JSON toggle
  `cpq.cost_plus.fx_source_priority` (ordered source names, default `[]`):
  the first listed source that has a rate wins; otherwise a single rate is used
  as it is; several unlisted rates are tie-broken by source name ascending. The
  chosen source is stored on the line.
- **Direct before inverse.** The cost-currency → quote-currency pair is looked up
  first, from any source. Only when **no** source has a direct rate does CPQ use
  the opposite pair as `1 / rate` (8 decimals), marked `derivation = inverse`.
  There is no triangulation through a third currency. **Bid / ask caveat:** the
  two directions of a provider pair can be different rate types (a bank buys at
  one rate and sells at another), so `1 / rate` of one direction is not the
  other direction's quoted rate. Where it matters, maintain both directions or
  the direct pair you actually want.
- **Look-back.** A rate may be older than the quote day: the most recent rate
  within `cpq.cost_plus.fx_max_days_back` days (default 7, 0 to 30; per-tenant
  override in Feature toggles) is used, and its real date is shown. Older than
  that is "no rate".

### No rate: `CURRENCY_NO_RATE`

With no usable rate (none in the window, a non-positive stored rate, the
`currencies` module not installed) the cost line is **pending** (`none`) with
`CURRENCY_NO_RATE`, keeps the amount and currency that were entered, and the
line is not ready. A cost is **never** converted 1:1. Once a rate is maintained,
the line becomes ready on the next saved recalculation while the quote is
unlocked (status `estimated` for a manual or supplier value, so a pricing manager
confirms it; catalog values become `confirmed`). A locked quote keeps `none`
until it is reopened.

**Finding missing rates.** `GET /api/cpq/cost-plus/usage` returns
`missingFxPairs: [{ from, to, openQuotes }]` — every pair on which a cost line of
an unlocked (New / Incomplete / Ready), unconverted quote has no rate, with the
number of affected quotes (most affected first). Locked quotes are not counted:
they keep their stored cost until reopened, so a new rate cannot fix them. The cost dialog shows "No USD→EUR rate for 2026-11-12"
next to the amount while no rate is maintained.

### When the rate is taken, and when it freezes

| Situation | Rate |
|---|---|
| **Saved** recalculation or cost write on an unlocked quote (New / Incomplete / Ready, no order) | Resolved for today (UTC) and stored — price and margin can move between saves (`pricing_changed` / `margin_changed` are emitted as usual). |
| Quote **locked** (with customer, in approval, approved, accepted, ...) or **converted** | The stored rate is reused; a newer rate changes nothing. |
| Renew / Amend **mirror lines** and lines carried from a subscription item | Always keep their carried rate (a contracted cost never re-rates silently). |
| Unsaved recalculation, cost preview, calculate-price | Computed in memory with today's rate; nothing is stored. |
| Conversion to an order, activation of a subscription | The four rate fields are copied unchanged; no look-up. |
| A new foreign-currency cost, or a re-entered value, on a locked quote (margin-only costs) | Takes the rate of the write day; the price does not move. A same-value confirmation keeps the stored rate. |

So **a sent quote never moves with the rate**. A quote that is still being
worked on follows the market until it is sent; to re-rate a locked quote, move
it back to Ready and save a recalculation.

Order and subscription costs hold the **document-currency** total
(`instance × quantity × rate`, rounded once) next to the original cost
amount, so order and subscription margins match the quote margin.

### Cost tables

A `table` cost element looks in entries of the **quote currency** first; only when
none matches does it use entries in the element's **currency** (the "fallback
table currency" field) and convert them. With neither, the line is
`CURRENCY_NO_RATE`.

### Calculate-price: prices move daily

`POST /api/cpq/quotes/price` converts foreign-currency costs at today's rate in
memory and never returns a rate, a cost currency or a cost amount. Without a
rate the charge is `priceOnRequest`. Because the rate is looked up for each
request, a **public calculator price built on a foreign-currency cost changes
whenever a new daily rate is maintained** (accepted; calculator prices are
indicative and stored nowhere).

### Without the Currencies module

CPQ does not require it. Without `currencies` registered every foreign-currency
cost is `CURRENCY_NO_RATE`, and nothing logs an error at startup.

### Confidentiality

The rate, its date, source and the converted amount are cost data: visible only
with `cpq.costs.view`, never in quote, order, calculate-price, event or change-log
responses for other users.

### Demo data

`demo_gix` (with examples) seeds USD→EUR rates for the last three days (source
`Manual`, UTC midnight: `0.92`, `0.915`, `0.91`) plus today's rate for each of the
next 29 days (the resolver only looks back, so this keeps the demo quote priced
for a month; re-run the seed to extend it) and the quote "Demo — IP Transit,
USD partner tail converted to EUR" (fixed 300 USD tail, EUR quote, list price
345.00 at today's rate). Re-running the seed adds the rate of the new day.

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
| GET | `/api/cpq/orders/{orderId}/costs` | `cpq.orders.view` | Order line costs; status only without `cpq.costs.view`, with it the amounts and `margin`. |
| GET | `/api/cpq/inventory/subscriptions/{subscriptionId}/costs` | `cpq.inventory.view` | Item and asset costs, margins, roll-up; `?includeEnded=true` adds ended costs. |
| GET | `/api/cpq/inventory/assets/{assetId}/costs` | `cpq.inventory.view` | Costs and margin of one asset (`ownerItemId` for an asset under an item). |
| POST | `/api/cpq/quotes/{quoteId}/costs/{costId}/request` | `cpq.quotes.manage` | Open (or re-open) a supplier cost request. Ids and statuses only in the response. |
| POST | `/api/cpq/quotes/{quoteId}/costs/{costId}/cancel-request` | `cpq.quotes.manage` | Cancel the current request (`costRequestId`). |
| POST | `/api/cpq/quotes/{quoteId}/costs/{costId}/answer` | `cpq.costs.view` + `cpq.costs.manage` | Answer the current request; idempotent on `supplierQuoteRef`. |
| POST | `/api/cpq/quotes/{quoteId}/costs/{costId}/decline` | `cpq.costs.view` + `cpq.costs.manage` | Decline the current request with a reason. |
| POST | `/api/cpq/quotes/{quoteId}/costs/{costId}/apply-answer` | `cpq.quotes.manage` + `cpq.costs.manage` | Reopen a locked quote and apply a pending proposal (`expectedRevision` required). |
| GET | `/api/cpq/cost-requests` | `cpq.quotes.view` + `cpq.costs.view` | Request queue across quotes, no amounts. |
| GET | `/api/cpq/cost-requests/{costId}` | same | One request: configuration, history, current value, proposal. |

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
| 422 | `CURRENCY_NO_RATE` | No usable exchange rate for a cost in a currency other than the quote's (none within the look-back window, or the `currencies` module is not installed). Also a line error on a cost line (`errorDetail` names the pair and date), and on a charge whose absolute markup is in another currency. |
| 409 | `COST_REQUEST_SUPERSEDED` / `REQUEST_NOT_OPEN` / `SUPPLIER_QUOTE_REF_CONFLICT` | Sourcing: stale request id (or inactive element), request already closed, same supplier reference with a different answer. |
| 409 | `QUOTE_CLOSED` / `QUOTE_CONVERTED` | Sourcing write on a rejected / cancelled / deleted quote, or one that has an order (`QUOTE_CONVERTED` carries `orderId`). |
| 409 | `COST_PLUS_DISABLED` | Answer / decline while the toggle is off (retryable). |
| 409 | `NO_PENDING_ANSWER` | `apply-answer` on a cost line without a proposal. |
| 422 | `INVALID_CURRENCY_CODE` / `VALID_UNTIL_IN_PAST` | Answer format checks. |
| 422 | `COST_ANSWER_PENDING` | Conversion blocked by an unapplied supplier proposal (`lines[]`). Checked before `COSTS_NOT_CONFIRMED`. |
| 422 | `COSTS_NOT_CONFIRMED` | Conversion blocked by unconfirmed or expired price-basis costs, or an unpriced cost-plus charge (`lines[].costKeys` / `chargeCodes`). |
| line error | `COST_PENDING` / `NO_PRICE_BASIS_COST` / `MARKUP_INVALID` / `TABLE_NO_MATCH` / `CURRENCY_NO_RATE` | On the charge or cost line; the line is not ready. |

## Coming with later features

Index-linked costs are added by a later cost-plus feature. Foreign-currency
costs are described in [Foreign-currency costs](#foreign-currency-costs).
