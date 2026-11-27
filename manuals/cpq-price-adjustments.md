# CPQ — Negotiated prices on quotes (price adjustments)

Spec: `.ai/specs/2026-11-10-cpq-manual-price-adjustments.md`,
`.ai/specs/2026-11-26-cpq-manual-pricing-flexibility.md` ·
App Spec: `.ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md`

A sales rep can change what the customer pays on a quote without touching the
catalog: set any price, take an amount off, or give a percentage discount, on one
charge or on a whole line. CPQ keeps the catalog price,
the price after price rules and the negotiated price side by side, so anyone
reviewing the quote can see exactly where the price came from.

This release covers **permanent** adjustments on **new-sale lines**. Time-based
prices ("first 3 months"), quote-wide discounts and negotiated prices on
existing subscription items (Amend / Renew) arrive in later releases.

## The three prices

Every charge on a quote carries:

| Price | Meaning |
|---|---|
| **List** | Catalog price from the pricing engine (pricing table, tiers, volume). |
| **Standard** | List after the engine's price rules (volume discounts, surcharges, overrides). |
| **Offer** | Standard after the rep's negotiated adjustment. This is what is converted to the order and billed. |

Price rules and negotiated adjustments are recorded the same way, as entries in
the charge's adjustment list, tagged `origin: rule` or `origin: manual`. The
quote page shows them as a **price waterfall**: List → each rule → Standard →
negotiated step → Offer.

The quote's **Pricing Summary** adds deal value (list, standard, offer — recurring
charges × term in months plus one-time charges) and **discount depth**: how far
price rules, negotiated adjustments and both together moved the price. A
surcharge or a negotiated price above standard shows as `+5%` (a negative
discount), a discount as `−20%`. A charge priced above its standard price also
gets an **Above standard** badge.

## Operator flow

Spec `.ai/specs/2026-11-27-cpq-billing-phases-ux-feedback.md` (one Price dialog).

1. Open a quote in status **New**, **Incomplete** or **Ready**.
2. Click the **%** button (tooltip "Adjust price") on a line row, or on a charge
   row to start on that charge. Both open the same wide **Price dialog**.
3. **Current prices** (top): the line's charges (the whole bundle on a bundle
   parent) with list, standard, offer, quantity, total and **Priced by**: what
   sets the offer now (*Line · recurring: 2 phases*, *Charge: Set price 80.00*, a
   price rule, or *—*). A phased charge shows its schedule on one line under it.
4. **Applies to** picks the target. Each option shows what is set on it now:
   | Option | Shown when | Types | Phases |
   |---|---|---|---|
   | Whole line · recurring | the line (bundle) has MRC charges | Set price, % off, Amount off | yes |
   | Whole line · one-time | it has NRC charges | Set price, % off, Amount off | no |
   | Whole line · all charges | it has both | % off | no |
   | Charge · *name* | each MRC / NRC charge | Set price (Set charge total on volume / tiered), % off, Amount off | MRC only |

   The line's **%** opens the first target that has an adjustment, otherwise
   *Whole line · recurring* (*one-time* when there is no MRC). Picking a target
   loads what is on it; a free target starts empty. **A second adjustment on the
   same line = another target** (e.g. recurring phases plus 20 % off the setup fee).
5. On a recurring target choose **One price** or **Price phases** (below).
   *One price* is a Type and a Value, priced every month. Line *Set price* and
   *Amount off* are the line's recurring or one-time total, spread over its
   charges in proportion to their standard totals (the rounding cent goes to the
   largest charge; if every charge is at 0, the first takes it all).
6. Choose a **reason** (required) and an optional note (required for "Other").
   They apply to every row the save writes. *Price phases* starts with
   **Promotion**; *One price* starts empty, so you pick the reason. A stored or
   picked reason is kept when you switch between the two.
7. The draft is **previewed live** (nothing saved), but the dialog shows only
   what needs attention: a conflict with another target, what is still missing
   (e.g. a reason), a charge priced **above the standard price**, a charge that
   keeps its own price, and what the save replaces ("Replaces 2 phases"). It
   shows no before → after prices: the current prices are in the table at the top.
8. **Save** (`Ctrl/Cmd+Enter`; `Esc` cancels) writes the whole target in one go
   (`PUT …/price-adjustments/target`): one reprice, one undo for the whole save.
   **Remove adjustment** (after a confirmation) clears the target.
9. The **Price adjustments** panel under the lines shows **one row per target**:
   the price ("2 phases: Free trial (month 1) → 50% off (months 2–4), then
   regular"), reason and note, and the **author name** (else the email; the user
   id is in the tooltip) and date of the set's latest change. **Edit** opens the
   dialog on that target; **Delete** removes the whole target.
10. The **order** shows the same table, read-only, on its Line items tab: the
   source quote's adjustments are frozen once it is converted.

### Rules

- **One adjustment per charge applies.** A charge adjustment beats a line
  adjustment, which beats an inherited bundle adjustment. They never compound.
  When a charge has its own adjustment, a line *Set price* is spread over the
  other charges only, so the line total still equals the typed price (it cannot
  go below 0: if the charge prices alone exceed it, the rest becomes 0).
- **Any price is allowed, also above standard.** An uplift shows as a negative
  discount with an **Above standard** badge. The permission
  `cpq.quotes.adjust_price` and the `cpq.quote.pricing_changed` event stay, so an
  approval workflow can react to it.
- **Usage charges** cannot be adjusted.
- **One adjustment set per target, never two on the same price in the same
  month.** *All charges* overlaps *recurring* and *one-time*; a permanent price
  overlaps every phase of its target. The preview names the other target
  ("Overlaps *Whole line · recurring — 2 phases*. Remove it first, or pick it in
  Applies to.") and Save stays disabled; the API answers `422 ADJUSTMENT_OVERLAP`
  with the other row's `adjustmentId`.
- **Most specific wins, informational.** When a charge has its own adjustment,
  the preview of a line target says "*Monthly fee* keeps its own price: a charge
  adjustment beats a line one".
- **Locked after submission.** Once the quote leaves New / Incomplete / Ready
  (e.g. *In approval*), adjustments are read-only: move the quote back to
  **Ready** to change them. A converted quote is always locked. On a locked
  quote **Delete** is offered only for an invalid row and removes only the
  invalid rows of the target.
- **Invalid adjustments are kept, not applied.** If a reconfiguration removes the
  adjusted charge, or the quote currency changes, the adjustment gets an
  **Invalid** badge, the charge falls back to the next valid price, and the line
  becomes *incomplete*. Delete or edit it. An invalid
  adjustment can still be deleted while the quote is submitted.
- **Conversion uses stored prices.** Converting to an order copies the stored
  waterfall without re-pricing. A quote with an invalid stored adjustment cannot
  be converted (`422 ADJUSTMENT_INVALID`).
- **Copies and removals.** Cloning a quote copies its adjustments; removing a
  line removes its adjustments (and those of its bundle components).
- **Amend / Renew / Cancel quotes.** Lines that mirror existing subscription
  items cannot be adjusted yet (tooltip explains why). Lines added on the change
  quote can.

## Price phases (trials, promotions, ramps)

Spec `.ai/specs/2026-11-26-billing-price-phases-ramp-deals.md` (Phase 2). A
price can change over the months of the subscription:

| Deal | How |
|---|---|
| First month free | Phase *Free*, 1 month |
| 50% off for 3 months | Phase *% off* 50, 3 months |
| Free month, then 50% for 2 months | *Free* 1 month → *% off* 50, 2 months |
| Ramp 100 / 110 / 120 | *Regular price* 1 year → *Set price* 110, 1 year, **Then** *Set price* 120 (or, on a product listed at 120: *Set price* 100, 1 year → *Set price* 110, 1 year) |
| 40 % off in months 4–6 only | *Regular price* 3 months → *% off* 40, 3 months |

**Operator flow.** In the Price dialog, pick a recurring target and switch to
**Price phases**. Rows stored with any month range (through the API, the AI or
an older version) open here. Each step has:

- a **length** in months or years (= 12 months);
- a **kind**: *Regular price* (a gap at the regular price, no row stored),
  *Free* (= Set price 0), *Set price*, *% off* or *Amount off*;
- a **value** and a **name**.

Steps run back to back from month 1, at most **12** (Regular price steps
included: each becomes one billing phase); reorder them with ↑ / ↓. The
**Then** row is what applies after the last step: *Regular price* (default) or
a *Set price* / *% off* / *Amount off* that runs to the end. So "40 % off in
months 4–6 only" is *Regular price 3 months → % off 40, 3 months*, and a ramp
100 → 110 → 120 on a product listed at 100 is *Regular price 1 year → Set price
110, 1 year*, **Then** *Set price 120* (above standard is allowed). At least one
step must not be *Regular price*, otherwise use One price. Switching modes keeps
the other mode's input until Save; Save replaces everything on the target.

**Suggested names.** Each step's name is prefilled, in the rep's UI language,
until the rep types in it (any suggestion can be changed): *Free trial* (Free,
first step), *Free* (Free, later), *50% off*, *10.00 off*, *Year N* (Set price
over exactly 12 months starting on a year boundary), otherwise *Special price*.
Regular price steps and the Then price have no name: the Then price becomes the
item's regular price in billing. Names travel to the billing item and the
invoice as typed; a name in the rep's language prints as is on an invoice in
another language, so edit it when that matters. Billing keeps its "Phase N"
fallback for unnamed phases created through its API.

**Rules.**
- Phases price **recurring (MRC)** charges only: a line phase targets the
  line's recurring total (`chargeTypeFilter: mrc`, else `PHASE_RECURRING_ONLY`),
  a charge phase an MRC charge.
- **No overlaps** on one target: two adjustments on the same target may not
  share a month (`ADJUSTMENT_OVERLAP`). A permanent adjustment (every month)
  overlaps every phase on its target.
- **No phase past the line's term** (`PHASE_PAST_TERM`, when the line has a term).
- The **reason** is required, as for every adjustment.
- **Per-month waterfall.** Each month: list price → the price rules in force
  that month (including rule phases, see the price rules manual) = standard
  price → the manual adjustment in force that month = offer price. A manual
  phase can cancel a rule promotion (Set price to the regular price) or deepen
  it (an extra % off).
- **Schedule.** A phased charge carries `schedule`: month ranges with the
  standard and offer price and the **source** (*Rule*, *Manual*, *List*). The
  charge breakdown shows it ("Price phases"), with the regular price last. The
  charge's own price, the line MRC and the quote MRC total are the **regular
  price**; the **deal value** sums every month of the term at its phase price.
- **Pricing signals.** Adding or changing a phase changes the snapshot hash, so
  `cpq.quote.pricing_changed` fires; the snapshot's `hasTimeBasedAdjustments`
  is `true`.
- **Amend / Renew / Cancel (D8).** Phases only on new lines and lines added on
  the change quote. Existing (mirrored) lines stay not eligible and continue at
  the regular price.
- **Order, subscription, billing.** The order line and subscription item keep
  the schedule. The activation event and ARC `addedItems` carry it on the
  recurring charge as `phases` (contract C2): the item's MRC charges of one
  billing period are merged into one schedule (union of the boundaries, prices
  summed), each phase `{ name, months, priceType: 'fixed', value }`, and
  `unitPrice` is the regular price.

## Permissions and rollout

| Control | Effect |
|---|---|
| Feature `cpq.quotes.adjust_price` (with `cpq.quotes.manage`) | Create, edit and delete adjustments. Granted to `admin` and `employee` by default. |
| Feature toggle `cpq.manual_price_adjustments` | Turns the capability on per tenant. Seeded **on**; switch it off to hide the actions and refuse writes (`403`). Stored adjustments keep pricing quotes. |
| Dictionary `cpq.price_adjustment_reason` | Reason list, editable under Dictionaries. Seeded with: competitive match, volume commitment, loyalty, promotion, strategic deal, price correction, other. |

**Upgrading an existing installation:** after `yarn mercato db migrate`, run
`yarn mercato cpq seed-price-adjustments` and `yarn mercato auth sync-role-acls`.

## Approvals (project configuration)

CPQ does not decide who approves a discount. It emits two events after every
committed change, each carrying the pricing snapshot (`dealValue`,
`discountDepth.rule / manual / total / maxLineManual`, `snapshotHash`,
`pricingRevision`, `quoteType`, `cpqStatus`):

| Event | When |
|---|---|
| `cpq.quote.pricing_changed` | A save changed the quote's prices or adjustments (`cause`: `adjustment`, `line`, `recalculate`, `clone`). Not emitted for previews, no-op recalculations or reason / note edits. |
| `cpq.quote.status_changed` | Any status change — `cause: manual` (operator, with `actorUserId`) or `auto` (recalculation moved it between New / Incomplete / Ready). |

A typical project recipe with Open Mercato **Workflows**:

1. **Route approvals.** A workflow with an event trigger on
   `cpq.quote.status_changed`, `filterConditions` on `toStatus = in_approval`
   and `discountDepth.manual > 0.15`, that creates a user task for a sales
   manager. Use `contextMapping` to carry `quoteId` and `dealValue.offer`.
2. **Catch stuck quotes.** A timer step that escalates quotes still
   `in_approval` after N days.
3. **Enforce it.** A mutation guard on resource kind `cpq.quote`, action
   `transition_status` (and `convert_to_order`), that refuses
   `→ with_customer` / conversion while the quote's stored `snapshotHash` has
   not been approved. Use the stored hash, not the event, so a lost event never
   lets an unapproved price through.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/cpq/quotes/{quoteId}/price-adjustments` | List, `pricingRevision`, `enabled`, `reasons`. Each item carries `createdByName` / `createdByEmail` (resolved on the server). |
| PUT | `/api/cpq/quotes/{quoteId}/price-adjustments/target` | **The dialog's save.** Replaces every adjustment on one target (`{ level: 'line', quoteLineId, chargeTypeFilter: 'mrc' \| 'nrc' \| null }` or `{ level: 'charge', quoteLineId, chargeCode }`) in one undoable write: `phases[]` (`months`, `adjustmentType` `regular` / `price_override` / `discount_percent` / `discount_absolute`, `value`, `name`; at most 12), `then` (`{ adjustmentType, value, name? }`: the price after them, or the One price when there are no phases; `name` is optional, kept so a resave of an API-stored set rewrites nothing), reason, `expectedRevision`. `phases: []` + `then: null` clears the target, also for a charge that has left the line (its orphan rows are removed). Unchanged rows keep id, author and date. 409 `ADJUSTMENT_LOCKED` / `STALE_REVISION`; 422 `PHASE_RECURRING_ONLY`, `PHASE_PAST_TERM`, `PHASE_TOO_MANY`, `ADJUSTMENT_OVERLAP`, reason and value codes (`stepIndex` points at the step). |
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments/target/preview` | Same body, no write: `{ quote, errors }`, overlaps reported with `conflictsWith`. |
| GET | `/api/cpq/orders/{orderId}` | `priceAdjustments`: the source quote's rows, read-only, with author and `reasonLabel` (needs only `cpq.orders.view`). |
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments` | Create. A line-level `price_override` / `discount_absolute` needs `chargeTypeFilter` `mrc` or `nrc` (`CHARGE_TYPE_REQUIRED`). Send `expectedRevision` to avoid overwriting a colleague's change (`409 STALE_REVISION`). Optional `fromMonth` / `toMonth` (1-based, inclusive, `toMonth` null = to the end) and `phaseName` make it a price phase. |
| PATCH / DELETE | `/api/cpq/quotes/{quoteId}/price-adjustments/{adjustmentId}` | Level and target are immutable. The month range and `phaseName` can change. |
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments/preview` | Price one draft row without saving (per-row API). |
| POST | `/api/cpq/quotes/price` | Public calculator. `includeWaterfall: true` adds list / standard prices; negotiated prices never appear here. |

Full contracts: the OpenAPI document (`openApi` on each route) and the spec.

The AI assistant reads adjustments (`cpq.list_price_adjustments`, `cpq.get_order`) but never writes them: see `manuals/cpq-ai-agent.md`.
