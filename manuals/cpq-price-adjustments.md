# CPQ — Negotiated prices on quotes (price adjustments)

Spec: `.ai/specs/2026-11-10-cpq-manual-price-adjustments.md` ·
App Spec: `.ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md`

A sales rep can change what the customer pays on a quote without touching the
catalog: set a new unit price on a charge, take an amount off a charge, or give
a percentage discount on a charge or a whole line. CPQ keeps the catalog price,
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
surcharge shows as a positive depth (`+5%`), a discount as negative (`−20%`).

## Operator flow

1. Open a quote in status **New**, **Incomplete** or **Ready**.
2. Expand a line. Each charge row shows **List** and **Offer** with a depth badge.
3. Pick an action:
   - **Adjust price** (pencil on a charge row) — one charge:
     - *Set a new unit price* — e.g. 100 → 80. Only for flat and per-unit charges.
     - *Percentage discount* — e.g. 20 %.
     - *Amount off the charge total* — e.g. 40 off.
   - **Discount line** (percent icon on the line) — a percentage on every
     billable charge of the line, or only its recurring / one-time charges.
     Bundle components inherit their bundle's line discount.
4. Enter the value, choose a **reason** (required) and an optional note (the note
   is required for "Other"). The dialog previews the new offer price as you type;
   nothing is saved until **Save** (`Ctrl/Cmd+Enter`; `Esc` cancels).
5. The adjustment appears in the **Price adjustments** panel under the lines, with
   target, type, value, reason, author and date. Edit or delete it there or from
   the waterfall.

### Rules

- **One adjustment per charge applies.** A charge adjustment beats a line
  discount, which beats an inherited bundle discount. They never compound.
- **Never above standard.** An override above the standard price is refused
  (`ABOVE_STANDARD`). Reps can lower prices, never raise them.
- **Usage charges** cannot be adjusted.
- **Locked after submission.** Once the quote leaves New / Incomplete / Ready
  (e.g. *In approval*), adjustments are read-only: move the quote back to
  **Ready** to change them. A converted quote is always locked.
- **Invalid adjustments are kept, not applied.** If a reconfiguration removes the
  adjusted charge, or a rule change pushes standard below an override, the
  adjustment gets an **Invalid** badge, the charge falls back to the next valid
  price, and the line becomes *incomplete*. Delete or edit it. An invalid
  adjustment can still be deleted while the quote is submitted.
- **Conversion uses stored prices.** Converting to an order copies the stored
  waterfall without re-pricing. A quote with an invalid stored adjustment cannot
  be converted (`422 ADJUSTMENT_INVALID`).
- **Copies and removals.** Cloning a quote copies its adjustments; removing a
  line removes its adjustments (and those of its bundle components).
- **Amend / Renew / Cancel quotes.** Lines that mirror existing subscription
  items cannot be adjusted yet (tooltip explains why). Lines added on the change
  quote can.

## Permissions and rollout

| Control | Effect |
|---|---|
| Feature `cpq.quotes.adjust_price` (with `cpq.quotes.manage`) | Create, edit and delete adjustments. Granted to `admin` and `employee` by default. |
| Feature toggle `cpq.manual_price_adjustments` | Turns the capability on per tenant. Seeded **on**; switch it off to hide the actions and refuse writes (`403`). Stored adjustments keep pricing quotes. |
| Dictionary `cpq.price_adjustment_reason` | Reason list, editable under Dictionaries. Seeded with: competitive match, volume commitment, loyalty, promotion, strategic deal, price correction, other. |

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
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments` | Create. Send `expectedRevision` to avoid overwriting a colleague's change (`409 STALE_REVISION`). |
| PATCH / DELETE | `/api/cpq/quotes/{quoteId}/price-adjustments/{adjustmentId}` | Level and target are immutable. |
| POST | `/api/cpq/quotes/{quoteId}/price-adjustments/preview` | Price a draft without saving. |
| POST | `/api/cpq/quotes/price` | Public calculator. `includeWaterfall: true` adds list / standard prices; negotiated prices never appear here. |

Full contracts: the OpenAPI document (`openApi` on each route) and the spec.
