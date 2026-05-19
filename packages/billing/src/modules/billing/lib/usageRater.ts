/**
 * Pure functions to rate usage quantity against a `rate_json` payload.
 *
 * Three tier models per the spec (`volume` / `graduated` / `flat`) plus
 * the "simple" flat-rate shape (`{ unit_price }` without a `model`).
 * The validator at `data/validators.ts` ensures the payload structure
 * before it reaches this rater — this module trusts the shape but
 * defends against numeric edge cases (NaN, negative quantity).
 *
 * Output:
 *   - `amount` — numeric string, rounded 2dp half-up, formatted to 4
 *     decimals to match the `core/sales` numeric(18,4) column shape.
 *   - `breakdown` — per-tier rated quantity / amount, persisted into
 *     `SalesInvoiceLine.metadata.usage_tier_breakdown` so operators
 *     can see how the line was built without re-running the math.
 */

import type { BillingItem } from '../data/entities'

export type SimpleFlatRate = { unit_price: number }
export type VolumeTier = { up_to: number | null; unit_price: number }
export type GraduatedTier = { up_to: number | null; unit_price: number }
export type FlatTier = { up_to: number | null; flat_amount: number }

export type VolumeRate = { model: 'volume'; tiers: VolumeTier[] }
export type GraduatedRate = { model: 'graduated'; tiers: GraduatedTier[] }
export type FlatRate = { model: 'flat'; tiers: FlatTier[] }
export type TieredRate = VolumeRate | GraduatedRate | FlatRate
export type UsageRate = SimpleFlatRate | TieredRate

export type TierBreakdownEntry = {
  tierIndex: number
  upTo: number | null
  /** Quantity rated at this tier — 0 for tiers above the consumed range. */
  rangeQuantity: number
  /** `unit_price` for volume/graduated; `flat_amount` for flat. */
  rate: number
  /** Per-tier amount contribution, rounded 4dp. */
  amount: string
}

export type UsageRateResult = {
  /** Total rated amount, numeric(18,4) string. */
  amount: string
  /** Per-tier or single-rate breakdown for invoice-line metadata. */
  breakdown: TierBreakdownEntry[]
}

/**
 * Half-up rounding to 2dp survives the JS floating-point edge case
 * (`1.005 → 1.01`, `100 × 0.001 + 100 × 0.001 + … → exactly N×0.001`).
 * Match `invoiceWriter`'s rounding policy so totals are consistent
 * across line types.
 */
function roundHalfUp2dp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function format4dp(value: number): string {
  return roundHalfUp2dp(value).toFixed(4)
}

/**
 * Format a unit price to 4dp WITHOUT 2dp rounding — sub-cent rates
 * like `0.001` (per-API-request pricing) are legitimate. The spec's
 * 2dp half-up rule applies only to line *amounts*, not per-unit
 * rates.
 */
function formatUnitPrice(value: number): string {
  if (!Number.isFinite(value)) return '0.0000'
  return value.toFixed(4)
}

function isTieredRate(rate: UsageRate): rate is TieredRate {
  return typeof (rate as { model?: unknown }).model === 'string'
}

function safeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) return 0
  return quantity
}

// ─── Simple flat-rate ────────────────────────────────────────────

function rateSimpleFlat(quantity: number, rate: SimpleFlatRate): UsageRateResult {
  const q = safeQuantity(quantity)
  const total = q * rate.unit_price
  return {
    amount: format4dp(total),
    breakdown: [
      {
        tierIndex: 0,
        upTo: null,
        rangeQuantity: q,
        rate: rate.unit_price,
        amount: format4dp(total),
      },
    ],
  }
}

// ─── Volume tier ─────────────────────────────────────────────────
//
// "Entire quantity priced at the unit_price of the tier its total falls
// into." So we walk tiers in order, find the first tier whose `up_to`
// is `null` (open-ended) or `>= quantity`, and charge `quantity ×
// that tier's unit_price`. The unconsumed tiers report 0.

function rateVolume(quantity: number, rate: VolumeRate): UsageRateResult {
  const q = safeQuantity(quantity)
  const breakdown: TierBreakdownEntry[] = rate.tiers.map((tier, idx) => ({
    tierIndex: idx,
    upTo: tier.up_to,
    rangeQuantity: 0,
    rate: tier.unit_price,
    amount: format4dp(0),
  }))
  for (let i = 0; i < rate.tiers.length; i++) {
    const tier = rate.tiers[i]
    if (tier.up_to === null || q <= tier.up_to) {
      const total = q * tier.unit_price
      breakdown[i] = {
        tierIndex: i,
        upTo: tier.up_to,
        rangeQuantity: q,
        rate: tier.unit_price,
        amount: format4dp(total),
      }
      return { amount: format4dp(total), breakdown }
    }
  }
  // Should be unreachable: validator enforces an open-ended top tier.
  return { amount: format4dp(0), breakdown }
}

// ─── Graduated tier ──────────────────────────────────────────────
//
// "Each unit priced at its tier." Walk tiers in order, charging
// `min(q_remaining, tier_capacity) × unit_price` for each tier the
// quantity touches.

function rateGraduated(quantity: number, rate: GraduatedRate): UsageRateResult {
  const q = safeQuantity(quantity)
  let remaining = q
  let previousUpTo = 0
  let total = 0
  const breakdown: TierBreakdownEntry[] = []
  for (let i = 0; i < rate.tiers.length; i++) {
    const tier = rate.tiers[i]
    const tierCapacity =
      tier.up_to === null ? Infinity : Math.max(0, tier.up_to - previousUpTo)
    const consumed = Math.min(remaining, tierCapacity)
    const tierAmount = consumed * tier.unit_price
    total += tierAmount
    breakdown.push({
      tierIndex: i,
      upTo: tier.up_to,
      rangeQuantity: consumed,
      rate: tier.unit_price,
      amount: format4dp(tierAmount),
    })
    remaining -= consumed
    previousUpTo = tier.up_to ?? previousUpTo
    if (remaining <= 0) {
      // Pad remaining tiers with zeros for breakdown completeness.
      for (let j = i + 1; j < rate.tiers.length; j++) {
        breakdown.push({
          tierIndex: j,
          upTo: rate.tiers[j].up_to,
          rangeQuantity: 0,
          rate: rate.tiers[j].unit_price,
          amount: format4dp(0),
        })
      }
      break
    }
  }
  return { amount: format4dp(total), breakdown }
}

// ─── Flat tier ───────────────────────────────────────────────────
//
// "One flat fee for the highest tier reached." Find the first tier
// whose `up_to` is `null` or `>= quantity`. Charge that tier's
// `flat_amount`. Other tiers report 0.

function rateFlat(quantity: number, rate: FlatRate): UsageRateResult {
  const q = safeQuantity(quantity)
  const breakdown: TierBreakdownEntry[] = rate.tiers.map((tier, idx) => ({
    tierIndex: idx,
    upTo: tier.up_to,
    rangeQuantity: 0,
    rate: tier.flat_amount,
    amount: format4dp(0),
  }))
  for (let i = 0; i < rate.tiers.length; i++) {
    const tier = rate.tiers[i]
    if (tier.up_to === null || q <= tier.up_to) {
      breakdown[i] = {
        tierIndex: i,
        upTo: tier.up_to,
        rangeQuantity: q,
        rate: tier.flat_amount,
        amount: format4dp(tier.flat_amount),
      }
      return { amount: format4dp(tier.flat_amount), breakdown }
    }
  }
  return { amount: format4dp(0), breakdown }
}

// ─── Public dispatcher ───────────────────────────────────────────

export function rateUsageQuantity(rate: UsageRate, totalQuantity: number): UsageRateResult {
  if (!isTieredRate(rate)) {
    return rateSimpleFlat(totalQuantity, rate)
  }
  switch (rate.model) {
    case 'volume':
      return rateVolume(totalQuantity, rate)
    case 'graduated':
      return rateGraduated(totalQuantity, rate)
    case 'flat':
      return rateFlat(totalQuantity, rate)
  }
}

/**
 * Convenience wrapper: takes a BillingItem's `rate_json` (typed as
 * `unknown` from JSONB) and the total quantity, returns the rated
 * amount + breakdown. Returns `null` when the rate shape is invalid —
 * caller falls back to "no charge" + warns instead of crashing the
 * whole account.
 */
export function rateUsageForItem(
  item: Pick<BillingItem, 'rateJson' | 'type'>,
  totalQuantity: number,
): UsageRateResult | null {
  if (item.type !== 'usage') return null
  const rate = item.rateJson as UsageRate | null | undefined
  if (!rate || typeof rate !== 'object') return null
  if (isTieredRate(rate)) {
    if (!Array.isArray(rate.tiers) || rate.tiers.length === 0) return null
  } else if (typeof (rate as SimpleFlatRate).unit_price !== 'number') {
    return null
  }
  return rateUsageQuantity(rate, totalQuantity)
}

export { roundHalfUp2dp, format4dp, formatUnitPrice }
