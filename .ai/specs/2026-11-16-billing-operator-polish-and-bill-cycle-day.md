# Billing — Operator Polish & Bill Cycle Day (incl. every-N cycles)

**Date**: 2026-11-16
**Status**: Part 1 implemented; Part 2 ready to implement
**Package**: `@dainamite/billing` 0.22 → 0.23 (minor), plus `@dainamite/cpq-billing-connector` (it creates accounts and prorates on the cycle grid)
**Related**:
- [`2026-11-15-billing-operator-feedback.md`](2026-11-15-billing-operator-feedback.md)
- Spec A: recurring service periods (`lib/servicePeriods.ts`)
- Spec E: account workspace and item navigation (`lib/navigation.ts`)
- SPEC-002: prepaid period close

## TLDR

Four operator-facing improvements, from smallest to largest:

1. **The service period shows on every recurring and usage invoice line.** Today it appears only on prorated and credit lines.
2. **The ← back arrow on a payment returns to the billing account** when the payment was opened from that account. Otherwise it returns to the Payments list.
3. **The Billing Accounts list gets a billing-state pill**, in the same style as the item pill. It replaces the "Last bill" column.
4. **`bill_cycle_anchor` becomes `bill_cycle_day`, and billing actually uses it.** The cycle becomes **"Every [N] [days | weeks | months | years]"**. The default is every 1 month, and `quarterly` becomes every 3 months.

Items 1–3 need no schema change and are safe to ship first. Item 4 changes the schema, the API contract and the cycle math, and it carries all of the design risk.

### Does billing start using the bill cycle day? Yes, in three places

| Where | Today | After |
|---|---|---|
| **Account create** | The operator types the first bill date. The anchor is ignored | `next_bill_date` defaults to the first occurrence of the cycle day on or after today |
| **Every bill run / prepaid close** (when the next bill date moves forward one cycle) | `next_bill_date + 1 cycle`. A 31st drifts to 28 Feb and then stays on the 28th forever | The next bill date is put back on the cycle day every cycle (31 → 28 Feb → 31 Mar) |
| **Changing the day on a live account** | It has no effect at all | `next_bill_date` moves to the next occurrence of the new day. That bill covers a **short alignment period**, and in-advance charges are prorated for the gap |

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Item 1 shows the period **from the stored columns**, not from text in the description | Every recurring line already stores `service_period_start/end`. This fixes invoices already posted without touching immutable documents, and it renders dates in the viewer's locale |
| D2 | Item 2 follows the item precedent: `?from=account` plus a pure return-target resolver | Consistent with `resolveItemReturnTarget`. Deep links still work |
| D3 | Item 3 uses a pure `accountBillingState(account, today)` that mirrors `itemBillingState`, and a shared pill component | It is unit-testable and needs no API change |
| D4 | Cycle = **unit × interval**. The units are `daily \| weekly \| monthly \| annually`, plus `bill_cycle_interval` (default 1). `quarterly` is a **legacy input alias** for `monthly × 3` | One input field covers every-30-days, fortnightly and half-yearly. The units cannot overlap, because a quarter is just 3 months |
| D5 | `bill_cycle_day` means a day of the month (1–31; a day past the end of a short month means the last day) for monthly and annually, a weekday for weekly, and `null` for daily | Answer to Q3. Daily cycles count from `next_bill_date` |
| D6 | A day change on a live account moves `next_bill_date` immediately, and the run on that date bills a short alignment period | Answer to Q4, matching Chargebee and Zuora. The `billed_to_date` watermark already prevents double billing |
| D7 | The column is renamed in the DB, with **no API alias and no data backfill**. `quarterly` is rejected (use `monthly` × 3) | Answer to Q5. All environments are reseeded from scratch (2026-11-16), and the connector ships in the same release |

## User Stories

- As an **operator reading an invoice**, I want every recurring and usage line to say which period it charges for, so I can answer "what is this charge?" without opening the item.
- As an **operator reconciling an account**, I want the back arrow on a payment to take me back to that account's Payments tab.
- As an **operator scanning accounts**, I want to see at a glance which accounts are billed up to date and which have a missed or late bill run.
- As an **operator onboarding a customer**, I want to say "bill on the 15th of every month" or "bill every 30 days", and have billing keep to that schedule. I also want to move the day later without a manual date fix.

---

## Current State (verified 2026-11-16)

| Item | Where | Today |
|---|---|---|
| 1 | `lib/invoiceWriter.ts` `buildRecurringLineDescriptors` | Adds `· start – end` to `description` **only** when `proration !== null` or the line is a credit |
| 1 | `BillingInvoiceLine.service_period_start/end` | Already **set on every recurring line**. `invoices/[id]/page.tsx` loads them but does not render them |
| 1 | `lib/pdf/invoiceModel.ts` | The PDF already adds `(start – end)` from the columns when the description has no dates |
| 1 | `lib/usageRunner.ts` | Usage lines set **no** service period |
| 2 | `payments/[id]/page.tsx` | `backHref="/backend/billing/payments"` is hard-coded (in the header and in `RecordNotFoundState`). `PaymentsTable` row click and `AccountPaymentsSection.onCreated` push a bare `/payments/<id>` |
| 3 | `accounts/page.tsx` | The Next bill and Last bill columns are plain dates. The Status pill shows Active or Inactive only |
| 4 | `BillingAccount.billCycleAnchor` (text: `1–28 \| mon–sun`) | Read **only** for display. Bill periods are worked out entirely from `next_bill_date` (`billPeriod.ts`, `servicePeriods.ts`, `billRunEngine.ts`, `prepaidPeriodClose.ts`) |
| 4 | `billRunEngine` | The arrears period is `deriveBillPeriod(billDate)` = `[billDate − cycle, billDate − 1]`, which assumes every period is exactly one cycle long |
| 4 | CPQ connector order setup | Has free-text "Bill cycle anchor" and "First bill date" inputs, and sends `billCycleAnchor` + `nextBillDate` |
| 4 | Migrations | No billing migration has done a data backfill before. This one would be the first (see Phase 4) |

---

## Proposed Solution

### 1. Service period on invoice lines

- **Admin invoice page:** the Lines table shows `start – end` (locale date format) as a muted second line under the description whenever both columns are set **and** the description does not already contain ` – `. The PDF already uses this check, so periods are not printed twice.
  - The check moves into a shared pure helper, `lineServicePeriodLabel(line)`, used by both the PDF model and the page.
- **Usage lines:** `usageRunner` stamps `servicePeriodStart/End` with the bill period being rated, so the PDF and the UI pick them up.
- Statements and credit memos use the same helper wherever they list invoice lines.
- No change to the description text, so posted documents stay byte-identical.

### 2. Payment back navigation

- `lib/navigation.ts` gains `FROM_ACCOUNT = 'account'` and `resolvePaymentReturnTarget({ from, billAccountId })`:
  - `from=account` with an account → `accountHref(billAccountId, 'payments')`;
  - anything else → `/backend/billing/payments`.
- `PaymentsTable` gets an optional `from?: string` prop that is added to the row link. The account Payments tab and `AccountPaymentsSection.onCreated` pass `'account'`, and the global list passes nothing.
- The payment page reads `useSearchParams().get('from')` and uses the resolver for **both** `FormHeader.backHref` and the `RecordNotFoundState` back link. The back label follows the target: "Billing account" or "Payments".

### 3. Account billing-state pill

`lib/accountBillingState.ts` (pure, with `today` as a `YYYY-MM-DD` string):

| Status | Condition (in this order) | Label | Tone |
|---|---|---|---|
| `inactive` | `!is_active` | Inactive | neutral |
| `due` | `next_bill_date ≤ today` | Due since `<next_bill_date>` | warning |
| `not_billed` | `last_bill_date` is null | Not billed yet | neutral |
| `current` | otherwise | Billed through `<last_bill_date>` | success |

- `due` comes before `not_billed`, so a fresh account whose first run was missed still shows as due.
- The pill markup and tones are extracted from `AccountItemsTab` into `components/BillingStatePill.tsx` and reused there and on the accounts list. Items and accounts then share one visual language.
- The accounts list replaces the **Last bill** column with a **Billing** column (the pill) and keeps **Next bill**. There is no API change, because every input is already in the list payload.
- The account workspace header shows the same pill next to the Active badge.

### 4. Bill cycle day + every-N cycles

#### 4a. Cycle model

- `BILL_CYCLES = ['daily', 'weekly', 'monthly', 'annually']`.
- `LEGACY_BILL_CYCLES = { quarterly: { cycle: 'monthly', interval: 3 } }` is accepted on input only.
- `bill_cycle_interval` ranges by unit: daily 1–366, weekly 1–52, monthly 1–24, annually 1–5.
- `bill_cycle_day` rules, validated with a cross-field `superRefine`:

| Unit | `bill_cycle_day` | Example |
|---|---|---|
| daily | must be `null` | "Every 30 days" (counts from `next_bill_date`) |
| weekly | `mon`–`sun` | "Every 2 weeks on Monday" |
| monthly | `1`–`31` (a day past the end of a short month means the last day) | "Every 1 month on the 15th" |
| annually | `1`–`31`. The month is the month of `next_bill_date` | "Every 1 year on 15 March" |

#### 4b. Cycle math (`lib/billPeriod.ts`, the single source of truth)

The cycle helpers take a `CycleSpec = { cycle, interval, day }` instead of a bare `BillCycle`.

- **`onCycleDay(date, spec)`** is true when the date falls on the cycle day. For monthly and annually, a day past the end of the month counts as the month's last day.
- **`nextOccurrence(after, spec, inclusive)`** returns the first date on the cycle day at or after `after`.
- **`advanceNextBillDate(billDate, spec)`** has two cases:
  - **Steady state** (`onCycleDay(billDate)`): shift by `interval` units, then **re-pin** the day of month to the cycle day (clamped). This fixes the 31st drifting to the 28th.
  - **Alignment** (billDate is off the cycle day, e.g. a legacy row or an explicit `nextBillDate` on create): `nextOccurrence(billDate + 1 day)`. The result is one short period.
  - **Daily:** `billDate + interval days`.
- **`shiftCycles(anchor, spec, k)`** multiplies by `interval` and re-pins the day.
  - It still works directly from the anchor and never chains steps.
  - `servicePeriods.gridPeriodContaining` changes its `approxDays` to `unitDays[cycle] * interval`.
  - `cycleContaining` (used by the connector) changes the same way.
- **Arrears period in the engines:** `periodStart = last_bill_date + 1` when `last_bill_date` is set, otherwise `billDate − one cycle` (the fresh-account fallback, unchanged). This is what makes the short alignment period bill correctly. It applies in both `billRunEngine` and `prepaidPeriodClose`.

With `interval = 1` and the cycle day equal to the day of `next_bill_date`, every helper returns **the same dates as today**. The existing `billPeriod` / `servicePeriods` test tables are kept as the regression check.

#### 4c. Where the day is applied

1. **Create:**
   - `nextBillDate` is optional. If it is omitted, it becomes `nextOccurrence(today, spec, inclusive)`.
   - If it is given and falls off the cycle day, it is accepted, and the first period is an alignment period (documented in `openApi`).
   - For daily cycles `nextBillDate` is the anchor. It defaults to today.
2. **Update, when `billCycle`, `billCycleInterval` or `billCycleDay` changes and the client did not also send `nextBillDate`:**
   - The command recomputes `next_bill_date = nextOccurrence(max(today, last_bill_date + 2 days), newSpec, inclusive)`. The `+2 days` keeps the alignment period at least one day long.
   - The next run bills `[last_bill_date + 1, new next_bill_date − 1]` for arrears. In-advance items are charged from their watermark to the new horizon and prorated for the partial grid period, using the existing Spec A path.
   - **Example:** monthly on day 15, last billed through 14 Nov, today is 16 Nov. The operator changes the day to 1. `next_bill_date` becomes 1 Dec, and that run bills the 15–30 Nov arrears plus in-advance charges from 15 Dec to 31 Dec, prorated. From then on it bills on the 1st.
3. **Bill run / prepaid close:** `advanceNextBillDate(billDate, spec)` as in 4b.

The update command already lacks undo for accounts (see the Phase 1 note in `commands/accounts.ts`). Nothing extra is needed: the recompute writes only `next_bill_date`. Changing the day back before the run recomputes it again, and nothing is billed until the run.

#### 4d. Form (account create and edit)

```
Bill cycle   Every [ 1 ] [ month(s) ▾ ]   on day [ 15 ▾ ]
             Bills on the 15th of every month · next bill: 15/12/2026
```

- **Defaults:** every **1 month**, on day **1**, so a new account gets the next 1st on or after today.
- **Day picker by unit:**
  - month or year → a 1–31 select, where 29–31 show the hint "or last day of shorter months";
  - week → a weekday select;
  - day → hidden.
- The next bill date is shown **read-only** and derived as the user types. An "Override first bill date" toggle reveals a date input for the explicit off-day case.
- The **Cycle** column in the list and the workspace shows the sentence form, e.g. "Monthly · day 15" or "Every 30 days".
- i18n keys go in `en/es/de/pl` and the old `cycle_anchor` keys are removed. The plural unit labels use the existing i18n plural helper.

#### 4e. CPQ connector

- Order setup replaces the free-text anchor with the same `Every [N] [unit] on day [d]` controls (default every 1 month) and makes "First bill date" optional, with the hint "defaults to the next cycle day".
- `orderSetupForm` sends `billCycle`, `billCycleInterval` and `billCycleDay`, and stops sending `billCycleAnchor`.
- `cycleContaining` calls pass the `CycleSpec`.
- Peer range: `@dainamite/billing >=0.23`, because the connector now sends the new fields.

---

## Data Models

### `BillingAccount` (changed)

| Column | Change |
|---|---|
| `bill_cycle_anchor text not null` | **Renamed** to `bill_cycle_day text null`. It becomes nullable because daily cycles have no day |
| `bill_cycle_interval int not null default 1` | **New** |
| `bill_cycle` | Values become `daily \| weekly \| monthly \| annually` (the column is still text and is validated at API ingress) |

Tenant scoping and indexes are unchanged. No new entities.

**Migration** (`Migration20261121000000_billing_cycle_day`):
1. Generate with `yarn mercato db generate`. **Check** that the diff is a `rename column`, not a drop plus add. If it is a drop plus add, change the generated statement to `alter table … rename column` so existing data is kept.
2. **Data backfill**, appended to the generated migration. This is the first data step in a billing migration, and the deviation is called out for review:
   - `update billing_accounts set bill_cycle = 'monthly', bill_cycle_interval = 3 where bill_cycle = 'quarterly'`
   - `bill_cycle_day` = the day of `next_bill_date` (or its weekday for weekly cycles), because the schedule that **actually runs today** is the one that must win. A stored anchor that disagreed with the date was never applied. The old anchor value is copied into `metadata` as `{ legacy_bill_cycle_anchor }` (if the column exists, otherwise it goes in the migration log) for audit.
3. `down()` restores the column name and makes `quarterly` rows `quarterly` again.

## API Contracts

All changes are on `/api/billing/accounts` (`GET`, `POST`, `PUT`). The ACL is unchanged (`billing.account.view` / `billing.account.manage`). `openApi` is updated.

**POST / PUT request (camelCase):**

| Field | Type | Notes |
|---|---|---|
| `billCycle` | `daily \| weekly \| monthly \| annually` (+ legacy `quarterly`) | `quarterly` → `monthly` + `billCycleInterval: 3`. A 400 is returned if `quarterly` is combined with an explicit interval other than 3 |
| `billCycleInterval` | int, range by unit (4a) | Optional. Default 1 on create |
| `billCycleDay` | `'1'–'31' \| 'mon'–'sun' \| null` | Required for weekly, monthly and annually. Must be null or omitted for daily. Numbers are also accepted and coerced to strings |
| `billCycleAnchor` | **deprecated** alias of `billCycleDay` | A 400 is returned if it is sent together with a different `billCycleDay`. It will be removed in 0.24 |
| `nextBillDate` | date, **now optional on POST** | Omitted → derived (4c). Explicit and off-day → an alignment period |

**GET list / detail response (snake_case):** adds `bill_cycle_day` and `bill_cycle_interval`. `bill_cycle_anchor` is still returned (the same value as `bill_cycle_day`), marked `deprecated: true` in `openApi`, and will be removed in 0.24. The list projection maps it in an after-list transform, because the column no longer exists.

**Errors:** a 400 with a field-level message for:
- an invalid day for the unit;
- an interval out of range;
- conflicting `billCycleAnchor` / `billCycleDay`;
- a `quarterly` + interval conflict.

**Compatibility:** existing callers that send `billCycle: monthly` + `billCycleAnchor` + `nextBillDate` keep working unchanged. The only visible change is that `quarterly` accounts are now returned as `monthly` × 3. This goes in the changeset.

---

## Implementation Plan

### Phase 1 — Service period on lines (item 1)
1. Extract `lineServicePeriodLabel` from `pdf/invoiceModel.ts` into `lib/`, with a unit test covering: dated description → no suffix, columns set → suffix, columns missing → none.
2. Render it on `invoices/[id]/page.tsx` (and in statement or memo line lists, if present).
3. `usageRunner` stamps the bill period on usage lines. Extend the `usageRater` / `usageRunner` tests.

### Phase 2 — Payment back navigation (item 2)
1. Add `resolvePaymentReturnTarget` + `FROM_ACCOUNT` to `lib/navigation.ts` and extend `navigation.test.ts`.
2. Add the `PaymentsTable.from` prop and wire it in the account Payments tab and `AccountPaymentsSection`.
3. Payment page: use the resolver in the header and in the not-found state, and add i18n for the back labels.

### Phase 3 — Account billing pill (item 3)
1. Add `lib/accountBillingState.ts` + a test covering every status and the precedence order.
2. Extract `BillingStatePill` from `AccountItemsTab`. The items tab must render the same as before.
3. On the accounts list, replace Last bill with Billing. Add the pill to the workspace header. Add i18n keys.

### Phase 4 — Bill cycle day: schema, validators, cycle math
1. Entity change → `yarn mercato db generate` → check the rename → append the backfill → **confirm with the user before `db migrate`**.
2. Validators: `BILL_CYCLES`, the legacy alias, `billCycleDaySchema`, the interval range, the cross-field refine, and the `billCycleAnchor` alias. Tests for every row in 4a and every error case.
3. `billPeriod.ts`: `CycleSpec`, `onCycleDay`, `nextOccurrence`, re-pinning `advanceNextBillDate`, and an interval-aware `shiftCycles` / `cycleContaining`. Tests:
   - the existing tables unchanged;
   - re-pinning from the 31st (Jan 31 → Feb 28 → Mar 31);
   - leap day;
   - every 30 days across month ends;
   - every 2 weeks;
   - every 6 months;
   - alignment from off-day dates.
4. `servicePeriods.ts`: interval-aware grid. Tests for full and prorated periods with `interval > 1` and for an alignment period.

### Phase 5 — Bill cycle day: engines, commands, API
1. `billRunEngine` + `prepaidPeriodClose`: pass the `CycleSpec`, and start the arrears period at `last_bill_date + 1`. Engine tests:
   - a steady state that matches today's output;
   - a day change mid-life giving one short period and then the new day;
   - catch-up across an alignment.
2. Account create and update commands: derive `next_bill_date` (4c). Command tests: omitted date, explicit off-day date, day change with and without an explicit `nextBillDate`.
3. `api/accounts/route.ts`: the new fields, the deprecated alias in the projection, and `openApi`.
4. Update the demo seeds (`lib/seeds/demo.ts`): `billCycleDay: '1'`, plus one every-30-days demo account.

### Phase 6 — Bill cycle day: UI + connector
1. `AccountForm`: the cycle row, the derived next-bill preview, and the override toggle. Show the sentence form in the list and workspace.
2. Connector order setup + `orderSetupForm` (tests updated), the `cycleContaining` callers, and the peer range bump.
3. Integration: extend TC-BILL-001 (account create) to cover the every-30-days and day-change flows.
4. Changesets: billing minor (new fields, `quarterly` normalization, `billCycleAnchor` deprecation) and connector minor. Update the billing manual's account section.

**Validation gate per phase:** `yarn typecheck`, `yarn test`, i18n parity; plus `yarn build` before the PR (then `rm -rf .mercato/next` before going back to dev).

## Risks

| Risk | Severity | Mitigation / detection |
|---|---|---|
| Cycle-math regression (month-end, leap years) | High | Helpers work from the anchor and never chain steps. Existing tables are a regression lock. A dry-run Bill Run on demo tenants before and after the change must give identical results for interval 1 |
| The backfill picks a different day from the operator's stored anchor | Medium | By design, the schedule that actually runs wins, so there is no billing change for anyone. The old anchor is kept for audit. The release note tells operators to check the "day" shown on accounts |
| `db generate` produces drop plus add instead of a rename, losing data | High | An explicit review step in Phase 4.1. The migration test runs on a seeded DB |
| The alignment period over-credits or double-charges in-advance items | Medium | The `billed_to_date` watermark is the single guard, unchanged. Engine tests cover a day change both forwards and backwards |
| External callers read `bill_cycle === 'quarterly'` | Low | Called out in the changeset. Only accounts that were quarterly are affected |
| Connector on 0.23 talking to billing 0.22 | Low | The peer range is bumped. Billing 0.23 still accepts the old payload, so an older connector with newer billing works |
| A credit for an item ended before an alignment uses a grid that no longer matches past periods | Low | Credits are worked out from the item watermark backwards. A test covers an item ending inside a pre-alignment period |

## Out of Scope

- Billing on business days only, and calendar-specific rules (e.g. "the last Friday").
- Per-item cycles, where items bill on a different schedule from their account.
- Changing a live account's billing mode (unchanged; it is frozen at create).

## Changelog

- 2026-11-16: Skeleton from the user request covering four billing improvements, with open questions Q1–Q5.
- 2026-11-16: Answers applied:
  - Q1: pill replaces Last bill;
  - Q2: unit × N, default every 1 month;
  - Q3: per-unit day semantics, 1–31 where a day past the end of a short month means the last day;
  - Q4: immediate realignment with a short period;
  - Q5: DB rename with a deprecated API alias.

  Billing now uses the day on create, on every advance and on a live change. The full design, API contract and phases were added.
- 2026-11-16: Part 2 skeleton added (credit reason on invoices; item end-before-start guards in billing and the connector). Open questions Q6–Q9.
- 2026-11-16: Part 2 finalized:
  - Q6: item-level reason, stored as jsonb so generated reasons can be translated;
  - Q7: required only when a credit results;
  - Q8: generated reasons rendered in the invoice language;
  - Q9: hard stop on activation, plus an earliest-activation-date hint in the Billing tab. CPQ's activate route gets the mutation-guard wiring.

## Part 2: Credit reasons & item date guards (added 2026-11-16)

**Status:** Ready to implement. Q6–Q9 answered on 2026-11-16.
**Packages:** `@dainamite/billing` (minor), `@dainamite/cpq-billing-connector` (minor), `@dainamite/cpq` (patch: guard wiring only).

### TLDR

5. **Credit reason.** A change can be dated inside the window an item is already billed for: a price change, an earlier end date, or a removal by a CPQ amendment, cancellation or supersession.
   - The operator sees a warning that the next invoice will carry a credit and **must** give a reason.
   - The reason is printed under the credit line on the invoice page and the PDF, so the customer knows why they got money back.
   - Reasons the connector generates are rendered in the **account's invoice language**.
6. **No item may end before it starts.**
   - Billing rejects an end date more than one day before the start.
   - The connector ends items that have not started yet the day before their own start, so they never bill.
   - The connector **blocks activating** an amendment or cancellation order before the subscription's billing has started. The order's Billing tab shows the **earliest possible activation date**.

### Decisions (answers to Q6–Q9)

| # | Decision | Rationale |
|---|---|---|
| D8 | The reason lives on the ended **billing item**: `billing_items.credit_reason jsonb null`. Bill Runs copy it into the credit line's `metadata.credit_reason` | Q6(a). It is **jsonb, not text**, because of Q8: a generated reason is stored as a code + params and rendered in the document language when the document is drawn. Operator text is stored as-is |
| D9 | The reason is required exactly when the change produces a credit: `prorate` is on and the new end date < `billed_to_date`. With `prorate` off the dialog shows only a note. Applies to the price-change dialog **and** the item form's end-date edit | Q7(a) |
| D10 | Connector credits get a generated reason `{ code, params }`, rendered in the invoice language by billing's document translator | Q8(a) + "respect invoice language". Billing owns the invoice languages and dictionaries; the connector only names the event |
| D11 | **Hard stop on activation.** CPQ has no operator-chosen amendment date: the effective date is the moment of activation (`cpqOrderService.emitAmendedEvent`). So "earliest amendment date" means the earliest **activation** date. The connector's mutation guard rejects early activation with 422, and the Billing tab shows the date in advance | Q9. Matches what CPQ actually does today |
| D12 | The CPQ activate route gets the framework's **mutation-guard wiring** (`runMutationGuards`, operation `update`) | The core `AGENTS.md` already requires this for custom write routes, and this route lacks it. CPQ stays unaware of billing; the connector registers the guard |

### Current State (verified 2026-11-16)

| Item | Where | Today |
|---|---|---|
| 5 | `ChangeItemPriceDialog`, the price-change command in `commands/items.ts`, `lib/itemPriceChange.ts` | Ends the old item at `effective − 1` and copies it at the new price. No billed-through info, no warning, no reason |
| 5 | Item form (end-date edit) | Can create the same credit silently |
| 5 | `servicePeriods` credit path → `buildRecurringLineDescriptors` | Credit lines carry `metadata.credit_for` and dates in the description. `BillingItem` has no reason or metadata column |
| 5 | `lib/pdf/invoicePdf.ts` | Has a document translator per invoice language (`resolveInvoiceLanguage` + dictionary) |
| 6 | `billingItem{Create,Update}Schema`, `commands/items.ts` | No end-vs-start check (the screenshot shows `20/11/2026 – 14/11/2026`) |
| 6 | Connector `cpq-subscription-{amended,cancelled,superseded}.ts` | End date = `effectiveDate − 1`, never compared to the item's `billStartDate` |
| 6 | `lib/itemBillingState.ts` | An item with end < start shows Billed / Starts … |
| 6 | CPQ `api/orders/[orderId]/activate/route.ts` | Custom POST without mutation-guard wiring. ARC target subscriptions are in `cpq_quote_target_subscriptions` (by quote, with `quote_type`) |
| 6 | Connector `widgets/injection/order-billing-setup` | Billing tab on CPQ order detail (`cpq.order.detail:tabs`). The place for the earliest-activation hint |

### Data Models

**`BillingItem` (changed):** `credit_reason jsonb null`. Shape (Zod `creditReasonSchema`):

```ts
type CreditReason =
  | { kind: 'text'; text: string }                       // operator, verbatim, 1–500 chars
  | { kind: 'code'; code: CreditReasonCode; params: {    // generated, rendered per document language
      reference?: string                                  // e.g. order number "SO-1234"
      effectiveDate: string                               // YYYY-MM-DD
    } }
type CreditReasonCode = 'subscription_amended' | 'subscription_cancelled' | 'subscription_superseded'
```

- Set on the item being **ended**, never on the new copy.
- It is overwritten when the item is ended again (the last change wins).
- A credit line built from the item copies the reason into `metadata.credit_reason` at bill time, so the reason is frozen with the posted document.

**Migration** `Migration20261122000000_billing_item_credit_reason.ts` (hand-written, package precedent): `alter table billing_items add column if not exists credit_reason jsonb null`.

No CPQ or connector tables change.

### Proposed Solution

**5a. Credit preview (billing, pure).** `lib/creditPreview.ts`:

```ts
previewCredit(item: { type, prorate, billedToDate, billStartDate, billEndDate }, newEndDate: Date)
  → { credited: false } | { credited: true; from: Date; to: Date; days: number }
```

- `credited` ⇔ `type === 'recurring'` and `prorate` and `billedToDate` is set and `newEndDate < billedToDate`.
- `from = max(newEndDate + 1, billStartDate)` and `to = billedToDate`. This is the same window the Spec A credit path computes.
- `computeRecurringLines` does not change. The preview only predicts what it will do.

**5b. UI (billing).**
- **`ChangeItemPriceDialog`:**
  - Always shows "Billed through `<date>`" (or "Not billed yet").
  - When the preview is credited, it shows a warning callout: "This item is billed through 14/12/2026. The next invoice credits 16/11–14/12 at the old price and charges the same days at the new price." It also shows a required **"Reason (shown on the invoice)"** textarea (max 500 characters, with a counter).
  - With `prorate` off and billed past the date, it shows only an info note: "Days already billed stay at the old price; the new price applies from the next full period."
- **Item form:** the same preview and reason field when the end date moves back on a recurring item.
- The reason field is not shown when nothing is credited.

**5c. API (billing).**
- `POST /api/billing/items/change-price` and `PUT /api/billing/items` accept `creditReason?: string` (operator text, trimmed, 1–500 characters). It is stored as `{ kind: 'text', text }`.
- Generated reasons arrive as `creditReasonCode` + `creditReasonParams` (connector). The two forms are mutually exclusive (400 if both are sent).
- When the change produces a credit (per `previewCredit`) and neither is given: **422 `billing.item.credit_reason_required`**.
- When it does not produce a credit, a sent reason is ignored and not stored.
- `openApi` describes all of this.

**5d. Engine + rendering (billing).**
- `buildRecurringLineDescriptors` adds `credit_reason` to `metadataExtra` for `kind === 'credit'` lines from `item.creditReason`.
- New pure `lib/creditReasonText.ts`: `creditReasonText(reason, translate, formatDate) → string`.
  - `text` is returned verbatim.
  - A `code` is rendered as `billing.credit_reason.<code>` with `{reference}` and `{date}`. For example, en: "Subscription amended (order {reference}), effective {date}"; es: "Suscripción modificada (pedido {reference}), con efecto {date}". Keys exist in en, es, de and pl.
- **PDF / email documents:** a muted second row under the credit line, "Reason: …", rendered with the **document translator**, so in the invoice language.
- **Admin invoice page:** the same text under the credit line, rendered in the operator's UI language.

**6a. Item date guard (billing).**
- `billingItemCreateSchema` / `UpdateSchema` superRefine, plus the update command checking the merged record: reject `billEndDate < billStartDate − 1 day` with **422 `billing.item.end_before_start`**.
- `end = start − 1` stays valid ("cancelled before start").
- The price-change path already guarantees this (`price_change_before_start`).
- `itemBillingState`: a new status `cancelled` when `end < start`, labelled "Cancelled before start" (neutral). It is checked before every other status except `inactive`.

**6b. Connector subscribers.**
- `cpq-subscription-{amended,cancelled,superseded}`: `endDate = max(effective − 1, item.billStartDate − 1)` per item, via pure `lib/arcEndDate.ts`.
- Every end-date write includes `creditReasonCode` (`subscription_amended` / `_cancelled` / `_superseded`) and `creditReasonParams { reference: <order number when known>, effectiveDate }`. Billing ignores the reason when the end date credits nothing.
- The subscriber never fails on 422 `end_before_start`, because the clamp prevents it.

**6c. Earliest activation date (connector).**
- **Rule** (pure `lib/earliestActivation.ts`): for an order whose quote is ARC `amend` or `cancel`:
  - the earliest activation date is the latest `billStartDate` among the **active, not-ended** billing items of its target subscriptions;
  - an item whose `billEndDate` is already before that date is ignored;
  - renewals and new-business orders get `null` (no constraint).
  - Items not yet started can't be amended mid-flight; once billing has started, any date works.
- **Read model:** extend the connector's order-setup GET with `earliestActivationDate: string | null` and `earliestActivationReason: { subscriptionId, itemDescription }`.
  - Target subscriptions are read through CPQ's API (the quote's target subscriptions).
  - Billing items are read through the billing API by `subscriptionId`.
  - FK-only reads, no ORM imports across packages.
- **Billing tab UI:** for ARC orders whose earliest date is after today, an amber callout at the top:
  > "This amendment can be activated from **20/11/2026**, when billing for this subscription starts. Activating earlier is blocked."

  Once that date is reached it shows nothing.
- **Guard:** connector `data/guards.ts` exports a `MutationGuard` on `targetEntity: 'cpq.order'`, `operations: ['update']`. For `payload.action === 'activate'` it computes the same rule. When today < earliest it returns 422 `{ error, code: 'cpq_billing_connector.activation_before_billing_start', earliestActivationDate }`. CPQ's existing error flash shows the message.
- **CPQ:** `api/orders/[orderId]/activate/route.ts` wires `runMutationGuards` (resourceKind `cpq.order`, operation `update`, payload `{ action: 'activate', orderId }`, `userFeatures`). It returns the guard's error body and status when blocked, and runs the after-success callbacks. This is generic: no billing knowledge.

### API Contracts (Part 2)

| Endpoint | Change |
|---|---|
| `POST /api/billing/items/change-price` (existing path) | `+ creditReason?: string`, `+ creditReasonCode?`, `+ creditReasonParams?`. 422 `billing.item.credit_reason_required` |
| `PUT /api/billing/items` | Same reason fields. 422 `billing.item.credit_reason_required`, 422 `billing.item.end_before_start` |
| `POST /api/billing/items` | 422 `billing.item.end_before_start` |
| `GET /api/billing/items` | `+ credit_reason` (jsonb, nullable) in list rows |
| `GET /api/billing/invoices/:id` | Credit lines' `metadata.credit_reason` (already passed through as metadata) |
| Connector `GET …/order-setups/:orderId` | `+ earliestActivationDate`, `+ earliestActivationReason` |
| CPQ `POST /api/cpq/orders/:orderId/activate` | May now return 422 from registered guards (body passed through). `openApi` documents it |

### Implementation Plan (Part 2)

**Phase 7: Billing item date guard + cancelled state**
1. Validators and update-command check for `end_before_start`. Tests: create/update, accept start − 1, reject start − 2.
2. The `itemBillingState` `cancelled` status, its i18n, and tests.

**Phase 8: Credit reason (billing)**
1. Entity field + migration. `creditReasonSchema`. `lib/creditPreview.ts` + tests (prorate on/off, not billed, end after billed-to, one-time item).
2. Commands (price change, update): store or require the reason. Command tests for the 422 and stored shapes.
3. Engine: copy into credit-line metadata. Engine test: an ended item's credit line carries the reason.
4. `lib/creditReasonText.ts` + tests (text verbatim; code rendered in es with params). PDF model row + admin invoice page. i18n keys in all four languages.
5. `ChangeItemPriceDialog` + item form: preview, warning, required reason, i18n.

**Phase 9: Connector**
1. `lib/arcEndDate.ts` clamp + reason codes in the amended / cancelled / superseded subscribers. Subscriber tests (not-yet-started item gets start − 1; started item gets effective − 1; reason sent).
2. `lib/earliestActivation.ts` + tests. Order-setup GET read model. Billing tab callout + i18n.
3. CPQ activate route: mutation-guard wiring (CPQ patch + test). Connector `data/guards.ts` + tests (blocked before the date, allowed on or after it, renewals untouched). Run `yarn generate`.
4. Integration: extend the ARC billing scenario so that activating before the billing start gives 422 with the date, and activating on the date succeeds.

**Phase 10: Changesets + docs**
- billing minor (`credit_reason`, `end_before_start`, cancelled state, migration note in `MIGRATION.md`);
- connector minor (guard, clamp, reasons);
- cpq patch (guard wiring);
- update `manuals/xd-250-arc-flow.md` with the activation constraint.

### Risks (Part 2)

| Risk | Severity | Mitigation |
|---|---|---|
| A required reason breaks API callers that end items inside the billed window | Medium | Only the connector does this today, and it sends generated reasons in the same release. The 422 names the field |
| The guard blocks a legitimate same-day test flow (the case that caused this) | Low | That is the intent. The Billing tab shows the date before the operator clicks Activate. Changing the bill start in order setup for the original order is the workaround |
| The guard reads two APIs on every activation | Low | Two bounded reads (target subscriptions, then that subscription's items), on the activation path only, and only for ARC amend / cancel orders |
| Rendering a code reason in a language whose dictionary lacks the key | Low | The document translator falls back to `en`. A dictionary-parity test covers the four languages |
| A credit reason gets attached to the wrong line when an item is ended twice before a run | Low | The last reason wins (documented). Both ends credit the same item, so one combined credit line carries it |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1: Service period on lines | Done | 2026-11-16 | Postpaid usage lines already stored the bill period, so only the UI changed. Shared `lib/linePeriod.ts` is used by the PDF and the admin page. `lib/dateOnly.formatDateOnly` formats in UTC |
| Phase 2: Payment back navigation | Done | 2026-11-16 | `paymentDetailHref` / `resolvePaymentReturnTarget` (same `?from=account&accountId=` contract as invoices). `PaymentsTable` adds it automatically when scoped to an account |
| Phase 3: Account billing pill | Done | 2026-11-16 | `lib/accountBillingState.ts` + `AccountBillingPill`, shown on the list (replaces Last bill) and in the workspace header. Kept the existing `Tag` primitive, so no separate pill component was needed |
| Phase 4: Schema, validators, cycle math | Done | 2026-11-16 | `lib/billCycle.ts` is the single definition of a cycle. `billPeriod.ts` takes `CycleInput` (a bare unit still means unpinned × 1). Migration is hand-written (package precedent: `db generate` only diffs `@app`). No backfill and no alias (reseed) |
| Phase 5: Engines, commands, API | Done | 2026-11-16 | `lib/accountCycle.ts` (create / realign rules, pure). Both engines pass the account spec and start arrears at `last_bill_date + 1`. Update errors return 400 `billing.account.invalid_bill_cycle` |
| Phase 6: UI + connector | Done | 2026-11-16 | `BillCycleFields` (Every N unit on day, live next-bill preview, manual override) and `useBillCycleSummary`. Connector and integration specs updated (see the connector changeset) |
| Phase 7: Item date guard | Done | 2026-11-16 | `lib/itemDates.ts`, checked in the create, bulk and update commands (422 rather than a Zod error, so the code is stable). `itemBillingState` gains `cancelled` |
| Phase 8: Credit reason (billing) | Done | 2026-11-16 | `lib/creditReason.ts` (schema, text rendering), `lib/creditPreview.ts`, `credit_reason` jsonb + `Migration20261122000000`. Commands require or store the reason. Credit lines carry `metadata.credit_reason`. Shown on the PDF (document language) and the invoice page (`InvoiceLineExtras`). `CreditReasonField` is shared by the price-change dialog and the item form. The prepaid ledger has no invoice lines, so prepaid credits carry no reason (out of scope) |
| Phase 9: Connector (clamp, reasons, earliest activation, guard) | Done (steps 1–3) | 2026-11-16 | `lib/arcEndDate.ts`, `lib/orderReference.ts`, `lib/earliestActivation.ts`, `data/guards.ts`, `EarliestActivationNotice`. CPQ activate route runs mutation guards and now exports `openApi`. The guard **fails open** when the order or billing cannot be read (the end-date clamp is the safety net). End dates are never moved later. Step 4 (Playwright scenario) **not written** |
| Phase 10: Changesets + docs | Done | 2026-11-16 | Billing minor, connector minor (peer `@dainamite/cpq ^0.7.1`), cpq patch. `MIGRATION.md` and the `xd-250-arc-flow` manual updated |
| PR review follow-ups | Done | 2026-11-16 | `/status → active` runs the activation guards (closes the bypass). The migration pins `bill_cycle_day` to `next_bill_date`. A stale credit reason is cleared. The guard message is translated. CPQ changeset → minor. Billing stays **minor** by owner decision, despite the API breaks |
