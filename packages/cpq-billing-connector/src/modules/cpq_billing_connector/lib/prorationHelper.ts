/**
 * Proration math owned by the connector.
 *
 * Per spec: "Connectors computing proration values should follow the
 * same convention for consistency on the draft" — i.e. half-up 2dp,
 * matching billing's `roundHalfUp2dp` policy. Duplicated here (vs
 * imported from `@dainamite/billing`) on purpose so the connector
 * doesn't reach into billing's internals via a non-peer-dep path.
 *
 * The formula is the linear-day proration documented in the spec's
 * "CPQ-side payload contracts" section:
 *   `prorationAmount = unitPrice × quantity × daysRemaining / daysInPeriod`
 *
 * For mid-cycle additions (e.g. customer buys an add-on on 2026-05-15
 * for a monthly cycle anchored on the 1st), `daysRemaining` is the
 * number of full days from the effective date through the cycle end
 * (inclusive), and `daysInPeriod` is the cycle's calendar-day length.
 *
 * The CPQ event payload supplies both numbers — the connector trusts
 * the calendar arithmetic CPQ already did (it derived the period
 * boundaries from the subscription's lifecycle). It does NOT
 * re-compute them from `effectiveDate` and `cycleEnd` to avoid
 * disagreeing with CPQ's source of truth.
 */

/**
 * Half-up 2dp rounding that survives JS floating-point edges
 * (e.g. `1.005 * 100 === 100.49999…`). Matches billing's
 * `roundHalfUp2dp` policy.
 */
function roundHalfUp2dp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type ProrationInput = {
  unitPrice: number
  quantity: number
  daysInPeriod: number
  daysRemaining: number
}

export type ProrationResult = {
  /** Numeric amount, half-up 2dp, suitable for `rate_json.amount`. */
  amount: number
  /** Computed string form for `billing.items.create.rateJson` (4dp). */
  amountString: string
}

export function computeProration(input: ProrationInput): ProrationResult {
  // Guard against the degenerate "0 days in period" — should never
  // happen if CPQ derived the values, but defending here avoids a
  // silent NaN propagation if it ever does.
  if (input.daysInPeriod <= 0) {
    return { amount: 0, amountString: '0.0000' }
  }
  const raw =
    (input.unitPrice * input.quantity * Math.max(0, input.daysRemaining)) /
    input.daysInPeriod
  const rounded = roundHalfUp2dp(raw)
  return { amount: rounded, amountString: rounded.toFixed(4) }
}

/**
 * Helper used by subscribers to format the proration description so
 * the resulting invoice line reads naturally (matches spec example:
 * "Proration: Package X from 2026-05-15 to 2026-05-31").
 */
export function formatProrationDescription(params: {
  productName: string
  effectiveDate: string
  cycleEnd: string
}): string {
  return `Proration: ${params.productName} from ${params.effectiveDate} to ${params.cycleEnd}`
}
