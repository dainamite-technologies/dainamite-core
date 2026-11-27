# Billing — own billing period per line, line status, price phases

Operator and integrator manual for three features of `@dainamite/billing`
(specs [line period and status](../.ai/specs/2026-11-26-billing-line-period-and-status.md),
Phases 1–2, and [price phases](../.ai/specs/2026-11-26-billing-price-phases-ramp-deals.md), Phase 1).
They work without CPQ; the CPQ → connector path is a later phase.

## The account stays the invoice anchor

The account's bill cycle and cycle day decide **when invoices go out**. Everything
due on a bill date lands on one invoice with one due date. What each line charges,
and how often, is set on the line.

## Own billing period per line

A recurring item has **Billing period: Same as account** (default) or **Every N
days / weeks / months / years**. Its price is per its own period.

- Periods count from the line's **start date** — no prorated stub. An annual plan
  started 10 Dec runs 10 Dec – 9 Dec.
- **In advance**: invoiced on the bill date on or before the period start. A line
  created after that bill date is picked up by the next run.
- **In arrears**: invoiced on the first bill date after the period ends.
- **Short periods on a long account cycle** (daily / weekly lines on a monthly
  account) are grouped into **one invoice line per item**: quantity = number of
  periods, unit price = price per period, the description carries the span
  ("Mobile weekly pack · 1 Dec – 28 Dec", 4 × 15,000).
- An **end date inside a period** prorates that period by days. Ending a line
  that was billed in advance credits the unused days, as before.

Example — account monthly on the 1st; Internet 79,900 / month (same as account);
Mobile 480,000 / year (every 1 year), starts 10 Dec 2026, in advance:

| Invoice | Lines |
|---|---|
| 1 Dec 2026 | Internet · Dec: 79,900 (Mobile created later) |
| 1 Jan 2027 | Internet · Jan: 79,900; Mobile · 10 Dec 2026 – 9 Dec 2027: 480,000 |
| 1 Feb – 1 Nov 2027 | Internet only |
| 1 Dec 2027 | Internet · Dec: 79,900; Mobile · 10 Dec 2027 – 9 Dec 2028: 480,000 |

## Line status

| Status | Meaning | Billing effect (default) |
|---|---|---|
| Paused | The customer stops for a while (end may be open) | **No recurring charge** for paused days (prorated). Option: keep charging. |
| Suspended | The provider cut the service | **Keeps charging**. Option "no charge" per suspension. |
| Grace period | Payment overdue, service on | Billed normally — a flag only. |
| Terminated | — | Set the line's end date (exists). |

- A status is a dated period (from, to). Periods on one line never overlap.
  **Resume** = set the end of the open period.
- A pause recorded **after** those days were billed in advance gives a **credit
  line** on the next invoice, with the reason (the operator's text, else
  "Paused 10 Jan – 19 Jan"). Example: Internet 79,900 / month in advance, paused
  10–19 Jan, recorded 9 Jan → the 1 Feb invoice has −25,774.19 (10/31 days) and
  February at 79,900.
- Shortening or removing a pause after billing re-charges the days that were left
  uncharged ("Pause shortened, … charged").
- **Bulk**: pause or suspend every line of an account (e.g. non-payment). CPQ
  lines, lines with an overlapping status and lines ended before the start date
  are skipped and listed.
- **Usage lines** are never affected: usage that arrives is billed.
- **CPQ lines** (items with a subscription) are read-only in billing — their
  status comes from the CPQ subscription (the connector writes it).
- Phases follow the calendar: a pause does **not** extend a trial or promotion.

## Price phases (trials, promotions, ramps)

Switch on **Price changes over time (phases)** on a recurring item and add up to
12 phases. Each phase has an optional **name** (printed on the invoice), a
**duration** (N days / weeks / months / years, or "until <date>") and a **price**:
*Free*, *Fixed price* (per billing period), *% off regular*, *Amount off regular*.

- Phases run **back to back from the bill start date**; durations are calendar
  units from each phase's start (31 Jan + 1 month ends 27 Feb). After the last
  phase the item's own (regular) price applies.
- A phase ending inside a billing period **splits the line on the exact date**,
  each part prorated by days. With proration off, the phase in force on the
  period's first day prices the whole period.
- Invoice line: "Internet 200 Mb — Promo 50% · 1 Jan – 31 Jan". A free phase
  prints a 0.00 line. Consecutive pieces of one phase are merged into one line
  ("Free trial · 14 Nov – 13 Dec").
- **Only periods not yet invoiced can change.** A change that would re-price an
  invoiced day is refused (`billing.item.phase_edit_billed`) — issue a credit memo.
- **Change price** on a phased item keeps the remaining phases on their original
  dates (the promotion does not restart).
- **Ending** an item drops the phases after the end.

| Deal | Regular price | Phases |
|---|---|---|
| First month free | 79,900 / month | Free, 1 month |
| 50% off for 3 months | 79,900 / month | 50% off, 3 months |
| Free month, then 50% for 2 months | 79,900 / month | Free, 1 month → 50% off, 2 months |
| Ramp 100 / 110 / 120 | 120 / year | Fixed 100, 1 year → Fixed 110, 1 year |

## API

- `POST /api/billing/items`, `PUT /api/billing/items`, `POST /api/billing/items/bulk`:
  `billingPeriodUnit` (`daily` | `weekly` | `monthly` | `annually` | null),
  `billingPeriodInterval` (≥ 1), `phasesEnabled`, `phases[]` (`name`, `durationUnit`
  + `durationCount` **or** `endDate`, `priceType`, `value`). On update `phases`
  replaces the schedule.
- `GET /api/billing/items` rows carry `billing_period_unit`, `billing_period_interval`,
  `phases_enabled` (+ camelCase aliases), `phases[]` (with computed `startDate` /
  `endDate`) and `statusPeriods[]`.
- `GET|POST|PUT|DELETE /api/billing/items/status-periods` — status periods
  (`billingItemId`, `status`, `fromDate`, `toDate`, `chargeBehavior`, `reason`).
- `POST /api/billing/items/status-periods/bulk` — every line of an account.
- Commands (for integrations through the command bus): `billing.items.create |
  update | bulk_create | change_price`, `billing.items.status_periods.create |
  update | delete | bulk_create` (undoable).

AI tools: see [billing-ai-agent.md](billing-ai-agent.md).

## Engine notes (for developers)

`lib/servicePeriods.ts` `computeRecurringLines` is shared by the postpaid Bill Run
and the prepaid period close. It prices each line on the account grid or on the
item's own grid, splits at phase boundaries, leaves no-charge status days
uncharged, and corrects already-billed days (end credit, status credit,
status re-charge). `billed_to_date` remains the only double-billing guard; each
status period stores `applied_from` / `applied_to` (the days the engine already
left uncharged) so a late pause is credited once. Test and dry runs simulate the
same state in memory.
