import { computeWaterfallSummary } from './priceAdjustments/pricingSnapshot'
import { isArcMirrorLine } from './arcPriceFreeze'
import type { PricingWaterfallSummary, ResolvedCharge } from './types'

export type OrderSummaryLine = {
  lineId: string
  quantity: number
  termMonths: number | null
  configuration: Record<string, unknown> | null
  charges: Array<Record<string, unknown>>
}

/** The quote's list / standard / offer figures and deal value, minus quote-only fields. */
export type OrderWaterfallSummary = Omit<PricingWaterfallSummary, 'snapshotHash' | 'hasTimeBasedAdjustments'>

/** Order lines store the quote's charges as plain JSON; fill the fields the waterfall needs. */
function toResolvedCharge(charge: Record<string, unknown>): ResolvedCharge {
  return {
    ...charge,
    chargeCode: String(charge.chargeCode ?? ''),
    chargeType: (charge.chargeType ?? 'mrc') as ResolvedCharge['chargeType'],
    unitPrice: Number(charge.unitPrice ?? 0),
    totalPrice: charge.totalPrice == null ? null : Number(charge.totalPrice),
  } as ResolvedCharge
}

/**
 * The same pricing summary the source quote shows (list totals, discount
 * depth, deal value), computed from the order's line charges, which are
 * copied verbatim from the quote at conversion. ARC mirror lines are left out
 * of deal value exactly as on the quote.
 */
export function summarizeOrderPricing(
  lines: readonly OrderSummaryLine[],
  quoteType: string,
  currencyCode: string,
): OrderWaterfallSummary {
  const summary = computeWaterfallSummary(lines.map((line) => ({
    lineId: line.lineId,
    quantity: line.quantity,
    termMonths: line.termMonths,
    includeInDeal: !isArcMirrorLine(line.configuration, quoteType),
    charges: line.charges.map(toResolvedCharge),
  })), [], currencyCode)
  const { snapshotHash: _snapshotHash, hasTimeBasedAdjustments: _timeBased, ...orderSummary } = summary
  return orderSummary
}
