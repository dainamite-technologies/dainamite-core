import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteLineCost } from '../../data/entities'
import type { TenantScope } from '../types'
import { isCostExpired } from './quoteCostView'

/**
 * Conversion guard (feature spec "Quote to order conversion", App Spec R7). A price-basis cost that is not
 * `confirmed`, or whose supplier validity ended before the conversion date, blocks conversion with
 * `422 COSTS_NOT_CONFIRMED`. `margin_only` costs never block. The guard does not look at the cost-plus toggle:
 * with the toggle off the lines still exist and still bind (R14).
 */
export type UnconfirmedCostLine = { quoteLineId: string; costKeys: string[] }

type GuardRow = Pick<CpqQuoteLineCost, 'quoteLineId' | 'costKey' | 'role' | 'valueStatus' | 'validUntil'>

/** Pure: the blocking cost keys per quote line, in a stable order. */
export function unconfirmedPriceBasisCosts(rows: GuardRow[], conversionDate: string): UnconfirmedCostLine[] {
  const byLine = new Map<string, string[]>()
  for (const row of rows) {
    if (row.role !== 'price_basis') continue
    if (row.valueStatus === 'confirmed' && !isCostExpired(row, conversionDate)) continue
    byLine.set(row.quoteLineId, [...(byLine.get(row.quoteLineId) ?? []), row.costKey])
  }
  return [...byLine].sort(([a], [b]) => a.localeCompare(b)).map(([quoteLineId, keys]) => ({ quoteLineId, costKeys: keys.sort() }))
}

/** The blocking cost lines of a quote's live lines. Price-basis only, so margin-only costs are not even read. */
export async function loadUnconfirmedPriceBasisCosts(
  em: EntityManager, quoteConfigurationId: string, liveLineIds: string[], scope: TenantScope, conversionDate = new Date().toISOString().slice(0, 10),
): Promise<UnconfirmedCostLine[]> {
  const rows = await em.find(CpqQuoteLineCost, {
    quoteConfigurationId, role: 'price_basis', organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
  })
  const live = new Set(liveLineIds)
  return unconfirmedPriceBasisCosts(rows.filter((row) => live.has(row.quoteLineId)), conversionDate)
}
