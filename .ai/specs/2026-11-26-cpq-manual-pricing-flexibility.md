# CPQ — Manual Pricing Flexibility: Set Any Price, and Line-Level Amount Off and Set Price

**Date**: 2026-11-26
**Status**: Business spec, questions resolved (F-D1–F-D4). Next: technical design and estimate
**Owner**: Mac
**Package**: `@dainamite/cpq` only. Billing and the connector are not affected: CPQ keeps sending the offer price.
**Extends**: [`2026-11-10-cpq-manual-price-adjustments.md`](2026-11-10-cpq-manual-price-adjustments.md), which is implemented and archived in [`capabilities/cpq-quote-pricing.md`](capabilities/cpq-quote-pricing.md).
**Related**: [`2026-11-26-billing-price-phases-ramp-deals.md`](2026-11-26-billing-price-phases-ramp-deals.md). Every CPQ phase uses the adjustment types defined here, and that spec's former D6 (above standard) moved here as F-D1.

---

## TLDR

**Key points:**
- **Today:**
  - A rep can discount a whole line **by % only**.
  - Setting a price is possible only **per charge**, through a small pencil icon inside the expanded charge breakdown. It is **capped at the standard price**, and **not offered** for volume or tiered charges.
  - Reps don't find it, and they can't type the price they agreed with the customer.
- **Proposal:** one **Adjust price** action on every line, and the existing one on every charge, both with three types: **Set price**, **% off** and **Amount off**.
  - Any price is allowed, including above standard.
  - Volume and tiered charges get **Set charge total**.

**Scope:**
- Set price and amount off at line level.
- Set price on any charge model, with no cap.
- The line-level action becomes visible.
- Waterfall and depth show uplifts. AI tools are updated.

**Out of scope:**
- Quote-level discount (App Spec US-1.4; later, F-D4).
- Adjustments on usage charges.
- Compounding several manual adjustments (unchanged: the most specific one wins).

## Decisions

| # | Decision |
|---|---|
| F-D1 | **A manual price may be above the standard price** (decided 2026-11-26, formerly D6 in the ramp-deals spec). `ABOVE_STANDARD` is lifted for every manual price. Pricing depth shows the uplift as a negative discount, with an "Above standard" badge. The permission (`cpq.quotes.adjust_price`) and the pricing signals (`cpq.quote.pricing_changed`) stay, so an approval workflow can react. |
| F-D2 | **The price rules spec stays separate.** Price rules already support `discount_percent / discount_absolute / surcharge_percent / surcharge_absolute / price_override`. Their time-limited phases are in the ramp-deals spec. |
| F-D3 | **A line-level Set price or Amount off is spread over the line's charges** in proportion to their standard totals, so every charge keeps its own price. On a bundle parent it sets the **bundle's** total (parent and components), the same reach as the line % discount. |
| F-D4 | **Quote-level discount (App Spec US-1.4) comes later.** It isn't needed for line overrides or ramps. |

## Current state (verified 2026-11-26)

| Where in the quote UI | Level | Types offered | Limits |
|---|---|---|---|
| Line row, **% icon** "Discount line" | line (cascades to bundle children) | **% off only** (all charges, recurring only, or one-time only) | — |
| Expanded line → charge breakdown → **pencil** "Adjust price" | charge | Set a new unit price, % off, amount off the charge total | Set price ≤ standard (`ABOVE_STANDARD`). Set price only for flat / per-unit charges (`allowedAdjustmentTypes`, `resolveManualAdjustments`). None on usage charges |
| Quote | — | none | App Spec Phase 4 |

- **Both actions are hidden** when the tenant's feature toggle `cpq.manual_price_adjustments` is off, or when the user lacks `cpq.quotes.adjust_price`.
- **The rules:**
  - one manual adjustment per target;
  - charge level beats line level, which beats a bundle parent;
  - never compounded;
  - a reason code is required.

## Proposed behaviour

| Level | Set price | % off | Amount off |
|---|---|---|---|
| Charge, flat / per unit | New unit price, any value ≥ 0 | Exists | Exists (off the charge total) |
| Charge, volume / tiered | **New: the charge total**, because there is no single unit price | Exists | Exists |
| Line | **New:** the line's recurring **or** one-time total, spread over its charges (F-D3) | Exists | **New:** off the line's recurring **or** one-time total, spread over its charges |

**Rules:**
- **Line-level Set price and Amount off** require choosing *Recurring* or *One-time*. One amount can't sensibly span both. A rep who wants both adds two line adjustments, one per type, which the current rules already allow (they never compete for the same charge).
- **Spreading** (F-D3): in proportion to each charge's standard total. The rounding remainder goes to the largest charge. If every charge is at 0, the whole amount goes to the first charge.
- **Most-specific-wins is unchanged.** A charge-level adjustment still beats a line-level one for that charge. In that case the line's Set price is spread over the remaining charges only, so the line total still equals the typed price.
- **UI:**
  - The line row's % icon becomes an **Adjust price** button with the three types.
  - The charge pencil stays.
  - The dialog hint "at most the standard price" goes. The preview shows standard → new price and the depth, including uplifts.
- **Phases** (ramp-deals spec) reuse these types per phase. *Free* = Set price 0.

## Implementation outline (sized after sign-off)

1. **Pure resolver** (`resolveManualAdjustments`):
   - types per level, `ABOVE_STANDARD` removed, charge-total override for volume / tiered;
   - a pure spreading helper, with unit tests for proportional spreading, rounding, all-zero charges, a charge override beating a line Set price, and a bundle.
2. **Validators** (`data/price-adjustments.ts`): line-level `price_override` / `discount_absolute` with a required `chargeTypeFilter`. The `openApi` docs and the AI tools that write adjustments are updated in the same PR (`mcp-tools` skill).
3. **UI:**
   - the dialog types per level, the line **Adjust price** button, the "Above standard" badge, i18n;
   - Playwright: set a line price, set a price above standard, set the total of a tiered charge.
4. **Docs:**
   - capability doc `cpq-quote-pricing.md` (scenario "Override above standard" → allowed);
   - `manuals/cpq-price-adjustments.md` ("Never above standard" and the % only line discount);
   - CHANGELOG (minor bump).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Prices above standard sold without review | Medium | Same permission as today. Pricing signals carry the uplift for approval workflows |
| Spread cents don't add up to the typed price | Low | The remainder goes to the largest charge. Unit-tested |
| Existing stored adjustments change meaning | Low | Charge-level types and line % are unchanged. Only new types and the lifted cap are added |

## Changelog

| Date | Change |
|---|---|
| 2026-11-26 | Skeleton, from the request "set any price; discounting supports only %". F-D1 moved from the ramp-deals spec (D6). Open questions C-Q1–C-Q2 |
| 2026-11-26 | C-Q1 → F-D3 (proportional spread, bundle total). C-Q2 → F-D4 (quote-level discount later) |
