# CPQ + Billing — Price Adjustments and Phases: UX Feedback (Ramp Deals, Round 2)

**Date**: 2026-11-27
**Status**: Design complete (D1–D8). Ready for implementation
**Owner**: Mac
**Packages**:
- `@dainamite/cpq`: the quote's Price dialog, one atomic "set a target's price" API, icons, author names, adjustments on the order (items 1–8). Minor bump.
- `@dainamite/billing`: Rate and Billing settings sections in the item form (item 9). Patch bump, layout only.
- `@dainamite/cpq-billing-connector`: not affected.

**Trigger**: Mac's hands-on review of the ramp-deal flow, 2026-11-27 (10 points, screenshots in the session).
**Builds on**:
- [Price phases / ramp deals](2026-11-26-billing-price-phases-ramp-deals.md) (spec P), Phases 1–3 shipped
- [CPQ manual pricing flexibility](2026-11-26-cpq-manual-pricing-flexibility.md) (spec F), shipped
- [CPQ manual price adjustments](2026-11-10-cpq-manual-price-adjustments.md): the rules this spec keeps

---

## TLDR

**Key points:**
- A sales rep now manages a line's price in **two dialogs** (Adjust price, Phases), reached through **four different icons**. Neither dialog shows the current price. The Phases dialog is too narrow, so its Value and Name columns are cut off, and it saves its phases one by one.
- **Proposal:** one wide **Price dialog** per quote line, opened by one **%** icon on the line and on each charge.
  - **Current prices** at the top.
  - **Applies to**: the whole line (recurring, one-time or all charges) or one charge. Each option shows what is set on it now.
  - A **One price / Price phases** switcher.
  - A live preview, then **one atomic, undoable save**.
- **Smaller fixes:**
  - author names instead of user ids;
  - a read-only adjustments panel on the order;
  - suggested phase names, so billing never gets an unnamed phase by accident;
  - a billing item form with **Rate** (price, VAT, phases) separate from **Billing settings**.
- **No database change.** A target's phases are its existing `cpq_quote_price_adjustments` rows.

**Scope:**
- CPQ:
  - the Price dialog (items 1–4) with its API (`PUT …/price-adjustments/target` and a preview);
  - unified icons (5);
  - author names (6);
  - adjustments on the order (7);
  - suggested phase names (8).
- Billing: the item form's Rate / Billing settings sections (9).

**Out of scope:**
- **Phases on usage charges** (item 10, D3): a separate spec, later.
- **Stacking several adjustments on the same price** (D2): "never compounded" stays.
- **Price-adjustment writes as AI tools** (D6): unchanged policy.
- **Phases on existing subscription lines through Amend / Renew** (spec P, D8).
- **The subscription detail page:** it already shows the schedule.

## Decisions

| # | Decision |
|---|---|
| D1 | **The One price / Price phases switcher replaces the From month / To month fields** (Q1 → A).<ul><li>*One price* = a permanent adjustment.</li><li>*Price phases* = steps back to back from month 1, then the price after them.</li><li>A new step kind, **Regular price**, makes a gap, so "40% off in months 4–6 only" is *Regular price 3 months → 40% off 3 months*.</li><li>The **Then** row (after the last step) is *Regular price* or a price that runs to the end, so a ramp "100 → 110 → 120" works on a product listed at 100.</li><li>Rows stored with any month range (API, AI, older UI) open in Price phases.</li></ul> |
| D2 | **Several adjustments per line, never on the same price in the same month** (Q2 → a). There is one adjustment set per target: whole line · recurring, whole line · one-time, whole line · all charges, or one charge. *Applies to* lists the targets with their current state; picking one loads it for editing. A conflict (e.g. *all charges* vs *recurring*) shows in the preview and blocks Save. Most specific wins and nothing compounds, as today. |
| D3 | **Phases on usage charges get their own spec, later** (Q3 → a). It changes the usage rater, the prepaid close, CPQ (which has no usage adjustments at all) and the connector. |
| D4 | **One save path for the dialog:** `PUT /api/cpq/quotes/{quoteId}/price-adjustments/target` replaces every adjustment on one target in one quote write, as **one undoable command**. Rows that don't change keep their id, author and date. The existing per-row POST / PATCH / DELETE stay for API callers. |
| D5 | **No schema change and no migration.** The dialog's steps are rendered from the target's active rows, and a *Regular price* step is a gap between rows. The rows use the same columns as today (`from_month`, `to_month`, `phase_name`). |
| D6 | **Price-adjustment writes stay out of the AI tools**, as [`manuals/cpq-ai-agent.md`](../../manuals/cpq-ai-agent.md) ("not exposed on purpose") already says. The new PUT and its preview follow that policy, and the PR says so (`mcp-tools` skill). The **reads** this spec changes ship as tools: a new `cpq.list_price_adjustments`, and an updated `cpq.get_order` description. |
| D7 | **The author is resolved on the server**, the way core's `customers` resolves activity authors: `createdByName` (the user's name) and `createdByEmail`, from one batched lookup of `auth` users by id. The UI shows the name, falls back to the email, and keeps the id in the tooltip. |
| D8 | **The order shows the source quote's adjustments, read-only.** They are frozen once the quote is converted (`ADJUSTMENT_LOCKED` when an order exists). `GET /api/cpq/orders/{orderId}` returns them, so an order viewer doesn't need `cpq.quotes.view`. |

---

## 1. Feedback → findings → proposal

Code paths are relative to `packages/cpq/src/modules/cpq/` unless marked *billing*.

| # | Feedback | What we found (verified 2026-11-27) | Proposal |
|---|---|---|---|
| 1 | The Adjust price dialog lacks the current price and is too narrow | The line dialog shows only the line name. The charge dialog shows the standard unit price in its subtitle. Both use the default dialog width (`PriceAdjustmentDialog.tsx`) | The Price dialog (§3): wide, with a **Current prices** table and a before → after preview |
| 2 | *From month / To month* should sit behind a switch | Shown for every recurring target (`recurringTarget`) | Gone. Time-based prices live in *Price phases* (D1) |
| 3 | Can't add a second adjustment | The API accepts several non-overlapping adjustments per line (`adjustmentsOverlap`). The dialog never creates a second one: `openLine` / `openCharge` in `usePriceAdjustments.tsx` always open the existing permanent adjustment | The *Applies to* picker (D2) |
| 4 | Merge the Phases dialog into Adjust price, with a switcher | `PricePhasesDialog.tsx`:<ul><li>only creates, starting from one empty step;</li><li>saves N separate POSTs, so a failure halfway leaves half a schedule;</li><li>at `max-w-2xl` its 6 columns overflow</li></ul> | The One price / Price phases switcher. One atomic save (D4) |
| 5 | Unify the icons: **%** at line and charge level, no text | Line: `Tags` + "Adjust price" text and `CalendarRange` + "Phases". Charge: `Pencil` and `CalendarRange` (`priceAdjustmentContext.tsx`). The pencil also means "edit" in the panel | One icon-only `Percent` button on the line and on each charge, with the tooltip "Adjust price". The Phases buttons go. The pencil means only "edit" |
| 6 | Author shows `a8761ab8` | `PriceAdjustmentsPanel.tsx` prints `createdByUserId.slice(0, 8)` | Name, else email (D7) |
| 7 | Adjustments aren't visible on the order | The order shows the "N phases" pill and the schedule (`ChargeBreakdownTable`). It has no adjustments panel, so reason, note and author are missing | A read-only panel on the order's Line items tab (D8) |
| 8 | No phase names in billing; "I wrote something like 50% off" | **The pipeline carries names.** Local DB: the quote priced at 16:47 UTC stored `phase_name = null` on both phases, so its billing item got none (the screenshot). The 16:59 quote, with *Free Trial* / *50% Off*, reached `billing_item_phases` with both names. The name column was off-screen in the narrow dialog | The wide dialog, plus **suggested names** (§3.5) |
| 9 | Billing item: phases next to the regular price; other settings in their own section | *Billing* `components/ItemForm.tsx`: **Rate** holds the price, VAT, charge timing, prorate, billing period and phases | §4.4 |
| 10 | Phases on usage charges | Out of scope in spec P. CPQ has no usage adjustments; billing refuses usage phases (`PHASES_RECURRING_ONLY`) | Separate spec (D3) |

## 2. Market reference

| Tool | Pattern | What we take |
|---|---|---|
| Salesforce Revenue Cloud | Summer '26: one-screen ramp setup, trial included (spec P references) | Price and phases on one screen |
| Zuora | Charge segments edited on the charge, with the current rate beside them | The current price next to the editor |
| Stripe | Subscription schedule editor: phases with a duration, then what happens after the last phase | The **Then** row (regular price, or a price to the end) |

**Rejected:**
- **A separate "add adjustment" list with free-form month ranges** (our current Adjust price dialog). Two ways to express the same schedule, and overlaps are found only on save.

## 3. The Price dialog (CPQ)

### 3.1 Layout

```
┌ Adjust price — Internet Service 300 Mbps · term 12 months · USD ─────────────────────────────┐
│ CURRENT PRICES                                                                                │
│ Charge                    Type  List    Standard  Offer   Qty  Total    Priced by             │
│ Monthly Subscription Fee  MRC   90.00   90.00     90.00   1    90.00    Line · recurring:     │
│                                                                         2 phases              │
│   Month 1: 0.00 · months 2–4: 45.00 · from month 5: 90.00                                     │
│ Setup Fee                 NRC   100.00  100.00    100.00  1    100.00   —                     │
│ Line totals   MRC 90.00   NRC 100.00                                                          │
│ ───────────────────────────────────────────────────────────────────────────────────────────── │
│ Applies to [Whole line · recurring — 2 phases       ▾]        [ One price | ■ Price phases ]  │
│                                                                                               │
│  Months   Length            Price             Value   Name                                    │
│  1        [1 ] [months ▾]   [Free          ▾]  0      [Free trial        ]   ↑ ↓ 🗑            │
│  2–4      [3 ] [months ▾]   [% off         ▾]  [50]   [50% off           ]   ↑ ↓ 🗑            │
│  From 5   Then              [Regular price ▾]                                                 │
│  [+ Add phase]                                                                                │
│                                                                                               │
│ Reason [Promotion ▾]                     Note [                                       ]      │
│ Preview: Monthly Subscription Fee  90.00 → month 1: 0.00 · months 2–4: 45.00 · then 90.00     │
│ ───────────────────────────────────────────────────────────────────────────────────────────── │
│ [Remove adjustment]                                               [Cancel]  [Save]           │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Size:** `max-w-5xl`, body scrolls (`max-h-[85vh]`). Ctrl/Cmd+Enter saves, Escape cancels.
- **Current prices:** the line's non-usage charges with list, standard, offer, quantity and total, plus the line's MRC / NRC totals. The data is already on the quote, so no new API.
  - **Priced by** names what sets each charge's offer: *Line · recurring: 2 phases*, *Charge: Set price*, a price rule, or *—*.
  - A phased charge gets a one-line schedule under its row.
  - A bundle parent lists the whole bundle's charges, because a line adjustment on it covers the bundle (spec F, F-D3).

### 3.2 Applies to (D2)

| Option | Shown when | Types | Phases? |
|---|---|---|---|
| Whole line · recurring | The line has MRC charges | Set price, % off, Amount off | Yes |
| Whole line · one-time | The line has NRC charges | Set price, % off, Amount off | No |
| Whole line · all charges | The line has both MRC and NRC | % off | No |
| Charge · *name* | Each MRC / NRC charge of the line (not usage) | Per charge model, as today (`allowedAdjustmentTypes`) | MRC charges only |

- **Each option shows its current state:** *— 2 phases*, *— Set price 80.00*, *— 10% off*, or nothing.
- **Default target:**
  - the line's **%** opens the first target that has an adjustment; otherwise *Whole line · recurring*, or *one-time* when the line has no MRC;
  - a charge's **%** opens that charge.
- **Picking a target loads its adjustment.** A free target starts empty. "Adding a second adjustment" means picking another target.
- **Conflicts.** The preview reports `ADJUSTMENT_OVERLAP` and names the other target: "Overlaps *Whole line · recurring (2 phases)*. Remove it first, or pick it in Applies to." Save stays disabled.
- **Most specific wins (informational).** When the line target hides behind a charge adjustment, the preview says "*Monthly fee* keeps its own price: a charge adjustment beats a line one".

### 3.3 Modes (D1)

- **The switcher shows only on recurring targets.** Other targets use One price only.
- **The default mode** is *Price phases* when the target has phased rows, otherwise *One price*.
- **One price:**
  - Type and Value fields, with today's hints (spread over the charges, charge total for volume / tiered charges);
  - saved as one row, `[1, null]`.
- **Price phases:**
  - at most **12 steps**, *Regular price* steps included (each becomes one billing phase);
  - each step has a length (months, or years = 12 months), a kind (*Regular price*, *Free*, *Set price*, *% off*, *Amount off*), a value and a name;
  - steps can be reordered and removed;
  - the **Then** row picks *Regular price* (default), *Set price*, *% off* or *Amount off*, which then runs to the end;
  - steps must not run past the line's term (`PHASE_PAST_TERM`);
  - at least one step that is not *Regular price*. Otherwise the editor suggests One price.
- **Switching modes** keeps the other mode's unsaved input until Save. Save replaces everything on the target, and the preview says "Replaces 2 phases".

### 3.4 Save, Remove, preview

- **Save** sends one `PUT …/price-adjustments/target` (§6.1) and closes the dialog. The quote reprices once, and the undo toast undoes the whole save.
- **Remove adjustment** (when the target has rows) asks for confirmation, then sends the PUT with nothing on the target.
- **Preview:**
  - `POST …/price-adjustments/target/preview`, debounced 400 ms, the same body as Save, no write;
  - shows each affected charge's before → after (with "Above standard" for uplifts, spec F), the schedule for phases, and the line totals.
- **The reason and note** apply to every row the save writes. Loading a set with mixed reasons shows the first step's reason.

### 3.5 Suggested phase names (item 8)

Each step's Name field is prefilled until the rep types in it. Suggestions use the rep's UI language (i18n keys). The rep can change any of them. A *Regular price* step has no name, because no row is stored for it.

| Step | Suggestion |
|---|---|
| Free, first step | Free trial |
| Free, later step | Free |
| % off 50 | 50% off |
| Amount off 10 | 10.00 off |
| Set price, exactly 12 months starting on a year boundary | Year N |
| Set price, otherwise | Special price |
| Then (a price to the end) | No name. It becomes the item's regular price in billing (spec P) |

Billing keeps its "Phase N" fallback for unnamed phases created through its API.

## 4. Other UI changes

### 4.1 Icons (item 5)

- **Line row:** an icon-only `Percent` button with the tooltip and aria-label "Adjust price". It replaces `Tags` + text and the `CalendarRange` "Phases" button.
- **Charge row:** a `Percent` button, which replaces `Pencil` and `CalendarRange`.
- **Disabled states** keep today's explanations (locked, ARC mirror line, free-form line, no permission), through `BlockedReason`.
- **The pencil** means only "edit" (panel rows).

### 4.2 Quote: Price adjustments panel

- **One row per target.** A phased target reads "2 phases: Free trial (month 1) → 50% off (months 2–4), then regular".
- **Author:** name, else email; the id is in the tooltip (D7). A set shows the author and date of its latest change.
- **Edit** opens the Price dialog on that target.
- **Delete** removes the whole target, through the PUT.
- **The locked-quote exception stays.** On a locked quote, Delete is offered only when a row is invalid, and it removes only the invalid rows (per-row DELETE, as today).

### 4.3 Order: Price adjustments panel (item 7)

- The same table, **read-only**, on the order's Line items tab, under the lines.
- Data: `order.priceAdjustments` (§6.4).
- Injection spot: `data-table:cpq.order_price_adjustments`.
- Hidden when the order has no adjustments.

### 4.4 Billing item form (item 9)

| Section | Recurring item | One-time item | Usage item |
|---|---|---|---|
| **Rate** (with the Net / Gross switch) | Unit price per cycle, VAT, **Price changes over time (phases)** and its editor, "Regular price from …" | Amount, VAT | Rate model, rates, VAT |
| **Billing settings** *(new)* | Charge timing, Prorate partial periods, Billing period | — | — |

- **Layout only.** Field names, validation and payloads are unchanged.
- **Create and edit** use the same `ItemForm`.
- **On the item page,** the read-only *Price phases* card stays under the form.

## 5. Data model

**No change** (D5). `cpq_quote_price_adjustments` already has `level`, `quote_line_id`, `charge_code`, `charge_type_filter`, `from_month`, `to_month`, `phase_name`, `reason_code`, `reason_note` and `created_by_user_id`, scoped by `tenant_id` + `organization_id`.

**A target and its rows:**

| Target | Row key |
|---|---|
| Whole line · recurring / one-time / all charges | `level = line`, `quote_line_id`, `charge_type_filter = mrc / nrc / null` |
| Charge | `level = charge`, `quote_line_id`, `charge_code` |

**From steps to rows** (pure, `lib/targetPrice.ts`):
- each step that is not *Regular price* becomes one row over its month range, with `phase_name`;
- a *Then* price becomes one row from the next month with `to_month = null`;
- One price becomes one row `[1, null]`;
- rows become steps in `from_month` order, and gaps become *Regular price* steps. Any non-overlapping set of rows can be shown this way, so rows stored through the API stay editable.

## 6. API contracts

All routes:
- live in CPQ's `api/<resource>/route.ts` style;
- export a typed `openApi` (`OpenApiRouteDoc`) built from the Zod validators;
- run inside the organization context (`cpqContextError`);
- are guarded by `requireFeatures` (never `requireRoles`).

### 6.1 `PUT /api/cpq/quotes/{quoteId}/price-adjustments/target`

- **Features:** `cpq.quotes.manage` + `cpq.quotes.adjust_price` (as POST). The toggle `cpq.manual_price_adjustments` must be on.
- **Body** (`cpqTargetPriceInputSchema`, `.strict()`):

```json
{
  "target": { "level": "line", "quoteLineId": "6c1…", "chargeTypeFilter": "mrc" },
  "phases": [
    { "months": 1, "adjustmentType": "price_override", "value": 0, "name": "Free trial" },
    { "months": 3, "adjustmentType": "discount_percent", "value": 50, "name": "50% off" }
  ],
  "then": null,
  "currencyCode": "USD",
  "reasonCode": "promotion",
  "reasonNote": null,
  "expectedRevision": 7
}
```

  - **`target`:** `{ level: 'line', quoteLineId, chargeTypeFilter: 'mrc' | 'nrc' | null }` or `{ level: 'charge', quoteLineId, chargeCode }`.
  - **`phases[]`:** at most 12. `months` is an integer ≥ 1. `adjustmentType` is `regular | price_override | discount_percent | discount_absolute`. `value` is required except for `regular`. `name` is optional, up to 100 characters.
  - **`then`:** `{ adjustmentType, value }` or `null`. With phases, `null` = the regular price after them. With no phases, `then` is the One price.
  - **`phases: []` and `then: null`** remove everything on the target. `reasonCode` is optional only in this case.
- **Validation:**
  - every row built from the body passes `cpqPriceAdjustmentInputSchema` (the same rules as POST);
  - phases only on a recurring target;
  - nothing past the line's term;
  - no overlap with other targets' rows.
- **Write:**
  - one `withQuotePricingWrite`: quote lock, `expectedRevision` check, and `withAtomicFlush` for persist → reprice;
  - rows that don't change keep their id, author and `created_at`;
  - a row whose month range is kept is updated in place;
  - other rows are created or soft-deleted.
- **Response 200:** `{ adjustments: AdjustmentSnapshot[], quote: QuoteResult }`. `adjustments` are the target's rows after the write. An `x-om-operation` header carries the undo.
- **Errors:**

| Status | Codes |
|---|---|
| 400 | Invalid body (Zod) |
| 403 | Missing feature, or toggle off |
| 404 | Quote, line or charge not found |
| 409 | `ADJUSTMENT_LOCKED`, `STALE_REVISION` |
| 422 | `LINE_NOT_ELIGIBLE`, `PHASE_RECURRING_ONLY`, `PHASE_PAST_TERM`, `PHASE_TOO_MANY`, `ADJUSTMENT_OVERLAP` (with the other row's `adjustmentId`), `REASON_NOT_FOUND`, `REASON_NOTE_REQUIRED`, `CHARGE_TYPE_REQUIRED`, `INVALID_PERCENT`, `INVALID_AMOUNT`, or any pricing error of a written row (`TYPE_NOT_ALLOWED`, `CURRENCY_MISMATCH`, …) |

### 6.2 `POST /api/cpq/quotes/{quoteId}/price-adjustments/target/preview`

- **Features:** as the PUT.
- **Body:** the same as the PUT.
- **Response 200:** `{ quote, errors: Array<{ adjustmentId, code, conflictsWith? }> }`.
  - The draft rows get temporary ids, and their errors block Save.
  - `ADJUSTMENT_OVERLAP` is **reported, not thrown**, with `conflictsWith` = the other row's id.
- **No write, no event.**

### 6.3 `GET /api/cpq/quotes/{quoteId}/price-adjustments` *(additive)*

- Each item gains `createdByName: string | null` and `createdByEmail: string | null`.
- One `findWithDecryption` of `auth` `User` rows by id, within the tenant. The read is by FK id, with no ORM relation (D7).

### 6.4 `GET /api/cpq/orders/{orderId}` *(additive)*

- `order.priceAdjustments`: the source quote's active rows, with `createdByName`, `createdByEmail` and `reasonLabel`. Empty when there is no source quote.
- Guarded by `cpq.orders.view` (D8).

### 6.5 AI tools (D6, `mcp-tools` skill)

| Tool | Change |
|---|---|
| `cpq.list_price_adjustments` *(new, read)* | Wraps 6.3. `requiredFeatures: ['cpq.quotes.view']`. Returns the adjustments with target, months, phase name, reason, author. Added to the CPQ agent's `allowedTools`. Tests: schema, operation, mapping, features |
| `cpq.get_order` | Description mentions `priceAdjustments` |
| 6.1 / 6.2 | **Not tools**, per the documented policy. `manuals/cpq-ai-agent.md` names the new route in its "not exposed on purpose" line |

## 7. Commands, events, undo

- **Command:** `cpq.quote_price_adjustment.replace_target`, `isUndoable: true`, resource kind `cpq.quote_price_adjustment`.
- **Mutation guards:** run as today (`runCpqMutationGuards`, operation `update`, payload `{ quoteId, ...body }`).
- **Undo payload:** `{ quoteId, target, before: AdjustmentSnapshot[], after: AdjustmentSnapshot[] }`. It reuses the existing `snapshotSchema`, which must list every column (lesson 2026-11-27).
- **Undo steps:**
  1. Under the quote lock, check the quote is still mutable.
  2. Check that every `after` row still equals its snapshot. Otherwise answer 409 "changed since this action".
  3. Soft-delete the `after` rows that aren't in `before`, and restore the `before` rows. Overlap is checked against other targets before restoring.
  4. Reprice once.
- **Events:** none new. The quote pricing write emits the existing pricing signals once per save (one save = one signal, not N). That is fewer signals than today's N POSTs.
- **The existing per-row create / update / delete commands are unchanged.**

## 8. User stories

- **Sales rep:** I open one dialog on a line, see its current prices, and set a free first month plus 50% off for three months, saved in one go.
- **Sales rep:** on the same line, I give 20% off the setup fee as well, without losing the recurring phases.
- **Sales rep:** I sell a ramp 100 → 110 → 120 on a product listed at 100: two phases, then *Set price 120*.
- **Sales rep:** I try *all charges 10% off* on a line with recurring phases. Before saving, I'm told what it overlaps.
- **Sales manager:** I see who set each negotiated price, by name, on the quote and on the order.
- **Billing operator:** promotion names from the quote show on the billing item and the invoice.
- **Billing operator:** I find an item's price and its phases in one Rate section, and its timing and period under Billing settings.

## 9. Implementation plan

**Phase 1 — CPQ API** (one PR)
1. **Pure** `lib/targetPrice.ts`:
   - `targetOf(row)` and `rowsForTarget(input)`;
   - `stepsFromRows(rows)`, with gaps as *Regular price* steps and the open-ended row as *Then*;
   - `planTargetWrite(before, wanted)`: keep / update / create / delete.

   Unit tests:
   - round trip, including a legacy "months 4–6 only" row;
   - Then above standard;
   - 12-step cap, past term;
   - unchanged rows keep their ids;
   - a line *all charges* target cannot hold phases.
2. **Service** `services/priceAdjustments/targetPriceService.ts` (a new file, so `adjustmentService.ts` stays under 300 lines): `previewTarget`, `replaceTarget`, `undoTarget`, registered in DI. Unit tests with the mock EM (`unit-tests` skill):
   - locked and stale quotes;
   - overlap with another target (thrown on save, reported on preview);
   - reason rules;
   - undo after a concurrent edit → 409.
3. **Routes:** the command, PUT and preview with typed `openApi`. Route tests. `openapi-coverage.test.ts` passes.
4. **Reads:** author fields on the list and `priceAdjustments` on the order GET, with `openApi`, tests and the `cpq.list_price_adjustments` tool (agent allowlist and tests). Update the `get_order` description and the AI manual.

**Phase 2 — CPQ UI** (one PR, after Phase 1)
1. **Components**, each under 300 lines: `PriceDialog`, `CurrentPricesTable`, `TargetPicker`, `OnePriceEditor`, `PhaseScheduleEditor`, `PricePreview`.
2. **Pure helpers** in `lib/priceDialogView.ts`, with unit tests: target options and labels, the default target, suggested names, the "Priced by" text.
3. **Actions:**
   - one `AdjustPriceAction` (`Percent`) on line and charge rows;
   - remove `PricePhasesAction`, `PricePhasesDialog`, `PriceAdjustmentDialog` and the helpers left unused (`buildPhaseDrafts`, the From / To form fields).
4. **Panels:**
   - the quote panel grouped by target, with author names;
   - a read-only variant on the order page.
5. **i18n:** en / es / de / pl.
6. **Playwright:**
   - update `TC-CPQ-014` (test ids change);
   - new scenarios: recurring phases + one-time % off on one line; a ramp with *Then* above standard; the conflict message; the order panel.

**Phase 3 — Billing form** (small PR, independent)
1. `ItemForm`: Rate / Billing settings sections, plus the i18n title key.
2. Visual check of create and edit for recurring, one-time and usage items.

**Phase 4 — Docs**
- `manuals/cpq-price-adjustments.md`: the dialog, targets, modes, Then, suggested names.
- The capability doc `.ai/specs/capabilities/cpq-quote-pricing.md`.
- The billing manual: form sections.
- Changesets: cpq minor, billing patch.
- A lesson, if one surfaces.

## 10. Risks

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A save replaces a target's rows and loses who set what | Medium | Unchanged rows keep their id and author (`planTargetWrite`, unit-tested). The action log keeps before / after | A changed step shows the new author |
| Undo of a save after someone edited the quote | Medium | Per-row snapshot check, then 409. Restoring is overlap-checked | The user redoes it by hand |
| Old POST / PATCH and the new PUT drift apart | Medium | The PUT builds rows through the same `cpqPriceAdjustmentInputSchema` and the same resolver. Shared tests | — |
| Rows stored through the API render wrongly in the editor | Low | Any non-overlapping set can be shown (§5). Round-trip unit tests | A legacy set over 12 steps can be viewed but not saved until it is shortened (`PHASE_TOO_MANY`) |
| The wide dialog is too dense on small screens | Low | Body scrolls. Current prices lists only the line's charges | — |
| A suggested name in the rep's language prints on an invoice in another language | Low | The name is editable. Billing's invoice-language spec covers labels, not free text | Documented in the manual |
| Removing the separate Phases buttons hides phases from reps who learned them | Low | Charge **%** opens the dialog on that charge, and the switcher is visible on every recurring target | — |

## 11. Spec checklist

| Area | Answer |
|---|---|
| Module isolation | CPQ reads `auth` users by FK id only. No new ORM relation. No import from `src/modules/*` |
| Tenant scope | Every query filters by `tenant_id` + `organization_id`. User lookup within the tenant |
| Transactions | One `withQuotePricingWrite` + `withAtomicFlush` per save |
| Validation | Zod, `.strict()` body. Every built row passes the existing input schema |
| Auth | `requireFeatures` on every route, as the existing adjustment routes |
| Commands / undo | One undoable command per save (§7) |
| Events | No new events |
| API | Typed `openApi` on 6.1–6.4. Changes are additive, so no version bump |
| UI | Shared primitives (`Dialog`, `Select`, `SegmentedControl`, `IconButton`), lucide icons, i18n in 4 locales. No new lists, so no new pagination |
| Data | No entity or migration change |

## Changelog

| Date | Change |
|---|---|
| 2026-11-27 | Skeleton from the 10-point review. Item 8 root cause verified in the local DB. Open questions Q1–Q3 |
| 2026-11-27 | Q1 → D1 (switcher replaces month fields, Regular price steps, Then row). Q2 → D2 (one set per target, conflicts in preview). Q3 → D3 (usage phases: separate spec). Design: atomic target PUT (D4), no schema change (D5), AI tool policy (D6), author names (D7), order panel (D8). Implementation plan and risks |
