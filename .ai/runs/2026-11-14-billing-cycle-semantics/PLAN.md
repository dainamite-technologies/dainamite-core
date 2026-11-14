# Execution plan — Billing cycle semantics: in-advance charging, proration, always catch up (Spec A)

Source spec: .ai/specs/2026-11-14-billing-cycle-semantics.md (decisions A-D1..A-D3, umbrella D1–D3, D8, D11, D14)
Base branch: feat/billing-account-workspace (Spec E Phase 1)
Branch: feat/billing-cycle-semantics
Packages: `@dainamite/billing`, `@dainamite/cpq-billing-connector`

## Sequencing note (read first)

The agreed build order was **Spec 0 (standalone invoice ledger) → Spec A**. This plan runs **A before 0**, at the user's request. To keep the later Spec 0 rework small:

- All period/charge logic lives in **pure, storage-agnostic modules** (`lib/servicePeriods.ts`, `lib/cycleSimulator.ts`). Spec 0 does not touch them.
- Everything invoice-storage-specific stays inside `invoiceWriter.ts` and one dedupe helper. Today it writes `sales_invoices` + `metadata` keys (`bill_date`, line `service_period_*`). Spec 0 turns those keys into columns on `billing_invoices` and the dedupe into a unique index. **Expected rework in Spec 0: the writer + the dedupe helper only.**

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | `lib/servicePeriods.ts`: recurring line computation (pure) | todo |
| 1 | 1.2 | Unit tests: worked examples + edge cases | todo |
| 2 | 2.1 | Entity + hand-written migration (`charge_timing`, `prorate`, outcome `cycles`, drop `catch_up`) | todo |
| 2 | 2.2 | Validators + item commands/routes (create, update, bulk) + OpenAPI | todo |
| 2 | 2.3 | Remove `catchUp` from run validator, command, retry, routes | todo |
| 3 | 3.1 | Engine loop rewrite over in-memory cycle state (real / test / dry) | todo |
| 3 | 3.2 | Writer: bill-date metadata, service periods, proration/credit lines | todo |
| 3 | 3.3 | Dedupe by `bill_date` + `test_run`; outcome `cycles` + summary | todo |
| 3 | 3.4 | Prepaid: drop the `catchUp` gate only (A-D1) | todo |
| 3 | 3.5 | Engine + prepaid tests | todo |
| 4 | 4.1 | Connector: `next_bill_date` = start date; stop posting proration lines | todo |
| 4 | 4.2 | Demo seeds: in-advance items, one in-arrears, one mid-cycle add | todo |
| 5 | 5.1 | UI: ItemForm / item detail / items list fields | todo |
| 5 | 5.2 | UI: run trigger help, run detail cycles + skipped items, remove catch-up tag | todo |
| 5 | 5.3 | i18n, integration test TC-BILL-005, manuals, MIGRATION.md, changeset, gate | todo |

## Goal

A bill run bills what an operator expects:
- every due bill date up to `asOfDate` → one invoice each (all modes, all triggers);
- recurring items in advance (default) or in arrears;
- partial periods prorated (default);
- an item ended after it was billed in advance gets a credit line.

The operator's scenario becomes true: a monthly item from 2026-11-14 with `next_bill_date = 2026-11-14`, test run as of 2027-02-01 → **3 drafts** (Nov 14–Dec 13, Dec 14–Jan 13, Jan 14–Feb 13).

## Non-goals

- Prepaid honouring `charge_timing`/`prorate` (A-D1, a follow-up spec). Prepaid test/dry stay single-cycle.
- Moving invoices off `sales_invoices` (Spec 0). VAT (Spec B).
- "Run billing" button on the account (Spec E Phase 2).
- Applying migrations without confirmation.

---

## Step details

### 1.1 `lib/servicePeriods.ts` (pure, no EM)

```ts
type RecurringLine = {
  billingItemId: string
  servicePeriodStart: Date; servicePeriodEnd: Date   // inclusive
  amount: number                                     // 2dp half-up; negative for credit
  kind: 'charge' | 'credit'
  proration: { activeDays: number; periodDays: number } | null
}
computeRecurringLines(item, { billDate, cycle }) → {
  lines: RecurringLine[]
  newBilledToDate: Date | null      // watermark after these lines
  skipped: Array<{ reason: string; servicePeriodStart: Date; servicePeriodEnd: Date }>
}
```

- **Horizon:** `in_advance` → `billDate + cycle − 1 day`. `in_arrears` → `billDate − 1 day`.
- **Cursor:** `billedToDate + 1`, or `billStartDate` if never billed.
- **Window:** `[cursor, min(horizon, billEndDate)]`.
- **Grid slicing:** the window is cut along the account grid anchored at `billDate` (reuse `cycleContaining` / `addCycle` from `billPeriod.ts`, exporting `subtractCycle`/`addCycle` if needed). Each grid period clipped to the item's `[billStartDate, billEndDate]` becomes one line:
  - full → `unit_price`
  - partial + `prorate` → `unit_price × activeDays / periodDays`
  - partial + `!prorate` → skipped with reason `partial-period-not-prorated`. The watermark still advances past it, so it is never retried.
- **Credit (A-D2):** `billEndDate < billedToDate` and `prorate` → one credit line per grid period in `[billEndDate + 1, billedToDate]`, negative and prorated against its grid period. Watermark := `billEndDate`. Without `prorate`, record a skip reason `ended-after-billing-no-credit`.
- **Inactive / soft-deleted items:** no lines (same as today).
- **Safety:** cap the number of grid periods per item per call (e.g. 120) and return a skip reason when it's hit.
- **Rounding:** reuse `roundHalfUp2dp` (lift it into `lib/money.ts` if it isn't exported).

### 1.2 Tests `__tests__/lib/servicePeriods.test.ts`
- Every row of the spec's worked-examples table, including the exact amounts (56.67, −51.61).
- Month-end clamping (start Jan 31, monthly), leap February, weekly / quarterly / annually grids.
- `prorate=false` partial start and end. Backdated item spanning 3 grid periods. Item ending exactly at the grid boundary (no proration).
- **No double billing on timing switch:** bill in arrears for cycle N, flip to in advance, compute for N+1 → periods are contiguous, with no overlap and no gap.
- Idempotence: feeding `newBilledToDate` back in for the same bill date yields no lines.

### 2.1 Entity + migration
- `BillingItem`: `chargeTiming: 'in_advance' | 'in_arrears'` (column `charge_timing text not null default 'in_advance'`), `prorate: boolean` (`prorate boolean not null default true`). Both added to `OptionalProps`.
- `BillingRunOutcome`: `cycles jsonb null`.
- `BillingRun`: remove `catchUp`. The migration **drops** `billing_runs.catch_up` (D14: reseed, no compatibility).
- `Migration20261114100000_billing_cycle_semantics.ts`, hand-written (the generator skips package modules, as in Spec E Phase 1), with an `up` and a `down`.
- Regenerate `packages/billing/generated` (`node scripts/generate-entity-registry.mjs`).

### 2.2 Validators + item commands/routes
- `CHARGE_TIMINGS = ['in_advance','in_arrears']`.
- `billingItemCreateSchema` / bulk entry: `chargeTiming` (default `in_advance`) and `prorate` (default `true`). A `superRefine` rejects a non-default value on `one_time` / `usage` items (400, `billing.item.charge_timing_recurring_only`).
- `billingItemUpdateSchema`: both optional. Changing them after billing is allowed (the watermark protects against double billing).
- `commands/items.ts` (create, update, bulk): persist both.
- `api/items/route.ts`: list `fields`, response schema, OpenAPI descriptions. Bulk route OpenAPI.
- Validator tests.

### 2.3 Remove `catchUp`
- `billingRunTriggerSchema`: drop `catchUp`. Zod's default object stripping makes old clients sending it harmless (pinned by a test).
- `commands/runs.ts`: drop it from trigger and retry-failed. `api/runs/route.ts`: drop `catch_up` from `fields` and the response schema. Update the OpenAPI text: "Bills every due cycle up to `asOfDate` (all triggers)". `api/runs/retry-failed/route.ts` description.
- Delete `SCHEDULED_CYCLE_LIMIT` in both engines.

### 3.1 Engine loop (`lib/billRunEngine.ts` → extract `lib/cycleSimulator.ts`)
- `processAccount` builds an in-memory state `{ billDate: account.nextBillDate, watermarks: Map<itemId, Date|null> }` and loads the items **once** per account (today it reloads every cycle).
- `while (billDate <= asOfDate && cycles < CATCH_UP_HARD_CAP)`. For each bill date:
  1. **Dedupe** (3.3). Real + existing draft → stop the account with `skipped_existing_draft` (today's semantics: state is inconsistent, so don't advance). Test + existing test draft → record the cycle as `skipped`, advance in memory, continue.
  2. Recurring lines via `computeRecurringLines` against in-memory watermarks.
  3. `one_time`: eligible if not billed and its window overlaps `[billDate − cycle, billDate + cycle − 1]`. Selector reused for `one_time` only. Mark billed in memory.
  4. Usage: `processUsageForAccount(em, account, arrearsPeriod, usageItems)` with `arrearsPeriod = [billDate − cycle, billDate − 1]` (unchanged contract).
  5. Lines empty → record the cycle as `empty`, advance (real persists the date advance, as today).
  6. Write the draft (real / test) or record a preview (dry).
  7. Real → persist watermarks (`billedToDate`), mark usage (existing bulk `nativeUpdate`), `nextBillDate`, `lastBillDate`. Flush per cycle (each cycle is atomic inside the per-account savepoint).
  8. Advance `billDate` in memory.
- When the hard cap is hit, add the warning `catch_up_cap_reached`.
- `itemSelector.ts`: the `recurring` branch is deleted (servicePeriods owns it). `one_time` stays. Update its tests.

### 3.2 Writer (`lib/invoiceWriter.ts`)
- `WriteInvoiceParams.period` → `{ billDate, periodStart, periodEnd }`, where periodStart/End = min/max of the line service periods (display only).
- Invoice metadata: + `bill_date`. Keep `bill_period_start/end` (= min/max).
- `InvoiceLineDescriptor`: + `servicePeriodStart/End`, `chargeTiming`, `proration`, `creditFor?`. Line metadata gets the same keys.
- `buildRecurringLineDescriptors(lines, item)`:
  - description = `item.description`, plus ` · YYYY-MM-DD – YYYY-MM-DD` when the period is partial or is a credit (language-neutral; Spec B's PDF renders the period and labels properly).
  - Credit lines carry a negative `unitPriceNet` / `totalNetAmount` with quantity `1`.
- A negative-total draft is allowed (credits exceed charges). Warning `negative_total`.

### 3.3 Dedupe, outcome cycles, summary
- `findExistingDraftForPeriod` → `findExistingDraftForBillDate(em, account, billDate, testRun)`, matching `metadata->>'bill_date'` and `coalesce(metadata->>'test_run','false')`. Test drafts never block real drafts, and vice versa. *(Spec 0 replaces this with a unique index.)*
- `BillingRunOutcome.cycles`: `[{ bill_date, period_start, period_end, status: 'invoiced'|'previewed'|'empty'|'skipped_existing', line_count, total_net, invoice_id }]`. `draft_invoice_id` = the last invoice (backward compatible).
- `warnings.skipped_items`: `[{ item_id, reason, service_period_start, service_period_end }]`, capped at 200 entries per outcome.
- `buildRunSummary`: `drafts_created` = Σ invoiced cycles. + `cycles_processed`.

### 3.4 Prepaid (A-D1)
`processPrepaidAccount`: `maxCycles = CATCH_UP_HARD_CAP` for real runs on every trigger. Test/dry keep their single iteration, and the statement math is untouched. Remove the `catchUp` param. Update `prepaidPeriodClose.test.ts` (scheduled real run → multiple statements).

### 3.5 Engine tests (`billRunEngine.test.ts`, mock EM)
- The operator scenario: real / test / dry each → 3 cycles. Real persists 3 drafts + `nextBillDate = 2027-02-14`. Test → 3 TEST drafts, account untouched. Dry → 3 previews, nothing persisted.
- Scheduled trigger catches up (no 1-cycle cap).
- Rerun the real run → no new drafts (watermark + `nextBillDate`). Rerun test → cycles `skipped_existing`.
- Mixed account: in-advance item + in-arrears item + usage on one invoice with the correct service periods.
- Mid-cycle add → stub + full line. End after advance billing → credit line on the next bill date.
- Hard cap → warning. Existing usage, currency-mismatch and summary tests kept and adapted.

### 4.1 Connector
- `cpq-subscription-activated`: default `nextBillDate` = `payload.nextBillDate ?? activationDate ?? today` (was today + 1 month). This only applies on **account creation**. An existing account keeps its date, and a new subscription on it is prorated by the engine.
- `cpq-subscription-amended`: delete the proration block (step 2), and drop the `cycleContaining` / `prorationHelper` imports. This resolves the `TODO(L2-boundary)`. Added items just start on `effectiveDate`, and the engine prorates the stub.
- `lib/prorationHelper.ts` + its test: delete (no remaining callers. Verify with grep).
- Update the subscriber docblocks:
  - cancelled / superseded: an end date inside an advance-billed period now yields an engine credit line when `prorate`. The "end at period end, no refund" policy belongs to CPQ (A-D2).
- Tests: `buildAccountSeed` default date. Amended no longer emits `one_time` proration payloads (extract the payload builder into a pure function to test it).

### 4.2 Demo seeds
- `lib/seeds/demo.ts`:
  - recurring items start on `nextBillDate` (1st of this month, in advance → the first run bills this month);
  - Globex gets one **in-arrears** item;
  - Northwind gets one **mid-cycle add** (start on the 15th of the previous month) to show proration;
  - usage unchanged (previous month, arrears).
  - Update `seedsDemo.test.ts`.
- `scripts/seed-demo.mjs`: same intent (one in-arrears item, one mid-cycle). Its "1 Bill Run → 3 drafts" comment is re-checked.

### 5.1 UI: items
- `components/ItemForm.tsx` (recurring only): a **Charge timing** select (In advance / In arrears) and a **Prorate partial periods** switch. When the selected account is prepaid, show the hint "Prepaid accounts currently charge recurring items at period end" (A-D1).
- Item detail: show both fields. Items list: a "Timing" column (tag).

### 5.2 UI: runs
- Trigger dialog: help text "Bills every due cycle up to the as-of date. Test and dry-run simulate them without changing accounts."
- Run detail: remove the "Catch-up" tag. In the per-account outcome, add an expandable **Cycles** table (bill date, service span, lines, net, invoice link / "Preview" / "Skipped") and a **Skipped items** list (reason, period). Translated labels for reason codes.
- Runs list type: drop `catch_up`.

### 5.3 i18n, integration test, docs, gate
- i18n en/pl for every new label and reason code.
- `__integration__/TC-BILL-005.spec.ts` (API, self-contained):
  1. Account with `nextBillDate` 3 cycles before `asOfDate` + a monthly in-advance item.
  2. `POST /api/billing/runs { mode: 'dry', asOfDate, scopedAccountIds }` → outcome `cycles.length === 3`, no invoices.
  3. `mode: 'test'` → 3 TEST drafts for the account. Cleanup through the test-invoice wipe endpoint.
  4. `catchUp: true` in the body is ignored (200).
- Docs:
  - `manuals/billing-ui-testing.md` §4 (bill runs: catch-up always, multi-cycle test/dry, cycles table) and §2b (timing/prorate);
  - `manuals/cpq-billing-end-to-end.md` (proration now in billing, first bill date = start);
  - `packages/billing/MIGRATION.md`;
  - spec A Implementation Status.
- Changeset: billing **minor** (breaking response: `catch_up` removed; behaviour: in-advance default, catch-up always). Connector **minor** (behaviour: no proration items, first bill date = start).
- Gate: `yarn build:packages`, `yarn generate`, typecheck (both packages + app), `yarn test`, `yarn build`. Migration **not applied** without confirmation.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Double billing** after a timing switch or rerun | The watermark is the single source of truth. Dedicated unit tests (1.2, 3.5). |
| **Seeds or live data with old `next_bill_date` semantics** (date = period end + 1) now bill the next period in advance on the first run | D14: reseed all instances. Called out in the changeset and MIGRATION.md. |
| **ARC supersede mid-period** now produces a credit line (old sub) + a stub charge (new sub) | Financially correct and intended (A-D2). Documented. CPQ can end on the period boundary to avoid it. |
| Connector and billing versions out of sync (old connector still posts proration lines → double charge) | The connector changeset bumps its billing peer range. Both are released together. |
| Large catch-up runs create many TEST drafts | Existing wipe endpoint. Dry-run first. |
| Spec 0 rework | Limited to `invoiceWriter.ts` + `findExistingDraftForBillDate` by design (see Sequencing note). |
| Negative-total drafts | Allowed with a warning. Proper credit documents come with Spec D. |

## Open items for the user

None blocking. Decisions A-D1..A-D3 cover the design. One confirmation will be needed at the end: applying the migration (`yarn mercato db migrate`).
