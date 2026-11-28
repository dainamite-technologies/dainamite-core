# Billing + CPQ — Price Phases: Trials, Promotions and Ramp Deals

**Date**: 2026-11-26
**Status**: Business spec, internal questions resolved (D1–D10). Waiting for Walix's answers (§6), then the technical design (§8)
**Owner**: Mac
**Packages**:
- `@dainamite/billing`: phases on billing items, the engine, UI, API and AI tools (Phase 1)
- `@dainamite/cpq`: phases on quote lines, carried to order, subscription and events (Phase 2)
- `@dainamite/cpq-billing-connector`: maps CPQ phases to billing item phases (Phase 3)

**Trigger**: prospective customer Walix (ISP / telco in Colombia, COP), chat 2026-11-24/25. Walix uses **billing only**. Phase 1 delivers their value; Phases 2–3 complete the CPQ → billing flow the packages must support.
**Sibling spec**: [`2026-11-26-billing-line-period-and-status.md`](2026-11-26-billing-line-period-and-status.md) (own billing period per line, line status, prepaid / postpaid).
**Related**:
- [Spec A — cycle semantics](2026-11-14-billing-cycle-semantics.md): proration, `billed_to_date` watermark
- [CPQ price adjustments App Spec](2026-11-10-app-spec-cpq-quote-price-adjustments.md) and its unbuilt briefs [`time-windows`](briefs/2026-11-10-cpq-price-adjustments-time-windows.md) and [`schedule-billing`](briefs/2026-11-10-cpq-price-adjustments-schedule-billing.md). This spec **supersedes `schedule-billing`** and replaces the billing side of `time-windows` (D4).
- [CPQ manual price adjustments](2026-11-10-cpq-manual-price-adjustments.md): the `cpq_quote_price_adjustments` table this spec builds on
- [CPQ manual pricing flexibility](2026-11-26-cpq-manual-pricing-flexibility.md): Set price / % off / Amount off at line and charge level, prices above standard. CPQ phases use these types, so it ships before Phase 2
- [XD-188 price rules](../../specs/implementation/xd-188-price-rules.md): the catalog price rules that get phases here (D9)

---

## TLDR

**Key points:**
- A recurring billing item can switch on **price phases**: child records that override the item's price for a duration from the item's start. Each phase is *Free*, *Fixed price*, *% off* or *Amount off*.
- After the last phase, the item's own price, the **regular price**, applies.
- **One mechanism covers:**
  - free trial ("first month free");
  - introductory price ("first month for 1");
  - promotion ("50% off for 3 months");
  - ramp deal ("year 1: 100, year 2: 110, year 3: 120").
- **End to end:** a sales rep puts the same phases on a CPQ quote line. They travel quote → order → subscription → activation event → connector, and arrive as **one billing item with phases**.

**Scope:**
- Phase 1, billing: phases on recurring items, invoiced to the exact date, in the item form, API, AI tools and invoice lines.
- Phase 2, CPQ: phases on quote lines (rep deals) and on catalog price rules (automatic promotions), with deal value, order and subscription, carried in the activation and added-item event payloads.
- Phase 3, connector: payload phases → billing item phases. End-to-end test from quote to invoice.

**Out of scope:**
- Phases on one-time and usage items.
- Quantity ramps (billing items have no quantity).
- Account-wide coupons.
- Revenue recognition.
- Putting a new ramp on an existing subscription line through an Amend or Renew quote (D8).

## Decisions (Q&A 2026-11-26)

| # | Decision |
|---|---|
| D1 | Walix uses billing only. Phases are created on billing items (UI and API) and work without CPQ. The CPQ → connector → billing flow supports them too (Phases 2–3). |
| D2 | Ramp deals / phases get this spec. Line billing period, line status and prepaid / postpaid go to the sibling spec. |
| D3 | **A phase that ends inside a billing period splits the invoice line on the exact date.** Each part is prorated by days, as mid-cycle starts and ends already are. With the item's `prorate` switch off, the phase in force on the first day of a billing period prices the whole period. |
| D4 | **One billing item per service, with phases as child records.** The CPQ `schedule-billing` brief (one billing item per price segment, boundaries moved to the next cycle start, no proration) is superseded. CPQ stores quote phases in the existing `window_kind` / `from_month` / `to_month` columns of `cpq_quote_price_adjustments`. |
| D5 | **One word: "phase"**, in billing, the CPQ UI, events and docs. "Window" (the App Spec's word for the month range of a quote price adjustment) survives only as CPQ column names. |
| D6 | **A manual price in CPQ may be above the standard price.** This holds for every manual price override, permanent or in a phase, so a ramp "100 → 110 → 120" on a product listed at 100 works. **Moved to [CPQ manual pricing flexibility](2026-11-26-cpq-manual-pricing-flexibility.md) F-D1**, together with line-level Set price and Amount off. |
| D7 | **CPQ phase lengths are in months.** Years are a UI shortcut for 12 months. Days and weeks exist only when editing a billing item directly. |
| D9 | **Catalog price rules can have phases too.** A rule gets the same month range as a manual adjustment, e.g. "FTTH 100: first month free" or "Home Premium: 50% off months 1–3". It then applies automatically on every quote line it matches, as a standard catalog promotion. Rules without a range behave as today (all months). The App Spec kept rule time windows out of scope (C16); this decision brings in the **month range** part. Campaign dates are D10. |
| D10 | **Price rules get optional campaign dates: Valid from / Valid until.** A month range says *which months of the subscription* get the promotion; campaign dates say *which quotes* get it ("50% for 3 months, for sign-ups until 31 Dec"). The rule applies when the quote is priced inside those dates. A priced quote keeps its promotion after the campaign ends, because the stored pricing snapshot is authoritative (App Spec). |
| D8 | **Phases and ARC, first version:** phases on new sales and on lines added by an Amend or Renew quote. An untouched existing line keeps its billing item and running phases. Cancel ends the item, and later phases drop. A renewal continues at the regular price. **Postponed:** a new ramp on an existing line through Amend or Renew. It waits for the App Spec's `arc-continuity` / `billing-rerate` work, because today a re-priced line on an Amend never reaches billing. |

---

## 1. Problem

- A billing item has **one price for its whole life**. A trial, a promotion or a ramp needs one of these workarounds today:
  - "change price" from a date: it ends the item and creates a copy, one manual step per price change;
  - separate negative one-time items, one per discounted month;
  - manual credit memos.

  All three are manual, easy to forget, and print as corrections rather than the deal that was sold.
- Walix asked for phases per line: "free trial for the first month, then the normal rate"; "50% off for the first 3 months, then the normal price".
- In CPQ, the App Spec planned ramps and promotions (US-1.3). The table columns exist, but only permanent adjustments are accepted, so nothing time-based can be quoted. Nothing time-based reaches billing either: the activation event carries one recurring price per item.

## 2. Market reference

| Tool | How price changes over time | What we take |
|---|---|---|
| Salesforce Revenue Cloud (Agentforce Revenue Management) | **Ramp deals**: a deal split into time segments with their own products, quantities, discounts and uplifts. Each segment is a separate quote line / group, with one ramp schedule per quote. Summer '26 adds a one-screen ramp setup that includes trial periods | Uplifts (D6). Segments shown on the quote |
| Zuora | **Ramps**: intervals on the subscription; each charge gets a **charge segment** per interval. At most 12 intervals in CPQ X | Segments live **on the charge**: our child records |
| Stripe | **Subscription schedules**: sequential phases with a duration (week / month / year), items, coupons and a trial flag | Phases with durations, back to back |
| Chargebee | **Ramps**: scheduled future changes, at most 12 scheduled | Cap of 12 |
| Recurly | **Ramp pricing**: price intervals by billing-cycle number. Cycles already billed can't be changed | Billed periods are frozen |

**Rejected:** one record per segment in billing (Salesforce's segment lines, our own `schedule-billing` brief). One service stays one line, so ending, pausing or re-pricing it touches one record.

## 3. Current state (verified 2026-11-26)

**Billing**
- `BillingItem.rate_json = { unit_price }`, one price. `POST /api/billing/items/change-price` ends the item and creates a copy (`lib/itemPriceChange.ts`).
- `lib/servicePeriods.ts` `computeRecurringLines` prices every recurring line, in the postpaid Bill Run and in prepaid period close. It cuts the unbilled window along the account's cycle, prorates partial periods, and never bills a day twice (`billed_to_date`).

**CPQ**
- `cpq_quote_price_adjustments` has `window_kind`, `from_month` and `to_month`. Validation accepts only the permanent window `[1, null]`.
- Manual prices above the standard price are refused (`ABOVE_STANDARD`). D6 lifts this rule.
- ARC mirror lines accept no adjustments (`LINE_NOT_ELIGIBLE`).

**CPQ → billing**
- The activation and added-item payloads send **one recurring charge per subscription item**, equal to the item's MRC total (`cpqOrderService.ts`, `emitActivatedEvent`).
- The connector maps it to one recurring billing item (`lib/chargeMapper.ts`).

## 4. Business rules

### 4.1 Phases on a billing item

- **The switch.** A recurring item gets **"Price changes over time (phases)"**.
  - Off = today's behaviour.
  - On = the phase editor.
- **Each phase has:**
  - an optional **name**, printed on the invoice line (e.g. "Free trial", "Promo 50%", "Year 1");
  - a **duration**: N days / weeks / months / years, or "until <date>";
  - a **price**: *Free* / *Fixed price* / *% off regular* / *Amount off regular*.
- **Timing.** Phases run **back to back from the item's bill start date**. Durations become dates from that start, so a delayed installation moves the trial with it.
- **Regular price.** After the last phase, the item's own price applies. A 3-year ramp is two phases, with the year-3 price as the regular price.
- **At most 12 phases per item.**
- **Edits change only periods not yet invoiced.** A change to an invoiced period is refused, with a hint to issue a credit memo (Spec D).
- **"Change price" on a phased item** changes the regular price from a date. The new item keeps the remaining phases on their original dates, so the promotion does not restart.
- **Ending an item** (end date, cancel) drops the phases after the end. Proration and the credit for days already billed work as today.
- **Prepaid accounts:** the same rules apply at period close (same engine).
- **Invoice line:** the description gets the phase name, e.g. "Internet 200 Mb — Promo 50% · 1–31 Jan". A free phase prints a 0.00 line (to confirm with Walix, W6).
- **Account Items tab:** a phased item shows its current phase and when it ends, e.g. "Free trial until 13 Dec".

| Deal | Regular price | Phases |
|---|---|---|
| First month free | 79,900 / month | Free, 1 month |
| First month for 1 | 79,900 / month | Fixed 1, 1 month |
| 50% off for 3 months | 79,900 / month | 50% off, 3 months |
| Free month, then 50% for 2 months | 79,900 / month | Free, 1 month → 50% off, 2 months |
| Ramp 100 / 110 / 120 | 120 / year | Fixed 100, 1 year → Fixed 110, 1 year |

### 4.2 Worked examples

**Example A: start on the bill date.** Internet 79,900 / month, account monthly on the 1st, in advance, starts 1 Dec 2026. Phases: Free for 1 month, then 50% off for 2 months.

| Invoice | Line | Amount |
|---|---|---|
| 1 Dec | Internet — Free trial · 1–31 Dec | 0.00 |
| 1 Jan | Internet — Promo 50% · 1–31 Jan | 39,950.00 |
| 1 Feb | Internet — Promo 50% · 1–28 Feb | 39,950.00 |
| 1 Mar | Internet · 1–31 Mar | 79,900.00 |

**Example B: start mid-cycle (D3).** The same line starts 14 Nov. Phase: Free for 1 month (14 Nov – 13 Dec). `prorate` is on.

| Invoice | Lines | Amount |
|---|---|---|
| 1 Dec | Internet — Free trial · 14 Nov – 13 Dec | 0.00 |
| | Internet · 14–31 Dec (18/31 days) | 46,393.55 |
| 1 Jan | Internet · 1–31 Jan | 79,900.00 |

The customer gets 30 free days, as sold. With `prorate` off, the free phase covers the whole December period, because it is in force on 1 Dec.

**Example C: annual ramp.** Platform license 120 / year, account annual, in advance, starts 1 Jan 2027. Phases: Fixed 100 for 1 year, then Fixed 110 for 1 year.

| Invoice | Line | Amount |
|---|---|---|
| 1 Jan 2027 | License — Year 1 · 2027 | 100.00 |
| 1 Jan 2028 | License — Year 2 · 2028 | 110.00 |
| 1 Jan 2029 onward | License · 2029 | 120.00 |

### 4.3 CPQ: phases on a quote line (Phase 2)

**Two sources of phases:**

| Source | Who | Example | Applies to |
|---|---|---|---|
| **Price rule with a month range** (D9) | Catalog manager | "FTTH 100: first month free" | Every matching quote line, automatically |
| **Manual adjustment with a month range** | Sales rep | "This deal: year 1 at 100, year 2 at 110" | One quote line or charge |

**How a month's price is worked out.** This is the existing waterfall, applied per month:
1. List price.
2. Price rules in force that month (in their sort order, as today). This gives the **standard price of that month**.
3. The manual adjustment in force that month (the most specific wins, never compounded, as today). This gives the **offer price of that month**.

A rep can therefore cancel a catalog promotion for a deal by setting the regular price for those months, or deepen it with an extra % off.

**Manual phases**
- On a quote line, or one of its recurring charges, the rep opens **Phases**: trial, promotion or ramp steps.
- Each step has a length in months (D7) and an adjustment type from [CPQ manual pricing flexibility](2026-11-26-cpq-manual-pricing-flexibility.md): **Set price**, **% off** or **Amount off**. *Free* = Set price 0.
- A set price may be above standard (D6). A line-level ramp sets the line's recurring total per step.
- The quote shows the schedule (months → price), the regular price after the last phase, and the deal value over the schedule. This is App Spec US-1.3.
- **Stored as manual price adjustments with a month range** (`from_month` / `to_month`, D4). The App Spec rules apply:
  - phases on recurring (MRC) prices only;
  - no overlaps;
  - no phase past the line's term;
  - the reason code is required;
  - the quote's pricing signals fire, so approval workflows can react.
- The **order and subscription item** keep the schedule. The **activation** and **added-item** payloads carry it with the item's recurring charge.
- **Several MRC charges on one item** are merged into one item schedule: the union of phase boundaries, with the prices summed. CPQ already sends one recurring charge per item. Each merged phase is sent as a *Fixed price* phase with its name.
- **ARC:** phases on new and added lines only (D8). An existing line keeps its billing phases untouched.

### 4.4 Connector (Phase 3)

- The activation and added-item subscribers create the billing item with the regular price **and** its phases, in one write (idempotent on the existing `sourceRef`).
- Phases are sent as months, relative to the start. Billing computes the dates from the item's bill start date, so the per-line bill start already set on the order's Billing tab moves the trial with it.
- Cancel and superseded: unchanged. The end date drops the later phases.

## 5. User stories

- **Billing operator (Walix)**: I give a new internet line a free first month so that the first invoice shows the trial at 0 and the second charges the full price, with no manual correction.
- **Billing operator**: I set "50% off for 3 months" on a line, so the promotion ends by itself and the regular price applies from month 4.
- **Billing operator**: I set up a 3-year ramp on one line instead of three items or three price changes.
- **Billing operator**: I can't change a phase for a period already invoiced; I'm told to issue a credit memo instead.
- **Sales rep (CPQ)**: I quote a ramp or a promotion on a line, and the customer's invoices follow it after activation without anyone touching billing.
- **Catalog manager (CPQ)**: I define "FTTH 100: first month free" once as a price rule, and every new quote for it gets the trial without the rep doing anything.
- **API integrator (Walix's systems)**: I create a billing item with its phases in one call.

## 6. Questions to confirm with Walix

- **W6.** Free periods: print a 0.00 line on the invoice? Are there DIAN e-invoicing constraints on zero-value lines or invoices (a 0.00 invoice when the only line is in a free trial)?
- **W7.** "First 3 months": calendar months from installation (our proposal), or the first 3 invoices?
- **W5** *(asked in the sibling spec)*. Does pausing a line extend its trial or promotion? Proposal: no, phases follow the calendar.

## 7. Implementation plan (outline; sized after sign-off)

**Phase 1 — Billing.** Delivers Walix.
1. Pure phase resolution: price per day from item and phases. Unit-test every example in §4.2, month ends, leap year, `prorate` off, catch-up, test and dry runs.
2. The `BillingItemPhase` entity and a hand-written migration; validators (contiguous, cap of 12, recurring only, only unbilled periods editable).
3. Engine: `computeRecurringLines` splits lines at phase boundaries (postpaid run and prepaid close). Phase name in the line description and metadata.
4. API: item create, update and bulk create accept `phases[]`, with `openApi` updated. The billing AI tools ship the change in the same PR (`mcp-tools` skill). `change-price` carries the remaining phases.
5. UI: the switch and phase editor in the item form, the phase pill on the account Items tab, i18n (en / es / de / pl).
6. Docs: billing manual and CHANGELOG (minor bump).

**Phase 2 — CPQ.** Requires [CPQ manual pricing flexibility](2026-11-26-cpq-manual-pricing-flexibility.md) to have shipped.
1. Enable month ranges on recurring price adjustments (validators, the resolver, the schedule on `ResolvedCharge`, deal value).
2. Price rules with a month range and campaign dates (D9, D10):
   - `from_month` / `to_month` and `valid_from` / `valid_until` on `cpq_price_rules` (migration);
   - the rule form;
   - `applyPriceRules` evaluated per month segment, so the standard price becomes a schedule; rules outside their campaign dates are skipped at pricing time;
   - tests for a rule phase combined with a manual phase in the same month, and for a quote priced before a campaign ended and re-saved after it.
3. Quote UI: the Phases editor on a line, and the schedule in the charge breakdown (with each month's source: rule or manual).
4. Order and subscription item keep the schedule; the activation and added-item payloads carry it.

**Phase 3 — Connector.**
1. Map payload phases → billing phases in `chargeMapper` (create with phases).
2. End-to-end integration test: quote with a trial and a promotion → activate → Bill Runs → invoices as in Example A.

## 8. Technical design *(after business sign-off)*

- `BillingItemPhase`:
  - `id`, `organization_id`, `tenant_id`, `billing_item_id` (FK string), `sequence`, `name`;
  - `duration_unit`, `duration_count` or `end_date`;
  - `price_type` (`free | fixed | percent_off | amount_off`), `value`;
  - timestamps and `deleted_at`.
- The switch is a flag on `BillingItem`. Undoable commands for phase writes.
- The CPQ side extends `CpqQuotePriceAdjustment` validation, `ResolvedCharge.schedule`, and the event payload (`items[].charges[].phases[]`).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A day charged twice, or missed, at a phase boundary | High | The watermark stays the only guard. Boundary unit-test table (§7, Phase 1 step 1) |
| A phase edited after its period was invoiced | High | Only unbilled periods are editable. Corrections go through credit memos |
| CPQ and billing schedules drift (merged MRC charges, rounding) | Medium | CPQ sends merged fixed-price phases. The end-to-end test compares the quote schedule with the invoices |
| 0.00 lines or invoices rejected by Colombian e-invoicing | Unknown | W6 before Phase 1 ships to Walix |
| Above-standard prices (D6) slip through without review | Medium | Same permission as discounts. Pricing signals carry the uplift, so a project can add an approval workflow |

## References

- Salesforce: [Ramp action API](https://developer.salesforce.com/docs/atlas.en-us.260.0.comms_developer_guide.meta/comms_developer_guide/connect_requests_group_ramp_action_input.htm), [Summer '26 ramp flow incl. trial (secondary source)](https://nebulaconsulting.co.uk/insights/agentforce-revenue-management-arm-ramped-deals-just-got-easier-with-summer-26/), [Winter '26 ramp segments (secondary source)](https://www.crosscountry-consulting.com/insights/blog/new-features-in-revenue-cloud-advanced-winter-26-release/)
- Zuora: [Ramps and ramp metrics](https://docs.zuora.com/en/zuora-billing/manage-accounts-subscriptions-and-non-subscriptions/manage-subscription-transactions/orders/ramps-and-ramp-metrics/overview-of-ramps-and-ramp-metrics), [Ramp deals in CPQ X](https://knowledgecenter.zuora.com/Zuora_CPQ/CPQ_X/4_Advanced_CPQ_X_Functionalities/Create_ramp_deals_in_CPQ_X)
- Stripe: [Subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules), [Trials](https://docs.stripe.com/billing/subscriptions/trials)
- Chargebee: [Subscription ramps](https://www.chargebee.com/docs/billing/2.0/subscriptions/ramps)
- Recurly: [Ramp pricing](https://docs.recurly.com/docs/ramp-pricing)

## Changelog

| Date | Change |
|---|---|
| 2026-11-26 | Split from the first skeleton (`2026-11-26-billing-flexible-items.md`). Q1–Q6 resolved into D1–D5. New open questions P-Q1–P-Q3 |
| 2026-11-26 | P-Q1–P-Q3 resolved: above-standard manual prices allowed in general (D6), months in CPQ (D7), new ramps on existing lines through ARC postponed (D8) |
| 2026-11-26 | Price rules get phases (D9); the per-month waterfall (rule phases → standard, manual phases → offer). D6 moved to the new CPQ manual pricing flexibility spec, which Phase 2 depends on. New open question R-Q1 (campaign dates) |
| 2026-11-26 | R-Q1 → D10 (campaign dates Valid from / Valid until on price rules) |
