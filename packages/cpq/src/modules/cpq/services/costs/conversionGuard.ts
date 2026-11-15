import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteLineCost } from '../../data/entities'
import type { TenantScope } from '../types'
import { isCostExpired } from './quoteCostView'

/**
 * Conversion guard (feature spec "Quote to order conversion", App Spec R7). A price-basis cost that is not
 * `confirmed`, or whose supplier validity ended before the conversion date, blocks conversion with
 * `422 COSTS_NOT_CONFIRMED`. So does a cost-plus charge stored without a price (`unitPrice` null): pending or
 * missing price-basis costs, no applicable price-basis element, the toggle off, or a line added to a locked
 * quote that never got cost lines — the guard never relies on cost rows existing. `margin_only` costs never
 * block. The guard does not look at the cost-plus toggle: with the toggle off the lines still exist and still
 * bind (R14).
 */
export type UnconfirmedCostLine = {
  quoteLineId: string
  /** Blocking price-basis cost keys (may be empty when only a charge is unpriced). */
  costKeys: string[]
  /** Cost-plus charges of the line stored without a price (additive; may be empty). */
  chargeCodes: string[]
}

type GuardRow = Pick<CpqQuoteLineCost, 'quoteLineId' | 'costKey' | 'role' | 'valueStatus' | 'validUntil'> & Partial<Pick<CpqQuoteLineCost, 'proposedAmount'>>

/** A price-basis cost line with an unapplied supplier proposal blocks conversion with `422 COST_ANSWER_PENDING`. */
export type PendingAnswerLine = { quoteLineId: string; costKeys: string[] }

/** Pure: price-basis cost lines of live quote lines that hold an unapplied proposal (`proposed_amount`), per line, stable order. */
export function pendingAnswerCosts(rows: GuardRow[], liveLineIds: Iterable<string>): PendingAnswerLine[] {
  const live = new Set(liveLineIds)
  const byLine = new Map<string, string[]>()
  for (const row of rows) {
    if (row.role !== 'price_basis' || row.proposedAmount === null || row.proposedAmount === undefined || !live.has(row.quoteLineId)) continue
    byLine.set(row.quoteLineId, [...(byLine.get(row.quoteLineId) ?? []), row.costKey])
  }
  return [...byLine].sort(([a], [b]) => a.localeCompare(b)).map(([quoteLineId, keys]) => ({ quoteLineId, costKeys: keys.sort() }))
}
/** A line as the guard reads it: its id and the stored `charges` snapshot of the last saved recalculation. */
export type GuardLine = { quoteLineId: string; charges?: unknown }

/** Pure: the blocking cost keys per quote line, in a stable order. */
export function unconfirmedPriceBasisCosts(rows: GuardRow[], conversionDate: string): Array<{ quoteLineId: string; costKeys: string[] }> {
  const byLine = new Map<string, string[]>()
  for (const row of rows) {
    if (row.role !== 'price_basis') continue
    if (row.valueStatus === 'confirmed' && !isCostExpired(row, conversionDate)) continue
    byLine.set(row.quoteLineId, [...(byLine.get(row.quoteLineId) ?? []), row.costKey])
  }
  return [...byLine].sort(([a], [b]) => a.localeCompare(b)).map(([quoteLineId, keys]) => ({ quoteLineId, costKeys: keys.sort() }))
}

/** Pure: the cost-plus charge codes each line stores without a price. */
export function unpricedCostPlusCharges(lines: GuardLine[]): Map<string, string[]> {
  const byLine = new Map<string, string[]>()
  for (const line of lines) {
    if (!Array.isArray(line.charges)) continue
    const codes = (line.charges as Array<Record<string, unknown>>)
      .filter((charge) => charge?.pricingMethod === 'cost_plus' && (charge.unitPrice === null || charge.unitPrice === undefined))
      .map((charge) => String(charge.chargeCode))
    if (codes.length) byLine.set(line.quoteLineId, codes.sort())
  }
  return byLine
}

/** Pure: both blocker kinds merged per line, sorted by line id. */
export function conversionCostBlockers(lines: GuardLine[], rows: GuardRow[], conversionDate: string): UnconfirmedCostLine[] {
  const live = new Set(lines.map((line) => line.quoteLineId))
  const byLine = new Map<string, UnconfirmedCostLine>()
  const entry = (quoteLineId: string) => byLine.get(quoteLineId)
    ?? byLine.set(quoteLineId, { quoteLineId, costKeys: [], chargeCodes: [] }).get(quoteLineId)!
  for (const { quoteLineId, costKeys } of unconfirmedPriceBasisCosts(rows.filter((row) => live.has(row.quoteLineId)), conversionDate)) {
    entry(quoteLineId).costKeys = costKeys
  }
  for (const [quoteLineId, chargeCodes] of unpricedCostPlusCharges(lines)) entry(quoteLineId).chargeCodes = chargeCodes
  return [...byLine.values()].sort((a, b) => a.quoteLineId.localeCompare(b.quoteLineId))
}

/**
 * What blocks converting a quote's binding lines (the caller leaves out ARC cancel lines). Price-basis cost
 * rows only, so margin-only costs are not even read; the charges come from the lines' stored snapshots.
 */
export async function loadConversionCostBlockers(
  em: EntityManager, quoteConfigurationId: string, lines: GuardLine[], scope: TenantScope, conversionDate = new Date().toISOString().slice(0, 10),
): Promise<UnconfirmedCostLine[]> {
  return (await loadConversionBlockers(em, quoteConfigurationId, lines, scope, conversionDate)).unconfirmed
}

/** Both conversion refusals from ONE read of the price-basis rows: unconfirmed costs and pending supplier answers. */
export async function loadConversionBlockers(
  em: EntityManager, quoteConfigurationId: string, lines: GuardLine[], scope: TenantScope, conversionDate = new Date().toISOString().slice(0, 10),
): Promise<{ unconfirmed: UnconfirmedCostLine[]; pendingAnswers: PendingAnswerLine[] }> {
  const rows = await em.find(CpqQuoteLineCost, {
    quoteConfigurationId, role: 'price_basis', organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
  })
  return {
    unconfirmed: conversionCostBlockers(lines, rows, conversionDate),
    pendingAnswers: pendingAnswerCosts(rows, lines.map((line) => line.quoteLineId)),
  }
}
