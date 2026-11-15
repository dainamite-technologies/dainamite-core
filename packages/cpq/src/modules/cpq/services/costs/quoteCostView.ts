import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
  CpqQuoteMarkupOverride,
  type CpqQuoteConfiguration,
} from '../../data/entities'
import { isArcTerminationLine } from '../arcLineRemoval'
import { isArcMirrorLine } from '../arcPriceFreeze'
import type { CarriedPrevious } from './arcCostRead'
import type { ResolvedCharge, TenantScope } from '../types'
import { computeQuoteMargin, priceBasisCostFlags, type MarginCost, type MarginLine, type MarginMarkup, type PriceBasisFlags, type QuoteMargin } from './quoteMargin'

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
  return (await loadQuoteMarginState(em, quote, scope)).margin
}

/** The margin plus the price-basis flags the status signal carries, from one load. */
export async function loadQuoteMarginState(em: EntityManager, quote: CpqQuoteConfiguration, scope: TenantScope): Promise<{ margin: QuoteMargin; priceBasis: PriceBasisFlags }> {
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
  // Termination lines (Amend / Renew removals, Cancel-quote lines) accept no cost writes and never bind
  // conversion: their costs must not hold the quote's price-basis / margin flags.
  const terminationIds = new Set(lineConfigs.filter((line) => isArcTerminationLine(line, quote.quoteType)).map((line) => line.quoteLineId))
  const lineIds = new Set(lines.map((line) => line.lineId).filter((id) => !terminationIds.has(id)))
  const marginCosts: MarginCost[] = costs.filter((row) => lineIds.has(row.quoteLineId)).map((row) => ({
    quoteLineId: row.quoteLineId, chargeCode: row.chargeCode, costKey: row.costKey, role: row.role, costType: row.costType,
    valueStatus: row.valueStatus, instanceAmount: row.instanceAmount, currencyCode: row.currencyCode,
    fxRate: row.fxRate, validUntil: row.validUntil,
  }))
  const markups: MarginMarkup[] = overrides.map((row) => ({
    quoteLineId: row.quoteLineId, chargeCode: row.chargeCode, markupRule: row.markupRule, markupValue: row.markupValue,
  }))
  return {
    margin: computeQuoteMargin({ currencyCode: quote.currencyCode, lines, costs: marginCosts, markups, today: today() }),
    priceBasis: priceBasisCostFlags(marginCosts),
  }
}

/**
 * What a user WITHOUT `cpq.costs.view` may see of a cost line: identity, status
 * and expiry. No amount, currency, supplier, validity date, note or markup.
 */
export type CostViewContext = {
  /** Open requests opened before this instant are overdue (`overdueCutoff`); absent = overdue is not computed. */
  overdueCutoff?: Date | null
  /** Q14 eligibility of the cost line's quote line; absent = not computed (the UI then assumes eligible). */
  requestEligible?: boolean
  /** The quote's currency: names the `to` of a missing pair and the target of `convertedInstanceAmount`. */
  quoteCurrencyCode?: string
  /** The carried-from item cost's values (carried lines only; `cpq.costs.view` only, see `loadCarriedPrevious`). */
  previous?: CarriedPrevious
}

export function redactedCostView(row: CpqQuoteLineCost, context: CostViewContext = {}) {
  const requestedAt = row.requestedAt ? new Date(row.requestedAt) : null
  return {
    id: row.id,
    costKey: row.costKey,
    name: row.name,
    role: row.role,
    valueStatus: row.valueStatus,
    expired: isCostExpired(row),
    // ARC flags (booleans only, no values): a cost carried from the subscription, and one that needs renegotiation on a Renew.
    carried: row.origin === 'carried',
    renegotiationDue: row.renegotiationDue === true,
    ...(row.errorCode ? { error: row.errorCode } : {}),
    // Sourcing status projection (feature spec §API Contracts): ids and statuses only, never an amount, supplier or note.
    sourcingStatus: row.sourcingStatus ?? 'not_requested',
    requestSeq: row.requestSeq ?? null,
    requestedAt: requestedAt ? requestedAt.toISOString() : null,
    hasAnswerPending: row.proposedAmount !== null && row.proposedAmount !== undefined,
    overdue: row.sourcingStatus === 'requested' && requestedAt !== null && context.overdueCutoff != null && requestedAt < context.overdueCutoff,
    ...(context.requestEligible !== undefined ? { requestEligible: context.requestEligible } : {}),
  }
}

/** Per-instance amount in the quote currency, 4 dp (`null` without a snapshot: a quote-currency or unconverted cost). */
export function convertedInstanceAmount(instanceAmount: string | number | null | undefined, fxRate: string | number | null | undefined): string | null {
  if (instanceAmount === null || instanceAmount === undefined || fxRate === null || fxRate === undefined || fxRate === '') return null
  return String(Math.round((Number(instanceAmount) * Number(fxRate) + Number.EPSILON) * 10_000) / 10_000)
}

/** The full cost line, for holders of `cpq.costs.view`. */
export function fullCostView(row: CpqQuoteLineCost, context: CostViewContext = {}) {
  return {
    ...redactedCostView(row, context),
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
    // FX snapshot (cost data: only here, never in the redacted view). `convertedInstanceAmount` is in the quote currency.
    quoteCurrencyCode: context.quoteCurrencyCode ?? null,
    fxRate: row.fxRate ?? null,
    fxRateDate: row.fxRateDate ?? null,
    fxRateSource: row.fxRateSource ?? null,
    fxRateDerivation: row.fxRateDerivation ?? null,
    convertedInstanceAmount: convertedInstanceAmount(row.instanceAmount, row.fxRate),
    ...(row.errorCode === 'CURRENCY_NO_RATE' && row.currencyCode && context.quoteCurrencyCode
      ? { errorDetail: { code: row.errorCode, from: row.currencyCode, to: context.quoteCurrencyCode, date: today() } } : {}),
    sourcingStatus: row.sourcingStatus,
    costRequestId: row.costRequestId ?? null,
    requestSeq: row.requestSeq ?? null,
    answeredAt: row.answeredAt ? new Date(row.answeredAt).toISOString() : null,
    declineReason: row.declineReason ?? null,
    proposedAnswer: row.proposedAnswer ?? null,
    requestSupplierId: row.requestSupplierId ?? null,
    requestSupplierName: row.requestSupplierName ?? null,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierQuoteRef: row.supplierQuoteRef,
    validUntil: row.validUntil,
    supplierTermEnd: row.supplierTermEnd,
    supplierMinTermMonths: row.supplierMinTermMonths,
    note: row.note,
    ...(context.previous ? { previous: context.previous } : {}),
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
