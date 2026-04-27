---
name: cpq-pricing
description: Pricing engine work in CPQ — pricing tables, price columns, charge definitions (NRC/MRC/usage), price rules (discount/surcharge/override), tiered pricing, and the calculate-price API. Load when modifying anything that resolves a price for a quote line, or when designing a new pricing dimension.
---

# CPQ — Pricing

## Canonical files

| Concern | File |
|---|---|
| Pricing service implementation | [`src/modules/cpq/services/cpqPricingService.ts`](../../../../src/modules/cpq/services/cpqPricingService.ts) |
| Validation that runs alongside pricing | [`src/modules/cpq/services/cpqValidationService.ts`](../../../../src/modules/cpq/services/cpqValidationService.ts) |
| Pricing entities | `data/entities.ts` — `CpqPricingTable`, `CpqPricingTableEntry`, `CpqProductCharge`, `CpqPriceRule` |
| Service types | `services/types.ts` — `PricingSummary`, `RuleAdjustment`, `TierBreakdown`, `ResolvedCharge` |
| API routes | `api/pricing-tables/`, `api/pricing-table-entries/`, `api/price-rules/`, `api/product-charges/`, `api/quotes/price/` |
| Backend pages | `backend/cpq/pricing/`, `backend/cpq/price-rules/` |

## Mandatory reading before code changes

1. [`manuals/xd-186-pricing-tables.md`](../../../../manuals/xd-186-pricing-tables.md) — pricing-table model & dimensions
2. [`manuals/xd-187-calculate-price-api.md`](../../../../manuals/xd-187-calculate-price-api.md) — public price-calculation contract
3. [`manuals/xd-188-price-rules.md`](../../../../manuals/xd-188-price-rules.md) — rule types and ordering
4. [`manuals/xd-217-tiered-pricing-and-price-rules.md`](../../../../manuals/xd-217-tiered-pricing-and-price-rules.md) — tier breakdowns
5. [`specs/implementation/xd-186-pricing-tables.md`](../../../../specs/implementation/xd-186-pricing-tables.md), [`xd-187-calculate-price-api.md`](../../../../specs/implementation/xd-187-calculate-price-api.md), [`xd-188-price-rules.md`](../../../../specs/implementation/xd-188-price-rules.md)

## Domain rules

- **Charges** are typed: NRC (one-off), MRC (recurring), usage. `CpqProductCharge`
  is unique per offering — see migration `Migration20260331000000_cpq_charge_unique_per_offering.ts`.
- **Pricing tables** carry one or more named price columns; entries are matched
  by dimension values (e.g. `port_size`, `data_centre`). The matcher is in
  `cpqPricingService`.
- **Price rules** apply *after* table lookup. Order: discount → surcharge →
  override. A rule may target a charge type, an offering, or a context flag.
- **Tier breakdowns** (`TierBreakdown`) are surfaced in the response so the UI
  can explain "you saved X because tier Y kicked in" — keep them populated when
  a rule changes the price.
- **Calculate-price API is a public contract** (`api/quotes/price/route.ts`).
  Treat it like an external API — no breaking changes without bumping the
  package major and updating `packages/cpq/MIGRATION.md`.

## Common tasks

### Add a new pricing dimension

1. Add the column to `CpqPricingTableEntry` (or to the `dimensions` jsonb if
   you're keeping it generic).
2. Update validators in `data/validators.ts` so the new dimension flows
   through.
3. Extend the matcher logic in `cpqPricingService` — keep it pure (no I/O).
4. Add a unit test fixture covering the new dimension.
5. Run `yarn mercato db generate` if you added a real column.
6. Document the new dimension in `manuals/xd-186-pricing-tables.md`.

### Add a new price rule type

1. Extend the rule-type enum in `services/types.ts`.
2. Implement evaluation in `cpqPricingService`'s rule pass — preserve order
   (discount → surcharge → override).
3. Surface the rule in `RuleAdjustment` so callers see why the price moved.
4. Add an admin UI option in `backend/cpq/price-rules/`.
5. Update [`manuals/xd-188-price-rules.md`](../../../../manuals/xd-188-price-rules.md).

### Change the price-calculation API response shape

This is a **breaking change**. Required steps:

- Bump `packages/cpq/package.json` major.
- Add migration notes in `packages/cpq/MIGRATION.md`.
- Update `manuals/xd-187-calculate-price-api.md`.
- Add a test that asserts the new shape end-to-end through `api/quotes/price/`.

## Required detail pages

Every pricing entity exposed in admin UI ships a list **and** a detail page
(see Engineering bar §3 in [`../SKILL.md`](../SKILL.md)):

| Entity | List | Detail |
|---|---|---|
| `CpqPricingTable` | [`backend/cpq/pricing/page.tsx`](../../../../src/modules/cpq/backend/cpq/pricing/page.tsx) | `[id]/page.tsx` (entries editor inline) |
| `CpqPriceRule` | [`backend/cpq/price-rules/page.tsx`](../../../../src/modules/cpq/backend/cpq/price-rules/page.tsx) | [`[id]/page.tsx`](../../../../src/modules/cpq/backend/cpq/price-rules/[id]/page.tsx) (already exists) |
| `CpqProductCharge` | rendered inline on offering detail | drilldown detail if listed standalone |

Detail pages MUST render a tier-breakdown / rule-adjustment preview (read-only)
for the live row so editors see *what this rule would do* without leaving the
page. Use the calculate-price API in dry-run mode for the preview — never
re-implement the math in the UI.

## Required tests

Place under `src/modules/cpq/services/__tests__/`:

| Test file | Asserts |
|---|---|
| `cpqPricingService.matcher.test.ts` | Pricing-table entry matching: exact match wins; partial match falls through; no match returns null with documented error code |
| `cpqPricingService.rules.test.ts` | Rule ordering (discount → surcharge → override). Each kind moves price by expected amount. Rule combinations produce deterministic `RuleAdjustment[]` |
| `cpqPricingService.tiers.test.ts` | Tier breakdown numbers add up to the final price; tier boundary picks correct tier (off-by-one regression guard) |
| `cpqValidationService.test.ts` | Invalid pricing-table dimensions rejected with `ValidationError`-shaped output, stable error keys |
| `data/validators.test.ts` (if added) | Zod schemas accept the documented shapes from `manuals/xd-186-*` examples and reject malformed ones |

Use **fixtures**, not random data. A repeatable fixture (`fixtures/gix-port-table.ts`)
that mirrors the GIX seed lets pricing changes get caught immediately.

## Self-review checklist

- [ ] OpenAPI updated for any pricing route signature change
- [ ] Pricing functions are pure where possible — `EntityManager` reads only,
      no writes
- [ ] `RuleAdjustment` and `TierBreakdown` populated for every adjustment
- [ ] Money values stored as integers (cents) or `decimal` — never `float`
- [ ] Currency carried alongside amount (CPQ never converts)
- [ ] Calculate-price API output didn't break without a migration plan
- [ ] Detail page exists for every newly listed pricing entity
- [ ] Unit tests cover matcher, rule ordering, tier boundaries, and
      validation error shapes
- [ ] Manuals updated in `manuals/xd-186-*` / `xd-187-*` / `xd-188-*` /
      `xd-217-*` if behavior changed
