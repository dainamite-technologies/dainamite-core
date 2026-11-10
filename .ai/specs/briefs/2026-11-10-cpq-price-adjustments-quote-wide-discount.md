# Quote-wide percentage discount on CPQ quotes

- Date: 2026-11-10
- Category: feature
- Priority signal: medium — §7 Phase 4
- Risk signal: low — extends the existing resolution with one level
- Routing: om-spec-writing "Quote-wide percentage discount on CPQ quotes — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-quote-wide-discount.md"
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — sections §1.3 (eligible line), §1.4 (R1), §5 US-1.4, §7 Phase 4

## Problem

Multi-line deals need the same discount on every line; per-line discounts are repetitive and drift. ROI: one action instead of N.

## Agreed direction

- `level = quote`, `discount_percent` only, optional `charge_type_filter` and (MRC) window; applies to eligible lines (engine-priced, not frozen), including lines added later; less specific than any line / charge adjustment and than carried-over adjustments (R1); Discount quote dialog on the summary card.

## Resolved unknowns

| Question | Answer |
|---|---|
| ARC quotes | Eligible lines only (Renew re-priced lines included; frozen Amend lines excluded) |
| Overlap | One quote-level adjustment per charge type per window (I-2) |

## Non-goals

- Amount-off / override at quote level.

## Affected areas (if known)

- CPQ resolution + adjustments API + quote summary dialog. Depends on `manual-adjustments` (and `time-windows` for windows).
