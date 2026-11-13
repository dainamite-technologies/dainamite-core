import type { CostValueStatus } from '../../data/costs'

/**
 * Cost-plus list price (App Spec §1.4.7 R2). Pure: no EM, no I/O.
 *
 *   C = Σ per-instance amount of the charge's price-basis cost lines with a known value
 *   markup_percent        → C × (1 + m / 100)        (m = 25 means 25 %)
 *   target_margin_percent → C ÷ (1 − m / 100)        (m < 100)
 *   markup_absolute       → C + a                    (once per instance)
 *
 * C stays in full precision; the list total is rounded ONCE to the currency
 * precision. For `per_unit` charges the list unit is `total ÷ quantity` kept at
 * 4 dp, like every other unit price the waterfall carries.
 */

export type MarkupRule = 'markup_percent' | 'target_margin_percent' | 'markup_absolute'
export type CostPlusErrorCode = 'COST_PENDING' | 'NO_PRICE_BASIS_COST' | 'MARKUP_INVALID'

export type CostPlusCostInput = {
  role: string
  valueStatus: CostValueStatus | string
  /** Per-instance amount in the quote currency (numeric string or number). */
  instanceAmount: string | number | null
}

export type CostPlusPriceInput = {
  costs: CostPlusCostInput[]
  markupRule: MarkupRule | string
  markupValue: number | string
  chargeModel: 'flat' | 'per_unit'
  /** Charge quantity (per_unit only). */
  quantity: number
  currencyCode: string
}

export type CostPlusPriceResult =
  | { ok: true; listTotal: number; listUnit: number; quantity: number }
  | { ok: false; error: CostPlusErrorCode }

/** Fraction digits of a currency (EUR 2, JPY 0, KWD 3); 2 for unknown codes. */
export function currencyPrecision(currencyCode: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor
}

/** Σ of the known price-basis costs (full precision), or the error that leaves the charge unpriced. */
export function sumPriceBasisCosts(costs: CostPlusCostInput[]): { ok: true; total: number } | { ok: false; error: CostPlusErrorCode } {
  const basis = costs.filter((cost) => cost.role === 'price_basis')
  if (basis.length === 0) return { ok: false, error: 'NO_PRICE_BASIS_COST' }
  if (basis.some((cost) => cost.valueStatus === 'none' || cost.instanceAmount === null || cost.instanceAmount === undefined)) {
    return { ok: false, error: 'COST_PENDING' }
  }
  return { ok: true, total: basis.reduce((sum, cost) => sum + Number(cost.instanceAmount), 0) }
}

export function applyMarkup(cost: number, rule: string, value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  if (rule === 'markup_percent') return cost * (1 + value / 100)
  if (rule === 'target_margin_percent') return value >= 100 ? null : cost / (1 - value / 100)
  if (rule === 'markup_absolute') return cost + value
  return null
}

export function computeCostPlusPrice(input: CostPlusPriceInput): CostPlusPriceResult {
  const summed = sumPriceBasisCosts(input.costs)
  if (!summed.ok) return summed
  const marked = applyMarkup(summed.total, input.markupRule, Number(input.markupValue))
  if (marked === null) return { ok: false, error: 'MARKUP_INVALID' }

  const precision = currencyPrecision(input.currencyCode)
  const listTotal = roundTo(marked, precision)
  if (input.chargeModel !== 'per_unit') return { ok: true, listTotal, listUnit: listTotal, quantity: 1 }
  const quantity = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 0
  // Zero quantity prices at zero (like a table lookup with quantity 0).
  if (quantity === 0) return { ok: true, listTotal: 0, listUnit: 0, quantity: 0 }
  return { ok: true, listTotal, listUnit: roundTo(listTotal / quantity, 4), quantity }
}
