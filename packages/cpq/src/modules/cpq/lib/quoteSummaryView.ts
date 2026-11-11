import { discountDepth } from './priceAdjustmentView'

type SummaryTotals = {
  nrcTotal: number
  mrcTotal: number
  listNrcTotal?: number
  listMrcTotal?: number
}

/**
 * Total discount depth (list → offer) per charge type for the summary header.
 * `null` when the snapshot predates the waterfall fields or list is zero.
 */
export function chargeTypeDepths(summary: SummaryTotals): { nrc: number | null; mrc: number | null } {
  return {
    nrc: discountDepth(summary.listNrcTotal, summary.nrcTotal),
    mrc: discountDepth(summary.listMrcTotal, summary.mrcTotal),
  }
}

type ArcSummaryLine = {
  action: 'add' | 'modify' | 'cancel'
  mrcTotal: number
  arcSource: { mrcAmount: number } | null
}

export type ArcRecurringDelta = { currentMrc: number; newMrc: number; delta: number; deltaPct: number | null }

/**
 * Amend / Renew: monthly recurring before vs. after the change.
 * "Current" sums the live subscription items the quote mirrors (`arcSource`);
 * "New" sums every line that survives activation (cancel lines drop to zero).
 * Same before/after semantics as the per-line `ArcLineDiff` on the order page.
 */
export function arcRecurringDelta(lines: ArcSummaryLine[]): ArcRecurringDelta {
  let currentMrc = 0
  let newMrc = 0
  for (const line of lines) {
    if (line.arcSource) currentMrc += Number(line.arcSource.mrcAmount) || 0
    if (line.action !== 'cancel') newMrc += Number(line.mrcTotal) || 0
  }
  const delta = newMrc - currentMrc
  return { currentMrc, newMrc, delta, deltaPct: currentMrc === 0 ? null : delta / currentMrc }
}

/** Signed percent label for a change ratio: `+12.5%`, `−20%`, or null when ~0 / undefined. */
export function formatChangePct(ratio: number | null): string | null {
  if (ratio === null || Math.abs(ratio) < 0.00005) return null
  const percent = Math.round(Math.abs(ratio) * 1000) / 10
  return ratio > 0 ? `+${percent}%` : `−${percent}%`
}
