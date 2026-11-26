# Billing + CPQ — Own Billing Period per Line, and Line Status

**Date**: 2026-11-26
**Status**: Business spec, internal questions resolved (D1–D6). Waiting for Walix's answers (§6), then the technical design (§8)
**Owner**: Mac
**Packages**:
- `@dainamite/billing`: line period, line status, engine, UI, API, AI tools
- `@dainamite/cpq`: per-charge billing period; per-item status changes and events (end-to-end path)
- `@dainamite/cpq-billing-connector`: maps both to billing

**Trigger**: prospective customer Walix (ISP / telco in Colombia, COP), chat 2026-11-24/25. Walix uses **billing only**; the packages must still support the CPQ → billing flow.
**Sibling spec**: [`2026-11-26-billing-price-phases-ramp-deals.md`](2026-11-26-billing-price-phases-ramp-deals.md) (trials, promotions, ramps).
**Related**:
- [Spec A — cycle semantics](2026-11-14-billing-cycle-semantics.md): per-item charge timing, proration, the watermark
- [Bill cycle day](2026-11-16-billing-operator-polish-and-bill-cycle-day.md): account cycle = unit × interval + cycle day
- [SPEC-002 prepaid](SPEC-002-2026-06-17-prepaid-billing.md)
- [XD-215 customer inventory](../../specs/implementation/xd-215-customer-inventory.md): CPQ subscription and item statuses
- [Billing umbrella](2026-11-14-billing-improvements-requirements.md): WS-5 dunning (deferred)

---

## TLDR

**Key points:**
- **The account stays the invoice anchor.** Its cycle and cycle day decide when invoices go out, one invoice and one due date per bill date.
- **Own billing period per line.** A recurring line can override the account's cycle ("every N days / weeks / months / years"), so a yearly mobile plan sits on a monthly internet account and appears on the monthly invoice when it is due.
- **Line status.** Each line can be paused, suspended or put in a grace period, from a date to a date. Each status has a defined billing effect. Termination stays an end date on the line, which exists today.
- **No change to account-level rules:**
  - **In advance / in arrears** is already per line.
  - **Prepaid / postpaid** stays per account.

**Scope:**
- Billing: the line billing period, line status (dated), the billing effect in Bill Runs and prepaid close, UI, API and AI tools.
- CPQ → billing:
  - a billing period on charges in the CPQ catalog (D5);
  - status and termination actions on CPQ subscriptions, with the events the connector applies (D6).

**Out of scope:**
- Prepaid / postpaid per line.
- An automatic grace period → suspension. That is dunning (umbrella WS-5).
- A line's own invoice day, e.g. "annual plan always billed on 1 Jan".
- Status rules specific to Walix beyond the defaults in §4.3. Those are L3 code if needed.

## Decisions (Q&A 2026-11-26)

| # | Decision |
|---|---|
| D1 | Walix uses billing only. Line period and status are set on billing items (UI and API) and work without CPQ. The CPQ → connector → billing flow supports them too. |
| D2 | Separate from the ramp-deal / phases spec. |
| D3 | **A line with its own period counts its periods from the line's start date.** An annual plan started 10 Dec runs 10 Dec – 9 Dec, with no prorated stub. It is invoiced on the account bill date on or before the period start (in advance), or on the first bill date after the period ends (in arrears). Salesforce Billing uses the same rule. Lines that follow the account's cycle behave exactly as today. |
| D4 | **Prepaid / postpaid stays on the account.** Per line, the operator chooses in advance / in arrears, which already exists. A customer who needs both a top-up balance and invoices gets two billing accounts, which already works. |
| D5 | **A CPQ charge has a billing period, defined in the CPQ catalog.** The product charge on an offering gets **Billing period** (every N months / years; default every 1 month). Its fixed price or pricing-table price is the price per that period. The catalog pages (offering charges, price display) show it, e.g. "480,000 / year". The quote line, order and subscription item inherit it, with no override on the quote in this spec. MRC totals and deal value use the **monthly equivalent** (480,000 / year → 40,000), so lines stay comparable. The connector passes the period and the price per period to the billing item. |
| D6 | **For CPQ lines, every status action comes from the subscription.** Suspend, resume, pause, grace period and terminate are performed on the CPQ subscription, for the whole subscription or one of its items. **CPQ is responsible for emitting the event.** Billing only keeps the status and applies its billing effect, and shows it read-only on those items. Lines created directly in billing (Walix) have their status set in billing (UI and API). |

---

## 1. Walix requirements and our reading

| # | Walix asked | Today | This spec |
|---|---|---|---|
| R1 | Billing cycle per line, not on the account: daily, weekly, monthly, annual. Example: monthly internet plus a one-year mobile plan on one account | Cycle only on the account. An item's price is per account cycle | Own billing period per line. The account keeps the invoice date (§4.1–4.2) |
| R2 | In advance / in arrears per line | **Exists** (`charge_timing`) | No change |
| R3 | Prepaid / postpaid per line | Per account | Stays per account (D4). Walix to confirm they meant R2 (W1) |
| R6 | Status per line: Active, Paused, Suspended, Grace period, Terminated | Billing: end date and a derived billing-state pill. CPQ items have statuses that never reach billing | Dated line status with a billing effect (§4.3) |
| R7 | Three services; from 1 Dec keep only Internet | **Exists**: an end date per billing item (prorated, with a credit for days already billed), or a CPQ Amend quote | No change. "Already possible" in the customer document |

**About Walix's screenshot.** It is Stripe's subscription schedule. Its Phase 2 keeps only FTTH 100, which is R7: an end date on the dropped lines.

## 2. Market reference

| Capability | Salesforce Revenue Cloud | Zuora | Stripe | Chargebee / Recurly |
|---|---|---|---|---|
| Invoice anchor | Billing day of month | Account bill cycle day | Subscription billing anchor | Subscription |
| Cadence per line | Billing frequency per product, overridable on quote line / order product | Billing period per charge | Mixed-interval subscriptions (2025): each item has its own period, combined on one invoice when periods line up | Per plan |
| Advance / arrears | Billing type per product. Advance → nearest billing day **on or before** the start; arrears → nearest billing day **after** | Billing timing per charge | — | — |
| Prepaid / postpaid | — | Per account | Customer credit balance | Customer credit balance |
| Pause / suspend | — | Suspend / Resume on the **subscription**: no charges for the suspended window; no amendments while suspended | Pause collection on the **subscription** | Pause on the **subscription** |

**What we take:**
- **Account anchor plus per-line cadence**, combined on one invoice.
- **Salesforce's invoice-date rule** (D3).
- **Zuora's "no charge while suspended"** as an option, not as the default (§4.3).

**Where we differ:** status is per line, not per subscription. Telecom BSS systems work this way, and billing has no subscription layer.

## 3. Current state (verified 2026-11-26)

**Billing account**
- `bill_cycle` × `bill_cycle_interval` + `bill_cycle_day`, default monthly. `next_bill_date` is the bill date.
- `billing_mode` is immutable. Several accounts per customer are allowed.

**Billing item**
- The recurring price is per **account** cycle.
- `charge_timing`, `prorate`, `bill_start_date` / `bill_end_date`, `billed_to_date`, `is_active`.
- No own period and no status: the pill in `lib/itemBillingState.ts` shows billing progress (scheduled / due / current / fully billed…).

**Engine**
- `computeRecurringLines` (Bill Run and prepaid close) cuts every recurring item along the **account** grid.

**CPQ**
- Charges are `nrc | mrc | usage`, with no billing period. Order conversion hard-codes the subscription to `billingCycle: 'monthly'`.
- Subscription and item statuses are `pending / active / suspended / terminated / expired / superseded`. The status changes only **per whole subscription** (all items follow).
- A status change through the inventory status endpoint (`cpqInventoryService.transitionSubscriptionStatus`) **emits no event**. Billing therefore keeps charging a **suspended** subscription, and also one **terminated** there. Only the ARC cancel flow emits `cpq.subscription.cancelled`, which the connector turns into end dates.

## 4. Business rules

### 4.1 The account stays the invoice anchor

- The account's cycle and cycle day decide **when invoices go out** (the ISP's "cut-off day"). Everything due on a bill date goes on one invoice, with one due date.
- The cycle defaults to monthly, so an operator who uses line periods never has to think about it.
- Answer to Walix's "no billing cycle on the account": the account keeps only the invoice date; what each line charges, and how often, moves to the line.

### 4.2 Own billing period per line

- **The choice.** A recurring line gets **Billing period: Same as account (default) | Every N days / weeks / months / years**. Its price is per its own period.
- **Which invoice** (D3):
  - In advance: the bill date on or before the period start. A line created after that date is picked up by the next run.
  - In arrears: the first bill date after the period ends.
- **Short periods on a long account cycle** (daily or weekly lines on a monthly account) are grouped into **one invoice line per item**, with the covered span and the count. Example: "Mobile weekly pack · 4 weeks (1–28 Dec) × 15,000".
- **Mid-period start or end.** The first period starts on the line's start, so it is never partial. An end date inside a period prorates that period, and credits days already billed in advance, as today.
- **Phases** (sibling spec) count in calendar time, so they work with any line period.
- **Prepaid accounts:** the same rules apply at period close (shared engine).

**Example.**
- Account: monthly on the 1st.
- Internet: 79,900 / month, same as account, in advance.
- Mobile: 480,000 / year, own period "every 1 year", starts 10 Dec 2026, in advance.

| Invoice | Lines |
|---|---|
| 1 Dec 2026 | Internet · Dec: 79,900 (Mobile doesn't exist yet) |
| 1 Jan 2027 | Internet · Jan: 79,900; Mobile · 10 Dec 2026 – 9 Dec 2027: 480,000 |
| 1 Feb – 1 Nov 2027 | Internet only |
| 1 Dec 2027 | Internet · Dec: 79,900; Mobile · 10 Dec 2027 – 9 Dec 2028: 480,000 |

### 4.3 Line status

| Status | Meaning | Set by | Billing effect (default; W2–W4) |
|---|---|---|---|
| Pending | The line starts in the future | derived | Nothing billed |
| Active | Running | derived | Billed at the phase or regular price |
| **Paused** | The customer asked to stop for a while (from / to; the end can be open) | billing operator or API; CPQ event for CPQ lines (D6) | **No recurring charge for paused days** (prorated) |
| **Suspended** | The provider cut the service, usually for non-payment | billing operator or API; CPQ event for CPQ lines (dunning later) | **Keep charging** by default; option "no charge" per suspension |
| **Grace period** | Payment overdue, service still on | billing operator or API; CPQ event for CPQ lines (automatic with dunning later) | Billed normally. It is a flag that warns before a suspension |
| Terminated | Ended on a date | billing operator or API; CPQ cancel or terminate event for CPQ lines | Exists: last period prorated; unused days already billed in advance credited |

**Rules:**
- A status is a **dated period** (from, to). A Bill Run knows which days were paused even when the pause was recorded late.
- A pause recorded **after** those days were billed in advance gives a credit line for them, like an early end today. It needs a reason, as the current credit rule does.
- Periods on one line never overlap. Resuming means setting the end of the open period.
- **Bulk action:** pause or suspend every line of an account (e.g. suspending a customer for non-payment).
- **The account Items tab** shows the service status pill next to the billing-state pill, e.g. "Paused until 15 Jan".
- **Usage lines** are not charged by status. The usage that arrives is billed (W2).

**Example: pause.** Internet 79,900 / month, in advance, account on the 1st. Paused 10–19 Jan, recorded on 9 Jan, before the 1 Feb run.

- January was already billed in advance on 1 Jan.
- The 1 Feb invoice credits the 10 paused days: 79,900 × 10/31 = **−25,774.19**, reason "Paused 10–19 Jan". It also charges February in full: 79,900.

### 4.4 CPQ → billing (end-to-end path)

**Line period (D5)**
- The catalog defines the period on the product charge.
- The quote shows the price per period. MRC totals use the monthly equivalent.
- The order and subscription item keep the period. The activation and added-item payloads carry `billingPeriod` and the price per period on the recurring charge.
- The connector creates the billing item with that period.
- A subscription item with charges of different periods becomes **one billing item per period**. Today it is one recurring item per subscription item; the item's `sourceRef` gains the period so the items stay idempotent.

**Status (D6)**
- CPQ subscriptions get the actions **pause, suspend, resume, grace period and terminate**, on the whole subscription or on one item. Today there is no pause or grace, and changes apply only to the whole subscription.
- Every action **emits an event** with the item ids, the status, the effective date (from / to) and, for suspensions, the charge behaviour. A subscription-wide action lists every affected item.
- **Terminate** in inventory emits an event too, so it ends the billing items like an ARC cancel does. This closes today's gap (§3).
- The connector writes the billing status periods, or end dates for a terminate. Billing does not decide anything about CPQ lines' status itself.

**Lines without CPQ:** billing items with no `subscription_id` (Walix) take status changes from the billing UI and API.

## 5. User stories

- **Billing operator (Walix)**: I add a yearly mobile plan to a customer's monthly internet account. It appears on the invoice once a year when due, and the customer still gets one invoice a month.
- **Billing operator**: I pause a customer's TV line from 10 to 19 January, and the next invoice credits exactly those days.
- **Billing operator**: I suspend all lines of a customer who doesn't pay. Charges continue unless I choose "no charge".
- **Billing operator**: I see each line's service status next to its billing state.
- **API integrator**: I set a line's billing period on create, and change a line's status with dates in one call.
- **Sales rep / ops (CPQ)**: I sell an annual add-on in CPQ, and billing charges it yearly. When I suspend one subscription item in CPQ, billing follows.

## 6. Questions to confirm with Walix

- **W1.** By "prepaid / postpaid per line", do you mean **in advance / in arrears** (already per line)? Or a top-up balance for some services and invoices for others?
- **W2.** Paused service: no charge while paused? Is there a pause fee? Is there a maximum pause length? Are usage charges billed during a pause?
- **W3.** Suspended for non-payment: keep charging during the suspension? Is there a reconnection fee?
- **W4.** Grace period: how many days, per service or per customer, and what starts and ends it?
- **W5.** Does a pause extend a running trial or promotion? Proposal: no, phases follow the calendar.
- **W8.** Which line periods do you really sell (daily, weekly)? Daily mobile packages are usually a top-up balance, not invoiced lines.

## 7. Implementation plan (outline; sized after sign-off)

**Phase 1 — Line period (billing).**
1. Pure period math per line (`billPeriod` / `servicePeriods`): item grid from its start, invoice-date rule, grouping of short periods. Unit tests for the §4.2 example, a weekly line on a monthly account, in arrears, an end date mid-period, catch-up.
2. Entity, hand-written migration and validators. API with `openApi`, plus the AI tool update in the same PR. Item form, i18n, docs.

**Phase 2 — Line status (billing).**
1. A dated status entity and commands (undoable). Engine effect (no charge / charge, credit for days already billed). Bulk account action.
2. API with `openApi`, AI tools, the status pill, i18n, docs.

**Phase 3 — CPQ + connector.**
1. Catalog: billing period on product charges (entity, offering charge editor, price display). Quote, order, subscription item and payload carry it. MRC uses the monthly equivalent. The connector maps it, one billing item per period (D5).
2. Subscription actions: pause, suspend, resume, grace period and terminate, on the subscription or one item. Each emits an event. Terminate in inventory emits one too. Connector subscribers write the billing status periods and end dates (D6). Billing shows the status read-only on CPQ items.
3. End-to-end test: an annual add-on, a suspension of one item, and a terminate from inventory, from CPQ to invoices.

## 8. Technical design *(after business sign-off)*

- `BillingItem` + `billing_period_unit` / `billing_period_interval` (null = follow the account).
- New `BillingItemStatusPeriod`:
  - `id`, `organization_id`, `tenant_id`, `billing_item_id` (FK string);
  - `status` (`paused | suspended | grace`), `from_date`, `to_date`;
  - `charge_behavior`, `reason`;
  - timestamps and `deleted_at`.
- CPQ:
  - `CpqProductCharge.billing_period_unit` / `billing_period_interval`, carried on line, order line and subscription item charges;
  - subscription / item status commands;
  - events, e.g. `cpq.subscription_item.status_changed` and `cpq.subscription.terminated` (names to be settled; declared in `events.ts`).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Wrong amounts when line periods and account cycles differ (a period billed twice or skipped) | High | The watermark stays the single guard. Boundary test table (§7, Phase 1 step 1) |
| A pause or suspension recorded after billing | High | Credit lines with a reason, as for an early end |
| CPQ and billing disagree on a line's status | Medium | One owner per line: CPQ for CPQ lines, read-only in billing (D6). A lost event is replayed by the persistent subscriber |
| The monthly equivalent of a yearly charge confuses reps (MRC 40,000 vs price 480,000 / year) | Low | The quote shows both: the price per period and the monthly equivalent |
| Long invoices from daily or weekly lines | Medium | One grouped line per item per invoice |
| Walix's "general document" changes the status rules | Medium | Status effects are defaults with options (W2–W4) |

## References

- Salesforce: [Explore billing features and roles](https://trailhead.salesforce.com/content/learn/modules/billing-basics-in-revenue-cloud/explore-billing-features-and-roles), [Customize invoicing by product](https://trailhead.salesforce.com/content/learn/modules/product-configuration-for-salesforce-billing/customize-invoicing-by-product)
- Zuora: [Suspend a subscription](https://docs.zuora.com/zuora-billing/manage-accounts-subscriptions-and-non-subscriptions/manage-subscription-transactions/subscribe-and-amend/amend-subscriptions/suspend-subscriptions)
- Stripe: [Mixed-interval subscriptions](https://docs.stripe.com/billing/subscriptions/mixed-interval)

## Changelog

| Date | Change |
|---|---|
| 2026-11-26 | Split from the first skeleton (`2026-11-26-billing-flexible-items.md`). Q1, Q4 and Q6 resolved into D1–D4. New open questions L-Q1–L-Q2 |
| 2026-11-26 | L-Q1 → D5 (billing period on CPQ catalog charges, monthly equivalent in MRC). L-Q2 → D6 (status actions come from the CPQ subscription; CPQ emits the events; billing keeps the status) |
