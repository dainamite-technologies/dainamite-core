import { createHash } from 'node:crypto'
import { roundTo } from './costPlusPrice'

/**
 * Quote margin (App Spec §1.4.7 R8). Pure: plain inputs in, plain numbers out,
 * nothing stored. Callers map `charges` jsonb + cost lines + markup overrides
 * onto the input shapes below.
 *
 * Conventions
 *  - Amounts are in the quote currency; percentages are PERCENT numbers (50 = 50 %), null when undefined.
 *  - Per-instance charge totals and cost amounts are multiplied by the line quantity.
 *  - Contract horizon = the deal-value horizon of `computeWaterfallSummary`: NRC once, MRC × `termMonths` (12 when unset).
 *    Lines flagged `includeInDeal: false` (ARC mirrors) and usage charges are excluded from the contract figures.
 *  - A cost line with `value_status = none` contributes 0 and leaves its charge uncovered (cost 0, App Spec §1.3).
 *  - Coverage = share of offer deal value carried by covered charges (≥ 1 cost line, every one of them known).
 */

export type MarginCharge = {
  chargeCode: string
  chargeType: 'nrc' | 'mrc' | 'usage' | string
  /** Offer total per instance after rules and manual adjustments; null when unpriced. */
  totalPrice: number | null
}

export type MarginLine = {
  lineId: string
  parentLineId?: string | null
  quantity: number
  termMonths?: number | null
  includeInDeal?: boolean
  charges: MarginCharge[]
}

export type MarginCost = {
  quoteLineId: string
  /** null = a line-level (margin_only) cost, counted on the line. */
  chargeCode: string | null
  costKey: string
  role: string
  costType: 'nrc' | 'mrc' | string
  valueStatus: 'none' | 'estimated' | 'confirmed' | string
  /** Per-instance amount (cost model applied), numeric string or number. */
  instanceAmount: string | number | null
  currencyCode?: string | null
  fxRate?: string | number | null
  /** ISO date `YYYY-MM-DD`. */
  validUntil?: string | null
}

export type MarginMarkup = { quoteLineId: string; chargeCode: string; markupRule: string; markupValue: string | number }

export type MarginFigures = {
  nrcCost: number
  mrcCost: number
  nrcOffer: number
  mrcOffer: number
  nrcMargin: number
  mrcMargin: number
  contractCost: number
  contractOffer: number
  contractMargin: number
  /** contractMargin ÷ contractOffer (null when the offer is 0). */
  marginPercent: number | null
  /** contractMargin ÷ contractCost (null when the cost is 0). */
  markupPercent: number | null
  /** Offer deal value carried by covered charges, in percent (0 when there is no offer value). */
  costCoverage: number
  hasPendingCosts: boolean
  hasEstimatedCosts: boolean
  hasExpiredCosts: boolean
}

export type LineMargin = {
  lineId: string
  /** Own charges + the line's own line-level costs. */
  own: MarginFigures
  /** Own + every bundle descendant (parentLineId tree). */
  rollup: MarginFigures
  charges: Array<{ chargeCode: string; chargeType: string } & MarginFigures>
}

export type QuoteMargin = MarginFigures & { lines: LineMargin[]; marginHash: string }

type Acc = {
  nrcCost: number; mrcCost: number; nrcOffer: number; mrcOffer: number
  contractCost: number; contractOffer: number; coveredOffer: number
  pending: boolean; estimated: boolean; expired: boolean
}
const emptyAcc = (): Acc => ({ nrcCost: 0, mrcCost: 0, nrcOffer: 0, mrcOffer: 0, contractCost: 0, contractOffer: 0, coveredOffer: 0, pending: false, estimated: false, expired: false })
const merge = (target: Acc, source: Acc): Acc => {
  for (const key of ['nrcCost', 'mrcCost', 'nrcOffer', 'mrcOffer', 'contractCost', 'contractOffer', 'coveredOffer'] as const) target[key] += source[key]
  target.pending ||= source.pending
  target.estimated ||= source.estimated
  target.expired ||= source.expired
  return target
}

const R = (value: number) => roundTo(value, 4)
const percent = (part: number, whole: number) => (whole === 0 ? null : R((part / whole) * 100))

function finalize(acc: Acc): MarginFigures {
  const contractMargin = acc.contractOffer - acc.contractCost
  return {
    nrcCost: R(acc.nrcCost), mrcCost: R(acc.mrcCost), nrcOffer: R(acc.nrcOffer), mrcOffer: R(acc.mrcOffer),
    nrcMargin: R(acc.nrcOffer - acc.nrcCost), mrcMargin: R(acc.mrcOffer - acc.mrcCost),
    contractCost: R(acc.contractCost), contractOffer: R(acc.contractOffer), contractMargin: R(contractMargin),
    marginPercent: percent(contractMargin, acc.contractOffer),
    markupPercent: percent(contractMargin, acc.contractCost),
    costCoverage: acc.contractOffer === 0 ? 0 : R((acc.coveredOffer / acc.contractOffer) * 100),
    hasPendingCosts: acc.pending, hasEstimatedCosts: acc.estimated, hasExpiredCosts: acc.expired,
  }
}

const isKnown = (cost: MarginCost) => cost.valueStatus !== 'none' && cost.instanceAmount !== null && cost.instanceAmount !== undefined

/** Cost lines → accumulator (cost side only), × line quantity, over the contract horizon. */
function costAcc(costs: MarginCost[], line: MarginLine, today: string): Acc {
  const acc = emptyAcc()
  const months = line.termMonths ?? 12
  for (const cost of costs) {
    if (!isKnown(cost)) { acc.pending = true; continue }
    if (cost.valueStatus === 'estimated') acc.estimated = true
    if (cost.validUntil && cost.validUntil < today) acc.expired = true
    const total = Number(cost.instanceAmount) * line.quantity
    if (cost.costType === 'nrc') {
      acc.nrcCost += total
      if (line.includeInDeal !== false) acc.contractCost += total
    } else {
      acc.mrcCost += total
      if (line.includeInDeal !== false) acc.contractCost += total * months
    }
  }
  return acc
}

/** Offer side of one charge → accumulator. Usage is excluded. */
function offerAcc(charge: MarginCharge, line: MarginLine): Acc {
  const acc = emptyAcc()
  if (charge.chargeType === 'usage') return acc
  const total = (charge.totalPrice ?? 0) * line.quantity
  if (charge.chargeType === 'nrc') {
    acc.nrcOffer += total
    if (line.includeInDeal !== false) acc.contractOffer += total
  } else {
    acc.mrcOffer += total
    if (line.includeInDeal !== false) acc.contractOffer += total * (line.termMonths ?? 12)
  }
  return acc
}

export function computeQuoteMargin(input: {
  currencyCode: string
  lines: MarginLine[]
  costs: MarginCost[]
  markups?: MarginMarkup[]
  /** ISO date `YYYY-MM-DD` used for the expiry flag. */
  today: string
}): QuoteMargin {
  const { lines, costs, today } = input
  const costsByLine = new Map<string, MarginCost[]>()
  for (const cost of costs) costsByLine.set(cost.quoteLineId, [...(costsByLine.get(cost.quoteLineId) ?? []), cost])

  const ownAcc = new Map<string, Acc>()
  const lineResults = new Map<string, LineMargin>()
  for (const line of lines) {
    const lineCosts = costsByLine.get(line.lineId) ?? []
    const acc = costAcc(lineCosts.filter((cost) => cost.chargeCode === null), line, today)
    const chargeResults: LineMargin['charges'] = []
    // Cost lines pointing at a charge the line no longer has still cost money: they count on the line.
    const chargeCodes = new Set(line.charges.map((charge) => charge.chargeCode))
    merge(acc, costAcc(lineCosts.filter((cost) => cost.chargeCode !== null && !chargeCodes.has(cost.chargeCode)), line, today))
    for (const charge of line.charges) {
      const chargeCosts = lineCosts.filter((cost) => cost.chargeCode === charge.chargeCode)
      const chargeAcc = merge(costAcc(chargeCosts, line, today), offerAcc(charge, line))
      if (chargeCosts.length > 0 && chargeCosts.every(isKnown)) chargeAcc.coveredOffer = chargeAcc.contractOffer
      chargeResults.push({ chargeCode: charge.chargeCode, chargeType: charge.chargeType, ...finalize(chargeAcc) })
      merge(acc, chargeAcc)
    }
    ownAcc.set(line.lineId, acc)
    lineResults.set(line.lineId, { lineId: line.lineId, own: finalize(acc), rollup: finalize(acc), charges: chargeResults })
  }

  // Roll-up: own + every descendant (cycle-safe).
  const children = new Map<string, string[]>()
  for (const line of lines) if (line.parentLineId && ownAcc.has(line.parentLineId)) children.set(line.parentLineId, [...(children.get(line.parentLineId) ?? []), line.lineId])
  for (const line of lines) {
    const total = emptyAcc()
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      merge(total, ownAcc.get(id)!)
      for (const child of children.get(id) ?? []) walk(child)
    }
    walk(line.lineId)
    lineResults.get(line.lineId)!.rollup = finalize(total)
  }

  const quoteAcc = emptyAcc()
  for (const acc of ownAcc.values()) merge(quoteAcc, acc)

  return { ...finalize(quoteAcc), lines: lines.map((line) => lineResults.get(line.lineId)!), marginHash: computeMarginHash(input) }
}

const canonicalNumber = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? null : R(Number(value)))

/**
 * Hash over cost values, markups and offers ONLY. Statuses are excluded, so
 * confirming an unchanged value (or any status-only change) keeps the hash and
 * never invalidates a margin approval.
 */
export function computeMarginHash(input: { currencyCode: string; lines: MarginLine[]; costs: MarginCost[]; markups?: MarginMarkup[] }): string {
  const sortKey = (...parts: Array<string | null | undefined>) => parts.map((part) => part ?? '').join('\u0000')
  const payload = {
    currencyCode: input.currencyCode,
    costs: input.costs
      .map((cost) => ({
        line: cost.quoteLineId, charge: cost.chargeCode ?? null, key: cost.costKey, role: cost.role, type: cost.costType,
        amount: canonicalNumber(cost.instanceAmount), currency: cost.currencyCode ?? null, fx: canonicalNumber(cost.fxRate),
      }))
      .sort((a, b) => sortKey(a.line, a.key).localeCompare(sortKey(b.line, b.key))),
    markups: (input.markups ?? [])
      .map((markup) => ({ line: markup.quoteLineId, charge: markup.chargeCode, rule: markup.markupRule, value: canonicalNumber(markup.markupValue) }))
      .sort((a, b) => sortKey(a.line, a.charge).localeCompare(sortKey(b.line, b.charge))),
    offers: input.lines
      .flatMap((line) => line.charges.map((charge) => ({ line: line.lineId, quantity: line.quantity, charge: charge.chargeCode, type: charge.chargeType, total: canonicalNumber(charge.totalPrice) })))
      .sort((a, b) => sortKey(a.line, a.charge, a.type).localeCompare(sortKey(b.line, b.charge, b.type))),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
