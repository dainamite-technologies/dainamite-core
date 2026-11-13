import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqOrderConfiguration, CpqQuoteLineCost, type CpqQuoteConfiguration } from '../../data/entities'
import { ADJUSTMENT_MUTABLE_STATUSES } from '../../data/price-adjustments'
import type { TenantScope } from '../types'
import { loadQuoteMargin } from './quoteCostView'

/**
 * Margin signal of one quote write (App Spec R8, feature spec "Quote margin event").
 * Quote-level aggregates only: never a per-line amount, cost, supplier or markup.
 */
export interface MarginSignal {
  previousMarginHash: string
  marginHash: string
  /** True when the quote is past `ready` and has no order: an approval given on the old margin no longer holds. */
  approvalInvalidated: boolean
  contractMargin: number
  marginPercent: number | null
  costCoverage: number
  hasPendingCosts: boolean
  hasEstimatedCosts: boolean
  hasExpiredCosts: boolean
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
 * Tracks the margin hash across one write. Skipped (no margin computation, no further queries) when the toggle is off
 * or the quote has no cost lines: ONE indexed existence query on `cpq_quote_line_costs` by quote.
 */
export function createMarginTracker(options: MarginTrackerOptions): MarginTracker {
  const { scope } = options
  let previous: string | null = null
  return {
    async before(tx, quote) {
      previous = null
      if (!options.force) {
        if (!(await options.isEnabled(scope.tenantId))) return
        const any = await tx.findOne(CpqQuoteLineCost, {
          quoteConfigurationId: quote.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
        }, { fields: ['id'] })
        if (!any) return
      }
      previous = (await loadQuoteMargin(tx, quote, scope)).marginHash
    },
    async after(tx, quote) {
      if (previous === null) return null
      const margin = await loadQuoteMargin(tx, quote, scope)
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
      }
    },
  }
}
