# Foreign-currency supplier costs with dated exchange-rate snapshots

- Date: 2026-11-11
- Category: feature
- Priority signal: medium — §7 Phase 2; carrier tails are often USD / EUR (Q-D4)
- Risk signal: low — one engine branch; framework `ExchangeRateService` grounded-elsewhere; optional dependency
- Routing: om-spec-writing "Foreign-currency supplier costs with dated exchange-rate snapshots — brief: .ai/specs/briefs/2026-11-11-cpq-cost-plus-foreign-currency-costs.md"
- App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md — sections §1.4.6 (`fx_rate`, `fx_rate_date`), R3, R4, §5 US-2.4, §7 Phase 2 (R3 / R4 criterion)
- Depends on: `2026-11-11-cpq-cost-plus-quote-pricing-margin.md`

## Problem

Supplier costs arrive in the supplier's currency. Before this feature, any cost not in the quote currency blocks the line with `CURRENCY_NO_RATE`, and procurement has to convert by hand.

## Agreed direction

- Commit #26: convert costs in another currency with `currencies` `ExchangeRateService.getRate`:
  - call it with `autoFetch: false` (no provider fetch inside the quote lock) and a 7-day look-back (tenant-configurable);
  - pick the tenant's default provider, else the highest-priority one;
  - store `actualDate` as `fx_rate_date`;
  - `fx_rate` = quote-currency units per one cost-currency unit;
  - snapshot on saved recalculation while unlocked and freeze with the lock (R4); previews never store;
  - a missing rate → `CURRENCY_NO_RATE`, never 1:1;
  - resolve the service optionally, so standalone CPQ installs without `currencies` keep the Phase 1 behaviour.
- Table lookups prefer quote-currency entries, else element-currency entries converted (R3).

## Resolved unknowns

| Question | Answer |
|----------|--------|
| Allowed? | Yes, dated snapshot (Q-D4) |
| Rate date | Today or earlier (the service refuses future dates); the stored `actualDate` |
| Acceptance criteria | §7 Phase 2 R3 / R4 criterion; US-2.4 paths |

## Non-goals

- FX gains / losses and accounting; refreshing rates on locked quotes; index currencies (index feature).

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/services/cpqPricingService.ts`, cost resolution, `di.ts` (optional resolution); cost dialogs show the currency and rate.
