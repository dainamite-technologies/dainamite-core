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

1. Open a quote in status **New**, **Incomplete** or **Ready**.
2. Expand a line. Each charge row shows **List** and **Offer** with a depth badge.
3. Pick an action:
   - **Adjust price** (button on the line row) — the whole line; on a bundle
     parent, the whole bundle (parent and components):
     - *Set price* — the line's new **recurring** or **one-time** total (choose
       one), e.g. "this line costs 500 a month". It covers all line quantities.
     - *% off* — a percentage on every billable charge of the line, or only its
       recurring / one-time charges.
     - *Amount off* — taken off the line's recurring or one-time total (choose one).
     Set price and Amount off are spread over the line's charges in proportion
     to their standard totals, so every charge keeps its own price. The rounding
     cent goes to the largest charge; if every charge is at 0, the first charge
     takes the whole amount. Want both a recurring and a one-time price? Add two
     line adjustments, one per type.
   - **Adjust price** (pencil on a charge row) — one charge:
     - *Set price* — the new unit price, e.g. 100 → 80. On volume and tiered
       charges it is **Set charge total**, because they have no single unit price.
     - *% off* — e.g. 20 %.
     - *Amount off* — taken off the charge total, e.g. 40 off.
4. Enter the value, choose a **reason** (required) and an optional note (the note
   is required for "Other"). The dialog previews standard → new price and the
depth as you type (and flags a price above standard);
   nothing is saved until **Save** (`Ctrl/Cmd+Enter`; `Esc` cancels).
5. The adjustment appears in the **Price adjustments** panel under the lines, with
   target, type, value, reason, author and date. Edit or delete it there or from
   the waterfall.

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
- **Locked after submission.** Once the quote leaves New / Incomplete / Ready
  (e.g. *In approval*), adjustments are read-only: move the quote back to
  **Ready** to change them. A converted quote is always locked.
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
| Ramp 100 / 110 / 120 | *Set price* 100, 1 year → *Set price* 110, 1 year; the list price 120 is the regular price |

**Operator flow.** On a line (button **Phases**, the line's recurring total) or
on a recurring charge (calendar icon), add steps: a length in **months** or
**years** (= 12 months), a price type (**Free** = Set price 0, **Set price**,
**% off**, **Amount off**), a value and an optional name ("Free trial",
"Year 1"). Steps run back to back from month 1. After the last step the
**regular price** applies. One reason covers all steps. Each step is saved as a
manual adjustment with a month range (`fromMonth` / `toMonth`), one write at a
time; edit or delete a step from the **Price adjustments** panel (the row shows
its months and name). The edit dialog also accepts a month range directly.

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
| GET | `/api/cpq/quotes/{quoteId}/price-adjustments` | List, `pricingRevision`, `enabled`, `reasons`. |
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments` | Create. A line-level `price_override` / `discount_absolute` needs `chargeTypeFilter` `mrc` or `nrc` (`CHARGE_TYPE_REQUIRED`). Send `expectedRevision` to avoid overwriting a colleague's change (`409 STALE_REVISION`). Optional `fromMonth` / `toMonth` (1-based, inclusive, `toMonth` null = to the end) and `phaseName` make it a price phase. |
| PATCH / DELETE | `/api/cpq/quotes/{quoteId}/price-adjustments/{adjustmentId}` | Level and target are immutable. The month range and `phaseName` can change. |
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments/preview` | Price a draft without saving. |
| POST | `/api/cpq/quotes/price` | Public calculator. `includeWaterfall: true` adds list / standard prices; negotiated prices never appear here. |

Full contracts: the OpenAPI document (`openApi` on each route) and the spec.
