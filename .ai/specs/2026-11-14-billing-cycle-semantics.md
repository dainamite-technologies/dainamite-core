# Billing — Cycle Semantics: In-Advance Charging, Proration, Always-Catch-Up (Spec A)

**Date**: 2026-11-14
**Status**: Draft. Decisions agreed, ready for implementation planning review.
**Owner**: Mac
**Target**: `@dainamite/billing` (minor bump → 0.21.0), `@dainamite/cpq-billing-connector`
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md) (WS-1, decisions D1–D3, D8, D11, D14)

> **Amended by [Spec 0](2026-11-14-billing-standalone-invoice-ledger.md):** the engine writes billing-owned `billing_invoices`. "Invoice metadata" keys below become real columns, and the `bill_date` dedupe becomes a DB unique index.

---

## TLDR

Make the Bill Run bill what an operator expects:

1. **Per-item charge timing.** A `recurring` item is billed `in_advance` (default) or `in_arrears`.
2. **Per-item proration** (`prorate`, default `true`). Partial periods at an item's start or end are charged pro rata by calendar days, instead of being silently skipped. Ending an already-prepaid item produces a **credit line**.
3. **Always catch up.** Every run (manual or scheduled, real/test/dry) emits **one invoice per due bill date** up to `asOfDate`. The `catchUp` flag is removed.
4. **Test and dry runs simulate every cycle** in memory, so a test run as of 2027-02-01 for a Nov 14 subscription shows all three invoices.
5. Proration moves **into the engine**. The CPQ connector stops posting its own `one_time` proration lines.

---

## Design Decisions

| # | Decision |
|---|---|
| A-D1 | **Prepaid keeps today's behaviour in this spec.** Period close stays in arrears and full-cycle only, and ignores `charge_timing`/`prorate`. Only the `catchUp` gate is removed. **Known follow-up:** prepaid accounts commonly use in-advance items (debit the fee at the start of the period). The fields are stored on prepaid items now, and the ItemForm shows the hint "Prepaid accounts currently charge recurring items at period end". Honouring them in prepaid close is a separate spec (touches statement math). |
| A-D2 | Ending an already-billed in-advance item with `prorate=true` produces an automatic **negative credit line** for the unused days on the next invoice. The cancellation *policy* (for example "cancel at end of current period, no refund") belongs to CPQ / the connector: they set `bill_end_date` to the period end, and then no credit line arises. The engine just honours `bill_end_date`. |
| A-D3 | Catch-up emits **one invoice per bill date**. Periods are never combined. |

---

## Problem Statement

Verified against `lib/billRunEngine.ts`, `lib/itemSelector.ts`, `lib/billPeriod.ts` (v0.20.0):

| Today | Effect |
|---|---|
| Billing is in arrears only: period = `[next_bill_date − cycle, next_bill_date − 1]` | A flat monthly fee is charged after the month is consumed. ISPs and SaaS usually bill in advance. |
| Catch-up only with `mode=real` + `manual` + `catchUp=true`. The UI never sends the flag. | An account months behind needs N separate runs. |
| Test and dry modes `break` after 1 cycle | A test run "as of next February" shows 1 invoice and misleads the operator. |
| A recurring item that starts or ends mid-cycle is **skipped** for that period | Silent revenue leakage. The selector's skip reason is discarded. |
| The connector posts `one_time` proration lines on CPQ amend | Proration logic lives outside billing, and only covers the start. |
| The connector creates accounts with `next_bill_date = activation + 1 month` | With in-advance billing, the first period would be missed. |

---

## Proposed Solution

### Core model: bill date and service periods

- The account keeps a single **bill date** `D = next_bill_date` and `bill_cycle`. The account's cycle grid is `…, D − cycle, D, D + cycle, …`.
- On bill date `D`, each recurring item is billed up to its **horizon**:
  - `in_advance` → horizon = `D + cycle − 1`
  - `in_arrears` → horizon = `D − 1`
- **Item charge cursor** = `billed_to_date + 1`, or `bill_start_date` if never billed.
- The item's unbilled window `[cursor, min(horizon, bill_end_date)]` is cut along the **account cycle grid** into service periods. Each service period becomes **one invoice line**:
  - full grid period → `unit_price × 1`
  - partial period (the item starts or ends inside it) → `unit_price × active_days / days_in_period`, half-up to 2 dp, description suffix `(prorated 17/30 days)`
  - partial with `prorate=false` → skipped, with the reason recorded (today's behaviour)
- After a real write: `billed_to_date = last emitted period end`.
- **Credit for ended prepaid periods** (A-D2): if `bill_end_date < billed_to_date` and `prorate=true`, emit a negative line for `[bill_end_date + 1, billed_to_date]` (prorated against its grid period), then set `billed_to_date = bill_end_date`.
- `one_time`: unchanged (first bill date whose `[D − cycle, D + cycle − 1]` window overlaps the item's window and it has not been billed yet).
- `usage`: unchanged, always in arrears `[D − cycle, D − 1]`.

The same function handles backdated items, a second subscription added mid-cycle, amendments, and cancellations. The connector no longer needs to know about proration.

### Worked examples

| Case | Account `D` | Item | Lines on invoice at D |
|---|---|---|---|
| Your test | 2026-11-14 | monthly 100, in advance, start 11-14 | Nov 14–Dec 13 → 100 |
| …catch-up to 2027-02-01 | Dec 14, Jan 14 | same | 3 invoices: Nov 14–Dec 13, Dec 14–Jan 13, Jan 14–Feb 13 |
| Mid-cycle add | 2026-12-01 | 100, in advance, start 11-14 | Nov 14–30 → 56.67 (17/30) + Dec 1–31 → 100 |
| In arrears | 2026-12-01 | 100, in arrears, start 11-01 | Nov 1–30 → 100 |
| Cancel after prepay (A-D2) | 2027-01-01 | 100, in advance, billed to 12-31, end 12-15 | Dec 16–31 → −51.61 (16/31) |

### Bill run loop (all modes, all triggers)

```
for account in accounts where next_bill_date <= asOfDate:
  state = { D: account.nextBillDate, watermark: Map(itemId → billedToDate) }   // in-memory for test/dry
  while state.D <= asOfDate and cycles < CATCH_UP_HARD_CAP (60):
    lines = recurringLines(items, state) + oneTimeLines + usageLines(D − cycle .. D − 1)
    if lines empty → advance state; continue
    real  → write draft, persist watermarks + next_bill_date + usage marks
    test  → write TEST- draft, update in-memory state only
    dry   → record preview only, update in-memory state only
    record cycle preview in outcome.cycles[]
    state.D += cycle
```

- Removes `SCHEDULED_CYCLE_LIMIT` and the `break` for test/dry.
- **Usage in test/dry:** each simulated period rates only usage within its own window, so nothing is double-counted. No usage records are marked.
- **Dedupe key** for the open-draft guard changes from `(bill_period_start, bill_period_end)` to `(bill_account_id, bill_date, test_run)`. Test drafts never block real drafts and vice versa.
- **Prepaid** (A-D1): `processPrepaidAccount` loses its `catchUp` gate (D11 applies) but keeps today's in-arrears, full-cycle selection.

### Invoice metadata

| Key | Level | Change |
|---|---|---|
| `bill_date` | invoice | **new**. The dedupe key. |
| `bill_period_start` / `bill_period_end` | invoice | kept = min/max of the line service periods (for display) |
| `service_period_start` / `service_period_end` | line | **new** |
| `charge_timing`, `proration` `{ active_days, period_days }` | line | **new**, recurring only |
| `credit_for` | line | **new**. Set on negative credit lines. |

### CPQ connector changes

- `cpq-subscription-activated`: default `next_bill_date` = subscription start date (the payload's `startDate`, or the activation date). Items take `charge_timing` from the CPQ charge where present (CPQ charge model mapping, otherwise the default `in_advance`).
- `cpq-subscription-amended`: **stop posting `one_time` proration lines**. Just create the item with `bill_start_date = effectiveDate` and end-date removed items. The engine prorates.
- Remove `cycleContaining` import from billing internals (resolves the `TODO(L2-boundary)`).

### UI

- `ItemForm` (recurring): **Charge timing** select, **Prorate partial periods** switch.
- Bill Run trigger dialog: remove nothing (the UI never sent `catchUp`). Add help text: "Bills every due cycle up to the as-of date."
- Run detail: remove the "Catch-up" tag. Per-account outcome shows **cycles** (bill date, service span, line count, net total, invoice link / "preview") and **skipped items** with reasons.

---

## Data Models

### BillingItem (changed)
| Column | Type | Notes |
|---|---|---|
| `charge_timing` | text, not null, default `'in_advance'` | `in_advance \| in_arrears`. Only meaningful for `type=recurring`. |
| `prorate` | boolean, not null, default `true` | recurring only |

### BillingRunOutcome (changed)
| Column | Type | Notes |
|---|---|---|
| `cycles` | jsonb, nullable | `[{ bill_date, period_start, period_end, line_count, total_net, invoice_id \| null }]` |
| `warnings.skipped_items` | (in existing jsonb) | `[{ item_id, reason, service_period }]` |

### BillingRun (changed)
- `catch_up` column dropped (D14: reseed everything, no compatibility needed).

Migration generated via `yarn mercato db generate` in `packages/billing`.

---

## API Contracts

| Endpoint | Change |
|---|---|
| `POST /api/billing/runs` | `catchUp` removed from the schema. The request schema is `.strip()` so old clients don't 400. OpenAPI description updated: "bills every due cycle up to asOfDate". |
| `GET /api/billing/runs`, `/runs/{id}` | `catch_up` removed from response. Outcomes include `cycles`. |
| `POST /api/billing/runs/retry-failed` | No longer inherits `catchUp`. |
| `POST/PUT /api/billing/items` | Accept `chargeTiming`, `prorate`. Rejected (400) on non-recurring types when set to non-defaults. |
| `GET /api/billing/items` | Returns `charge_timing`, `prorate`. |

Breaking changes are noted in `packages/billing/CHANGELOG.md` (0.21.0).

---

## Implementation Plan

### Phase 1: Pure period math (no DB)
1. `lib/servicePeriods.ts`: `computeRecurringLines(item, D, cycle) → { lines, newWatermark, skipped }`. Grid slicing, proration, credit lines. Pure.
2. Unit tests: every row of the worked-examples table, month-end clamping (Jan 31), leap year, weekly/quarterly/annual, `prorate=false`, switching timing never double-bills, backdated item spanning 3 cycles.

### Phase 2: Entity + validators
1. Add `chargeTiming`, `prorate` to `BillingItem`. Add `cycles` to `BillingRunOutcome`. Drop `catchUp` from `BillingRun`. Run `yarn mercato db generate`.
2. Zod: item schemas, run trigger schema without `catchUp`. Validator tests.

### Phase 3: Engine
1. Rewrite the `processAccount` loop over in-memory state (real/test/dry share the code path, only the persistence differs).
2. Use `servicePeriods` for recurring. Keep `itemSelector` for `one_time` only.
3. New dedupe key `bill_date`. Invoice/line metadata as above.
4. Prepaid: remove the `catchUp` gate only.
5. Engine unit tests (mock EM): 3-cycle real catch-up, 3-cycle test, 3-cycle dry (nothing persisted), scheduled = catch-up, rerun idempotency.

### Phase 4: Connector + seeds
1. Connector: start-date `next_bill_date`, drop proration posting and the `cycleContaining` import. Update connector tests.
2. Demo seeds (`lib/seeds/demo.ts`, demo tenant seeds): align `next_bill_date` with item start dates, and include one `in_arrears` item and one mid-cycle add so the demo shows proration.

### Phase 5: UI + docs
1. ItemForm fields, run detail cycles / skipped table, removal of the catch-up tag, i18n en/pl.
2. Update `manuals/billing-ui-testing.md`, `manuals/cpq-billing-end-to-end.md`, package README, CHANGELOG.
3. Integration test: trigger a test run 3 months ahead → 3 TEST drafts visible.

---

## Risks

| Risk | Mitigation |
|---|---|
| Double billing when an item's timing changes after billing | The watermark is the single source of truth. Line emission always starts at `billed_to_date + 1`. Dedicated unit test. |
| Runaway catch-up (bad `next_bill_date` far in the past) | `CATCH_UP_HARD_CAP = 60` per account, and the outcome warns when it's hit. |
| Large test-mode runs create many TEST drafts | Existing wipe endpoint. Dry mode for previews. |
| Proration rounding drift (sum of prorated parts ≠ full price) | Accept per-line half-up rounding (industry norm), and document it. |
| Connector/billing version skew (old connector still posts proration lines) | Both packages ship together. Connector's peer range bumped to `^0.21.0`. |

---

## Changelog
- 2026-11-14 — Draft created from umbrella decisions D1–D3, D8, D11, D14.
- 2026-11-14 — A-Q1..A-Q3 resolved → A-D1..A-D3. Prepaid in-advance recorded as a follow-up.
- 2026-11-14 — Amended by Spec 0 (billing-owned invoice ledger).
- 2026-11-14 — Execution plan: `.ai/runs/2026-11-14-billing-cycle-semantics/PLAN.md`. Runs **before** Spec 0 at the user's request; storage-specific code is isolated in the writer + dedupe helper. Prepaid test/dry stay single-cycle (A-D1).
