/**
 * Pure view helpers for the cost-plus parts of the quote page (feature spec
 * §UI/UX). Client-safe: type-only imports from the services. Mirrors the
 * server's lock matrix for display only; the API stays the authority.
 */
import type { MarginFigures, QuoteMargin } from '../services/costs/quoteMargin'

/** Same set `isQuoteCostLocked` uses: costs that change the price are editable only in these statuses. */
export const COST_EDITABLE_STATUSES = ['new', 'incomplete', 'ready'] as const

/** What every user with `cpq.quotes.view` gets for a cost line. */
export type RedactedQuoteCost = {
  id: string
  costKey: string
  name: string
  role: 'price_basis' | 'margin_only' | string
  valueStatus: 'none' | 'estimated' | 'confirmed' | string
  expired: boolean
  error?: string
}

/** The full cost line, `cpq.costs.view` only. Decimals are strings. */
export type FullQuoteCost = RedactedQuoteCost & {
  quoteLineId: string
  chargeCode: string | null
  origin: 'catalog' | 'manual' | string
  costType: 'nrc' | 'mrc' | string
  source: 'fixed' | 'table' | 'on_request' | string
  costModel: string
  unitAmount: string | null
  instanceAmount: string | null
  currencyCode: string | null
  supplierName: string | null
  supplierQuoteRef: string | null
  validUntil: string | null
  supplierTermEnd: string | null
  supplierMinTermMonths: number | null
  note: string | null
}

export type QuoteMarkupOverride = { id: string; quoteLineId: string; chargeCode: string; markupRule: string; markupValue: string; note: string | null }

export type QuoteCostsResponse = {
  lines: Array<{ quoteLineId: string; costs: Array<RedactedQuoteCost | FullQuoteCost> }>
  pricingRevision: number
  markupOverrides?: QuoteMarkupOverride[]
  margin?: QuoteMargin
}

export const isFullCost = (cost: RedactedQuoteCost | FullQuoteCost): cost is FullQuoteCost => 'unitAmount' in cost

export type CostBadge = 'pending' | 'estimated' | 'expired'

export const COST_BADGE_FALLBACKS: Record<CostBadge, string> = {
  pending: 'Cost pending',
  estimated: 'Estimated',
  expired: 'Expired cost',
}

/** Badges for one line, in a stable order. Text, never colour alone (the caller renders the label). */
export function lineCostBadges(costs: ReadonlyArray<Pick<RedactedQuoteCost, 'valueStatus' | 'expired'>>): CostBadge[] {
  const badges: CostBadge[] = []
  if (costs.some((cost) => cost.valueStatus === 'none')) badges.push('pending')
  if (costs.some((cost) => cost.valueStatus === 'estimated')) badges.push('estimated')
  if (costs.some((cost) => cost.expired)) badges.push('expired')
  return badges
}

/** The quote is indicative while any price-basis cost is only an estimate. */
export function isQuoteIndicative(lines: ReadonlyArray<{ costs: ReadonlyArray<Pick<RedactedQuoteCost, 'role' | 'valueStatus'>> }>): boolean {
  return lines.some((line) => line.costs.some((cost) => cost.role === 'price_basis' && cost.valueStatus === 'estimated'))
}

export const isCostLocked = (cpqStatus: string, convertedOrderId?: string | null): boolean =>
  Boolean(convertedOrderId) || !(COST_EDITABLE_STATUSES as readonly string[]).includes(cpqStatus)

export const COST_STATUS_FALLBACKS: Record<string, string> = { none: 'Cost pending', estimated: 'Estimated', confirmed: 'Confirmed' }
export const COST_ROLE_FALLBACKS: Record<string, string> = { price_basis: 'Price basis', margin_only: 'Margin only' }
export const COST_SOURCE_FALLBACKS: Record<string, string> = { fixed: 'Fixed', table: 'Cost table', on_request: 'On request', manual: 'Manual' }

/** How an unpriced cost-plus charge is shown: "≈ fallback" while a fallback exists, else "Price on request". */
export function unpricedChargeLabel(charge: { fallbackPrice?: number | null }): { kind: 'approx'; amount: number } | { kind: 'on_request' } {
  return typeof charge.fallbackPrice === 'number' ? { kind: 'approx', amount: charge.fallbackPrice } : { kind: 'on_request' }
}

export const isUnpricedCostPlus = (charge: { pricingMethod?: string | null; unitPrice?: number | null }): boolean =>
  charge.pricingMethod === 'cost_plus' && (charge.unitPrice === null || charge.unitPrice === undefined)

/** Percent number (0–100) or null → "42.5%" / "—". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`
}

export type { MarginFigures, QuoteMargin }
