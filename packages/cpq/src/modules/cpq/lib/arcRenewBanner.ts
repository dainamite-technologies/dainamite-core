/**
 * Pure view helper for the Renew banner (feature spec §UI/UX): frozen cost-plus mirror lines keep their
 * contracted price. Shown to every user; the text carries no amounts. Client-safe.
 */
export interface ArcBannerLine {
  action?: string | null
  configuration?: Record<string, unknown> | null
}

/** A Renew mirror line that is still frozen because its source item is cost-plus (un-freezing drops both markers' effect). */
export function isFrozenCostPlusRenewLine(line: ArcBannerLine): boolean {
  if (line.action === 'cancel') return false
  const config = line.configuration
  return config?._arcPriceFrozen === true && config?._arcCostPlusFrozen === true
}

export function shouldShowRenewCostBanner(quoteType: string | null | undefined, lines: ArcBannerLine[]): boolean {
  return quoteType === 'renew' && lines.some(isFrozenCostPlusRenewLine)
}
