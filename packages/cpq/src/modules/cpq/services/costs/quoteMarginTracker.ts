import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqOrderConfiguration, CpqQuoteLineCost, type CpqQuoteConfiguration } from '../../data/entities'
import { ADJUSTMENT_MUTABLE_STATUSES } from '../../data/price-adjustments'
import type { TenantScope } from '../types'
import type { PriceBasisFlags } from './quoteMargin'
import { loadQuoteMarginState } from './quoteCostView'

/**
 * Margin signal of one quote write (App Spec R8, feature spec "Quote margin event").
 * Quote-level aggregates only: never a per-line amount, cost, supplier or markup.
 */
export interface MarginSignal {
  /** Null when the write produced the quote's first cost lines (there was no margin before). */
  previousMarginHash: string | null
  marginHash: string
  /** True when the quote is past `ready` and has no order: an approval given on the old margin no longer holds. */
  approvalInvalidated: boolean
  contractMargin: number
  marginPercent: number | null
  costCoverage: number
  /** Margin flags: any cost line (margin-only included) — what the margin card and `margin_changed` show. */
  hasPendingCosts: boolean
  hasEstimatedCosts: boolean
  hasExpiredCosts: boolean
  /** PRICE-BASIS cost lines only ("indicative" semantics) — what `status_changed` carries. */
  priceBasis: PriceBasisFlags
}

/** Hooks `withQuotePricingWrite` runs inside the write transaction. `after` returns null when nothing was tracked. */
export interface MarginTracker {
  before(tx: EntityManager, quote: CpqQuoteConfiguration): Promise<void>
  after(tx: EntityManager, quote: CpqQuoteConfiguration): Promise<MarginSignal | null>
}

export interface MarginTrackerOptions {
  scope: TenantScope
  /** The tenant toggle `cpq.cost_plus`; off means the tracker is skipped entirely. */
  isEnabled: (tenantId: string) => Promise<boolean>
  /** Cost writes always concern costs: skip the existence query. The caller has already checked the toggle. */
  force?: boolean
}

/**
 * Tracks the margin hash across one write. Skipped (no margin computation) when the toggle is off, or when the quote
 * has no cost lines before the write (ONE indexed existence query on `cpq_quote_line_costs` by quote) and none after
 * it (the same query once more) — so a write that creates the first cost lines still reports its margin.
 */
export function createMarginTracker(options: MarginTrackerOptions): MarginTracker {
  const { scope } = options
  let state: 'off' | 'none_before' | 'tracked' = 'off'
  let previous: string | null = null
  const hasCostLines = async (tx: EntityManager, quote: CpqQuoteConfiguration) => Boolean(await tx.findOne(CpqQuoteLineCost, {
    quoteConfigurationId: quote.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
  }, { fields: ['id'] }))
  return {
    async before(tx, quote) {
      state = 'off'
      previous = null
      if (!options.force) {
        if (!(await options.isEnabled(scope.tenantId))) return
        if (!(await hasCostLines(tx, quote))) { state = 'none_before'; return }
      }
      state = 'tracked'
      previous = (await loadQuoteMarginState(tx, quote, scope)).margin.marginHash
    },
    async after(tx, quote) {
      if (state === 'off') return null
      if (state === 'none_before' && !(await hasCostLines(tx, quote))) return null
      const { margin, priceBasis } = await loadQuoteMarginState(tx, quote, scope)
      const changed = margin.marginHash !== previous
      let approvalInvalidated = false
      if (changed && !(ADJUSTMENT_MUTABLE_STATUSES as readonly string[]).includes(quote.cpqStatus)) {
        const orders = await tx.count(CpqOrderConfiguration, { sourceQuoteId: quote.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
        approvalInvalidated = orders === 0
      }
      return {
        previousMarginHash: previous, marginHash: margin.marginHash, approvalInvalidated,
        contractMargin: margin.contractMargin, marginPercent: margin.marginPercent, costCoverage: margin.costCoverage,
        hasPendingCosts: margin.hasPendingCosts, hasEstimatedCosts: margin.hasEstimatedCosts, hasExpiredCosts: margin.hasExpiredCosts,
        priceBasis,
      }
    },
  }
}
