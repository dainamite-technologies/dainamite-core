import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
  CpqQuoteMarkupOverride,
  type CpqQuoteConfiguration,
} from '../../data/entities'
import { isArcMirrorLine } from '../arcPriceFreeze'
import type { ResolvedCharge, TenantScope } from '../types'
import { computeQuoteMargin, type MarginCost, type MarginLine, type MarginMarkup, type QuoteMargin } from './quoteMargin'

/** Loads and shapes quote cost data for the read API and the write results. */

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const today = () => new Date().toISOString().slice(0, 10)

export const isCostExpired = (row: Pick<CpqQuoteLineCost, 'validUntil'>, now = today()): boolean => Boolean(row.validUntil) && (row.validUntil as string) < now

/** Cost lines of a quote, in a stable order. */
export async function loadQuoteCosts(em: EntityManager, quoteConfigurationId: string, scope: TenantScope): Promise<CpqQuoteLineCost[]> {
  const rows = await em.find(CpqQuoteLineCost, { ...scoped(scope), quoteConfigurationId })
  return [...rows].sort((a, b) => a.quoteLineId.localeCompare(b.quoteLineId) || a.costKey.localeCompare(b.costKey))
}

export async function loadQuoteMarkupOverrides(em: EntityManager, quoteConfigurationId: string, scope: TenantScope): Promise<CpqQuoteMarkupOverride[]> {
  const rows = await em.find(CpqQuoteMarkupOverride, { ...scoped(scope), quoteConfigurationId })
  return [...rows].sort((a, b) => a.quoteLineId.localeCompare(b.quoteLineId) || a.chargeCode.localeCompare(b.chargeCode))
}

/** Margin of the stored quote (App Spec R8): computed on read, never stored. */
export async function loadQuoteMargin(em: EntityManager, quote: CpqQuoteConfiguration, scope: TenantScope): Promise<QuoteMargin> {
  const [lineConfigs, costs, overrides] = await Promise.all([
    em.find(CpqQuoteLineConfiguration, { quoteConfigurationId: quote.id, ...scoped(scope) }),
    loadQuoteCosts(em, quote.id, scope),
    loadQuoteMarkupOverrides(em, quote.id, scope),
  ])
  const lines: MarginLine[] = lineConfigs.map((line) => ({
    lineId: line.quoteLineId,
    parentLineId: line.parentLineId ?? null,
    quantity: Number(line.quantity),
    termMonths: line.termMonths ?? null,
    includeInDeal: !isArcMirrorLine(line.configuration, quote.quoteType),
    charges: ((line.charges ?? []) as unknown as ResolvedCharge[]).map((charge) => ({
      chargeCode: charge.chargeCode, chargeType: charge.chargeType, totalPrice: charge.totalPrice ?? null,
    })),
  }))
  const lineIds = new Set(lines.map((line) => line.lineId))
  const marginCosts: MarginCost[] = costs.filter((row) => lineIds.has(row.quoteLineId)).map((row) => ({
    quoteLineId: row.quoteLineId, chargeCode: row.chargeCode, costKey: row.costKey, role: row.role, costType: row.costType,
    valueStatus: row.valueStatus, instanceAmount: row.instanceAmount, currencyCode: row.currencyCode,
    fxRate: row.fxRate, validUntil: row.validUntil,
  }))
  const markups: MarginMarkup[] = overrides.map((row) => ({
    quoteLineId: row.quoteLineId, chargeCode: row.chargeCode, markupRule: row.markupRule, markupValue: row.markupValue,
  }))
  return computeQuoteMargin({ currencyCode: quote.currencyCode, lines, costs: marginCosts, markups, today: today() })
}

/**
 * What a user WITHOUT `cpq.costs.view` may see of a cost line: identity, status
 * and expiry. No amount, currency, supplier, validity date, note or markup.
 */
export function redactedCostView(row: CpqQuoteLineCost) {
  return {
    id: row.id,
    costKey: row.costKey,
    name: row.name,
    role: row.role,
    valueStatus: row.valueStatus,
    expired: isCostExpired(row),
    ...(row.errorCode ? { error: row.errorCode } : {}),
  }
}

/** The full cost line, for holders of `cpq.costs.view`. */
export function fullCostView(row: CpqQuoteLineCost) {
  return {
    ...redactedCostView(row),
    quoteLineId: row.quoteLineId,
    chargeCode: row.chargeCode,
    origin: row.origin,
    costElementId: row.costElementId,
    costType: row.costType,
    source: row.source,
    costModel: row.costModel,
    valueOrigin: row.valueOrigin,
    unitAmount: row.unitAmount,
    instanceAmount: row.instanceAmount,
    currencyCode: row.currencyCode,
    sourcingStatus: row.sourcingStatus,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierQuoteRef: row.supplierQuoteRef,
    validUntil: row.validUntil,
    supplierTermEnd: row.supplierTermEnd,
    supplierMinTermMonths: row.supplierMinTermMonths,
    note: row.note,
  }
}
export type FullCostView = ReturnType<typeof fullCostView>
export type RedactedCostView = ReturnType<typeof redactedCostView>

export function markupOverrideView(row: CpqQuoteMarkupOverride) {
  return { id: row.id, quoteLineId: row.quoteLineId, chargeCode: row.chargeCode, markupRule: row.markupRule, markupValue: row.markupValue, note: row.note }
}
export type MarkupOverrideView = ReturnType<typeof markupOverrideView>

/** Groups cost lines by quote line and projects each one (lines without costs are omitted). */
export function groupByLine<T>(rows: CpqQuoteLineCost[], project: (row: CpqQuoteLineCost) => T): Array<{ quoteLineId: string; costs: T[] }> {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(row.quoteLineId, [...(groups.get(row.quoteLineId) ?? []), project(row)])
  return [...groups].map(([quoteLineId, costs]) => ({ quoteLineId, costs }))
}
