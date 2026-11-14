/**
 * VAT arithmetic for billing documents (Spec 0 — replaces core
 * `taxCalculationService`; billing no longer depends on core `sales`).
 *
 * Pure. Money is rounded half-up to 2 dp (fiscal documents) and the
 * identity `net + tax = gross` always holds exactly:
 *   - from net:   tax = round2(net × rate), gross = net + tax
 *   - from gross: net = round2(gross / (1 + rate)), tax = gross − net
 * Per-line rounding; document totals are sums of rounded lines (both
 * methods are permitted in PL/EU and this keeps documents internally
 * consistent).
 */

export type VatAmounts = { net: number; tax: number; gross: number }

export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
}

function fraction(ratePercent: number): number {
  return Number.isFinite(ratePercent) && ratePercent > 0 ? ratePercent / 100 : 0
}

/** Amounts for a net line value (sign preserved for credits). */
export function lineAmountsFromNet(net: number, ratePercent: number): VatAmounts {
  const netRounded = round2(net)
  const tax = round2(netRounded * fraction(ratePercent))
  return { net: netRounded, tax, gross: round2(netRounded + tax) }
}

/** Split a gross amount (e.g. a top-up payment) into net + tax. */
export function lineAmountsFromGross(gross: number, ratePercent: number): VatAmounts {
  const grossRounded = round2(gross)
  const net = round2(grossRounded / (1 + fraction(ratePercent)))
  return { net, tax: round2(grossRounded - net), gross: grossRounded }
}

/** Column format used by billing numeric(18,4) money columns. */
export function money4(value: number): string {
  return (Number.isFinite(value) ? round2(value) : 0).toFixed(4)
}

export type DocumentTotals = { subtotalNet: string; taxTotal: string; totalGross: string }

export function sumTotals(lines: ReadonlyArray<VatAmounts>): DocumentTotals {
  let net = 0
  let tax = 0
  let gross = 0
  for (const line of lines) {
    net += line.net
    tax += line.tax
    gross += line.gross
  }
  return { subtotalNet: money4(net), taxTotal: money4(tax), totalGross: money4(gross) }
}
