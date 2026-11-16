/**
 * Pure view helper for the Renew banner (feature spec §UI/UX): frozen cost-plus mirror lines keep their
 * contracted price. Shown to every user; the text carries no amounts. Client-safe.
 */
export interface ArcBannerLine {
  action?: string | null
  configuration?: Record<string, unknown> | null
  /** `null` on a merge-renew line (it acts on no single subscription). */
  targetSubscriptionId?: string | null
}

/** A Renew mirror line that is still frozen because its source item is cost-plus (un-freezing drops both markers' effect). */
export function isFrozenCostPlusRenewLine(line: ArcBannerLine): boolean {
  if (line.action === 'cancel') return false
  const config = line.configuration
  return config?._arcPriceFrozen === true && config?._arcCostPlusFrozen === true
}

/**
 * A Phase 1 standalone Renew line (ARC costs spec Q6): created before cost carry-over, still frozen. New standalone Renew
 * lines are not frozen and carry their costs; merge-renew lines have their own notice.
 */
export function isPhase1RenewLine(line: ArcBannerLine): boolean {
  return isFrozenCostPlusRenewLine(line) && line.targetSubscriptionId !== null
}

/** The quote-level banner is kept only for Phase 1 frozen lines; a new standalone Renew shows none. */
export function shouldShowRenewCostBanner(quoteType: string | null | undefined, lines: ArcBannerLine[]): boolean {
  return quoteType === 'renew' && lines.some(isPhase1RenewLine)
}
