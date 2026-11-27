# Run plan — billing line period & status, price phases, CPQ manual pricing flexibility

**Date**: 2026-11-26
**Specs**:
- `.ai/specs/2026-11-26-cpq-manual-pricing-flexibility.md` (spec **F**)
- `.ai/specs/2026-11-26-billing-line-period-and-status.md` (spec **L**)
- `.ai/specs/2026-11-26-billing-price-phases-ramp-deals.md` (spec **P**)

Walix questions (W1–W8) are open in the specs. This run implements the **proposed
defaults** stated in the specs (free phase prints a 0.00 line; "first 3 months" =
calendar months from start; a pause does not extend a phase; paused = no charge;
suspended = charge unless "no charge"; grace = flag only; all line periods offered).

## Work split

| Task | Scope (disjoint) | Wave | Depends on |
|---|---|---|---|
| T1 CPQ manual pricing (spec F, all) | `packages/cpq` pricing adjustments, quote price dialog, adjustment AI tools, F docs | 1 | — |
| T2 Billing engine + items (spec L Phases 1–2, spec P Phase 1) | `packages/billing` only | 1 | — |
| T3 CPQ line period + status (spec L Phase 3 CPQ side) | `packages/cpq` catalog charges, order/subscription carry, inventory status actions, events | 1 | — |
| T4 CPQ phases (spec P Phase 2) | `packages/cpq` price adjustments month ranges, price rules, quote phases UI, payload phases | 2 | T1, T3 |
| T5 Connector (spec L Phase 3 + spec P Phase 3) | `packages/cpq-billing-connector` | 2 | T2, T3, T4 |

## Contract C1 — billing item API / commands (T2 builds, T5 consumes)

Billing item create / update / bulk create (REST + the `billing.items.*` commands the
connector calls through the command bus) accept, additively:

```ts
// Own billing period (spec L §4.2). null/omitted = follow the account cycle (today).
billingPeriodUnit?: 'daily' | 'weekly' | 'monthly' | 'annually' | null
billingPeriodInterval?: number | null          // >= 1, required with a unit

// Price phases (spec P §4.1). Recurring items only. Max 12. Back to back from bill_start_date.
phasesEnabled?: boolean                         // the switch; false = phases ignored
phases?: Array<{
  name?: string | null
  // exactly one of (durationUnit + durationCount) or endDate
  durationUnit?: 'day' | 'week' | 'month' | 'year'
  durationCount?: number                        // >= 1
  endDate?: string                              // 'YYYY-MM-DD', inclusive last day
  priceType: 'free' | 'fixed' | 'percent_off' | 'amount_off'
  value?: number | null                         // fixed: price per item period; percent_off: 0–100; amount_off: per period
}>
```

Item reads return `billingPeriodUnit`, `billingPeriodInterval`, `phasesEnabled`,
`phases[]` (with `id`, `sequence`, computed `startDate` / `endDate`), and
`statusPeriods[]`.

Line status (spec L §4.3): entity `BillingItemStatusPeriod`, commands
`billing.items.status_periods.create | update | delete` (undoable), REST under
`/api/billing/items/status-periods`, and an account bulk action. Create payload:

```ts
{ billingItemId: string, status: 'paused' | 'suspended' | 'grace',
  fromDate: 'YYYY-MM-DD', toDate?: 'YYYY-MM-DD' | null,
  chargeBehavior?: 'charge' | 'no_charge',  // default: paused → no_charge, suspended/grace → charge
  reason?: string | null }
```
Update can set `toDate` (resume = set the end of the open period). Periods on one item
never overlap (validation error). A billing item with a `subscriptionId` refuses
status writes from REST/UI unless the call comes from the connector (system ctx,
`auth: null`) — D6: CPQ owns CPQ lines' status; billing shows it read-only.

## Contract C2 — CPQ event payloads (T3/T4 emit, T5 consumes)

Activation (`cpq.subscription.activated`) and ARC `addedItems` keep
`items[].charges[]`. The recurring charge gains, additively:

```ts
{ type: 'recurring', unitPrice: number, description: string,
  // T3: price per period; absent = every 1 month (today)
  billingPeriod?: { unit: 'month' | 'year', interval: number },
  // T4: merged item schedule, back to back from the item start, in months
  phases?: Array<{ name: string | null, months: number, priceType: 'fixed', value: number }> }
```

- A subscription item whose MRC charges have different billing periods emits **one
  recurring charge per period** (`unitPrice` = sum of that period's charges, per period).
- `phases[].value` is the price per that charge's billing period (same unit as `unitPrice`);
  `unitPrice` is the regular price after the last phase.

New CPQ events (declared in `cpq/events.ts`, emitted after commit):

```ts
// T3 — pause / suspend / grace / resume, whole subscription or one item
'cpq.subscription_item.status_changed': {
  tenantId, organizationId, subscriptionId,
  subscriptionItemIds: string[],      // every affected item (subscription-wide lists all)
  status: 'paused' | 'suspended' | 'grace' | 'active',   // 'active' = resume
  fromDate: 'YYYY-MM-DD',             // resume: the first day running again
  toDate: 'YYYY-MM-DD' | null,
  chargeBehavior?: 'charge' | 'no_charge',
  reason?: string | null }

// T3 — terminate from inventory (closes the §3 gap)
'cpq.subscription.terminated': {
  tenantId, organizationId, subscriptionId,
  subscriptionItemIds: string[], effectiveDate: 'YYYY-MM-DD', reason?: string | null }
```

## Contract C3 — connector mapping (T5)

- Recurring charge `billingPeriod` absent or `{month,1}` → billing item period null
  (follow account, unchanged behaviour); otherwise `{month,N}` → `monthly`/N,
  `{year,N}` → `annually`/N.
- `sourceRef`: unchanged `cpq-<sub>-<item>-recurring` for the 1-month charge; other
  periods append `-<interval><m|y>` (e.g. `…-recurring-1y`).
- `phases[]` → billing phases with `durationUnit: 'month'`, `durationCount: months`,
  `priceType: 'fixed'`, `phasesEnabled: true`, in the same create write.
- `status_changed` → create a status period (or, for `active`, set `toDate = fromDate − 1`
  on the open period). `terminated` → `billEndDate = effectiveDate` like cancel.

## As built — deviations recorded after merge

- **T1 (merged)**: no AI tool writes price adjustments (deliberate, `manuals/cpq-ai-agent.md`); openApi enriched only. Line Set price / Amount off amounts are line totals over all quantities; phases reuse `applyLineSpread`.
- **T3 (merged)**: terminate emits only `cpq.subscription.terminated` (never `status_changed`). ARC `changedItems` (modify / re-rate) are split per billing period too, with `billingPeriod` on non-monthly charges — the C3 `sourceRef` suffix rule applies to `changedItems` as well as `addedItems`. CPQ status writes go through `cpqInventoryService.applyStatusAction` (no command bus in CPQ inventory, so no undo). A subscription-wide resume also resumes items paused on their own. `billingPeriod` is omitted for `{month,1}`.
- **T4 (merged)**: `charges[].phases` rides on activation, ARC `addedItems` **and** `changedItems` recurring charges (shared `buildRecurringPayloadCharges` → `lib/payloadPhases.ts` `mergeRecurringPhases`). `value` is per the charge's billing period, `unitPrice` is the regular price. A merged multi-charge schedule can exceed billing's 12-phase cap (CPQ caps only editor steps at 12) — the connector must not silently drop phases. The Phases editor saves steps as sequential undoable commands (not one atomic write).
- **T2 (merged)**: item reads keep snake_case columns plus camelCase aliases; `phases[].endDate` on read = computed end, the stored until-date is `untilDate`. `phasesEnabled` defaults to true when phases are sent. CPQ item status is written via `billing.items.status_periods.*` with `ctx.auth = null` (D6); resume = update `toDate` of the open period; overlap → 422 `billing.item.status_period_overlap`. A weekly line on a monthly account billed in advance bills 5 weeks on 1 Dec (D3 literal); the spec's "4 weeks 1–28 Dec" example holds in arrears.
