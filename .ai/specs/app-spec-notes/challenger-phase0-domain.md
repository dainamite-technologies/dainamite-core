# Challenger — Phase 0 (§0–§2: business context, glossary, domain model, identity)

Execution: fresh-context subagent (general-purpose), 2026-11-10. Inputs: §0, §1, §2 of the App Spec + cited source files.

## CRITICAL (all fixed — see App Spec changelog 2026-11-10 "challenger fixes")

1. **Charge identity** — `chargeCode` is a catalog code, `chargeType` is nrc/mrc/usage; product-level charges (`offeringId` null) have no effective uniqueness (`entities.ts:484-486`) → charge-level target ambiguous. → Fixed: glossary "identified by chargeCode, classified by chargeType"; charge-level target = (line, chargeCode) and rejected with `ADJUSTMENT_TARGET_AMBIGUOUS` when the line resolves two charges with that code.
2. **Discount depth unsigned** — surcharges / overrides above list would report as discounts. → Fixed: signed `1 − after/before`, null when before = 0, stored as a fraction.
3. **R3 / I-4 invalid-override behaviour + lock deadlock** — undefined applied price; R7 blocks fixing an adjustment invalidated by line edits / rule changes / term edits on a locked quote. → Fixed: invalid adjustment is **not applied** (offer = standard for that charge) and the line gets a validation error; deleting an invalid adjustment is allowed while locked (the only lock exception).
4. **Free-form mirror lines** — `charges` is both input and output → re-applying adjustments stacks every recalculation; carried-over double discount. → Fixed: free-form (no offering/product) lines accept no manual adjustments and get no carry-over; their copied charges are kept verbatim (already offer prices).
5. **Carry-over level + action filter** — all mirror lines are `modify` (`cpqQuotingService.ts:2492`) so the action filter excludes nothing; quote-level carry-over would leak onto new lines. → Fixed: carry-over always creates `charge`-level adjustments on the mirror line; quote-level adjustments on ARC quotes apply only to lines that are not ARC-mirrored (`_arcMirroredFromItemId` absent).
6. **Billing boundary** — billing cycles have `billCycle` (monthly/quarterly/annually/weekly) + anchor (`billing/entities.ts:65-72`); service-month segment boundaries mid-cycle → under quarterly/annual billing a 3-month segment is never billed via recurring path; renewal extends any item with `bill_end_date`; renew-at-standard is not propagated to billing. → Fixed: I-8 restated as a money invariant (billed per cycle = schedule price, prorated per segment); connector named as translation layer creating segment items + proration items for every cycle a segment does not fully cover; segment items tagged by `sourceRef` suffix and excluded from renew extension; renew price change reaches billing as end-date old item + new item (connector, Phase 2) — logged U8 for Phase 1 behaviour.

## WARNING (fixed or logged)

- "Price lock" misleading → renamed **Adjustment lock**; `pricingSnapshotHash` added to `pricing_changed` / `status_changed` payloads. Fixed.
- Usage excluded from deal value → added `discountDepth.maxUsageManual` (max manual discount on usage rates). Fixed.
- Percent vs fraction ambiguity → all depth values are fractions 0..1 (signed); columns renamed `*_discount_depth` numeric(7,6). Fixed.
- ARC dilution / contracted price moves on amend → carry-over pins the contracted price: a carried-over adjustment is created as `price_override` = the source item's current offer unit price for that charge (permanent) or per remaining window (Phase 2), not the original % — PM decision recorded in R9. Deal value for ARC quotes computed on changed lines only (`discountDepth` excludes unchanged mirror lines). Fixed.
- Concurrency on I-2 → `CpqQuoteConfiguration` is the aggregate root; every adjustment write and every status transition takes a row lock (`SELECT … FOR UPDATE`) on it. Fixed.
- `.updated` event lacks previous values → `previous {…}` added. Fixed.
- Currency change → treated like R8 (invalid, not applied, line error). Fixed (R8 widened).
- §1.2 metric ill-defined → metric restated: "billed amount for each service month = schedule price". Fixed.
- Sales discount fields → D6 already decides: stay 0; consistent single source = CPQ (U2). Kept, wording clarified.
- §2 Sales manager row → requires `cpq.quotes.manage` + `adjust_price` to edit. Fixed.
- Month-end starts → service month uses calendar month arithmetic with end-of-month clamping (Jan 31 → Feb 28/29 → Mar 31). Fixed in glossary.
- `carried_over` reason discards the original → keep the original `reason_code`; provenance via `carried_from_subscription_item_id`. Fixed (system reason `carried_over` removed).
