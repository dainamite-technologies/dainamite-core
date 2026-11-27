import { isLineAmountType, type AdjustmentError, type PriceAdjustment } from '../../data/price-adjustments'
import type { ResolvedCharge } from '../types'
import { withChargeWaterfall } from './chargeWaterfall'
import { spreadAmount } from './spreadAmount'
import {
  compactSchedule, isActiveInMonth, isPhasedRange, normalizeRange, scheduleRanges, segmentAt, segmentsFor,
  type ChargeScheduleSegment,
} from '../../lib/priceSchedule'

export interface AdjustmentPricingLine {
  lineId: string
  parentLineId: string | null
  enginePriced: boolean
  mirrored: boolean
  /** Line quantity; a line-level amount is the line total over all of them. Defaults to 1. */
  quantity?: number
  /** Line term in months; a phase may not pass it (PHASE_PAST_TERM). Unknown = not checked. */
  termMonths?: number | null
  charges: ResolvedCharge[]
}

type OutputCharge = ResolvedCharge & { adjustments: NonNullable<ResolvedCharge['adjustments']>; adjustmentErrors: AdjustmentError[] }
type OutputLine = Omit<AdjustmentPricingLine, 'charges'> & { charges: OutputCharge[] }
type ChargeRef = { line: OutputLine; charge: OutputCharge }

const eligible = (line: AdjustmentPricingLine) => line.enginePriced && !line.mirrored
const lineQuantity = (line: AdjustmentPricingLine) => line.quantity ?? 1
/** Volume / tiered charges have no single unit price: a Set price there sets the charge total. */
export const setsChargeTotal = (charge: Pick<ResolvedCharge, 'pricingMethod'>) =>
  charge.pricingMethod === 'volume' || charge.pricingMethod === 'tiered'

/**
 * Most-specific valid manual adjustment wins (charge > own line > nearest
 * bundle ancestor); each is evaluated against the standard price and never
 * compounded. Any price is allowed, also above standard (spec F-D1).
 *
 * Resolution runs per adjustment target:
 * 1. pick the winner for every charge (`pickWinners`);
 * 2. apply charge targets and line % off directly per charge (`applyToCharge`);
 * 3. spread line-level Set price / Amount off over the charges each one won
 *    (`applyLineSpread`), deepest target line first, so the line (or bundle)
 *    total equals the typed price even when more specific adjustments fix
 *    some of its charges (spec F-D3).
 */
export function resolveManualAdjustments(
  lines: AdjustmentPricingLine[],
  adjustments: PriceAdjustment[],
  currencyCode: string,
): { lines: AdjustmentPricingLine[]; errors: AdjustmentError[] } {
  const phased = adjustments.filter(isPhasedRange)
  const scheduled = lines.some((line) => line.charges.some((charge) => charge.schedule?.length))
  if (!phased.length && !scheduled) return resolveSegment(lines, adjustments, currencyCode)

  // Price phases (spec P, §4.3): the waterfall runs once per month segment.
  // Phases that can never apply are rejected up front, for every segment.
  const errors: AdjustmentError[] = []
  const rejected = new Set<string>()
  const byId = new Map(lines.map((line) => [line.lineId, line]))
  for (const row of phased) {
    const target = byId.get(row.quoteLineId)
    if (!target || !eligible(target)) continue // reported by the segment pass
    const { fromMonth, toMonth } = normalizeRange(row)
    const term = target.termMonths ?? null
    if (term && (fromMonth > term || (toMonth !== null && toMonth > term))) {
      errors.push({ adjustmentId: row.id, quoteLineId: row.quoteLineId, ...(row.chargeCode ? { chargeCode: row.chargeCode } : {}), code: 'PHASE_PAST_TERM' })
      rejected.add(row.id)
      continue
    }
    const recurringOnly = row.level === 'line' ? row.chargeTypeFilter === 'mrc'
      : target.charges.filter((charge) => charge.chargeCode === row.chargeCode).every((charge) => charge.chargeType === 'mrc')
    if (!recurringOnly) {
      errors.push({ adjustmentId: row.id, quoteLineId: row.quoteLineId, ...(row.chargeCode ? { chargeCode: row.chargeCode } : {}), code: 'PHASE_RECURRING_ONLY' })
      rejected.add(row.id)
    }
  }
  const active = adjustments.filter((row) => !rejected.has(row.id))
  const segments = segmentsFor([
    ...active.filter(isPhasedRange),
    ...lines.flatMap((line) => line.charges.flatMap((charge) => scheduleRanges(charge.schedule))),
  ])
  const results = segments.map((segment) => resolveSegment(
    lines.map((line) => ({ ...line, charges: line.charges.map((charge) => chargeAtMonth(charge, segment.fromMonth)) })),
    active.filter((row) => isActiveInMonth(row, segment.fromMonth)),
    currencyCode,
  ))
  const regular = results.at(-1)!
  for (const result of results) {
    for (const error of result.errors) {
      if (!errors.some((entry) => entry.adjustmentId === error.adjustmentId && entry.quoteLineId === error.quoteLineId && entry.chargeCode === error.chargeCode && entry.code === error.code)) errors.push(error)
    }
  }
  const out = regular.lines.map((line, lineIndex) => ({
    ...line,
    charges: line.charges.map((charge, chargeIndex) => {
      const chargeErrors = errors.filter((error) => error.quoteLineId === line.lineId && (!error.chargeCode || error.chargeCode === charge.chargeCode))
      const input = lines[lineIndex].charges[chargeIndex]
      const { schedule: _ignored, ...rest } = charge
      const merged = { ...rest, adjustmentErrors: chargeErrors }
      if (charge.chargeType !== 'mrc') return merged
      const schedule = compactSchedule(segments.map((segment, at): ChargeScheduleSegment => {
        const segmentCharge = results[at].lines[lineIndex].charges[chargeIndex]
        const ruleSegment = input.schedule ? segmentAt(input.schedule, segment.fromMonth) : undefined
        const manual = segmentCharge.adjustments?.find((entry) => entry.origin === 'manual')
        const row = manual?.adjustmentId ? active.find((entry) => entry.id === manual.adjustmentId) : undefined
        const ruleCodes = ruleSegment?.ruleCodes ?? (segmentCharge.adjustments ?? []).filter((entry) => entry.origin !== 'manual').map((entry) => entry.ruleCode)
        return {
          fromMonth: segment.fromMonth, toMonth: segment.toMonth,
          unitPrice: segmentCharge.unitPrice, totalPrice: segmentCharge.totalPrice,
          standardUnitPrice: segmentCharge.standardUnitPrice ?? segmentCharge.unitPrice,
          standardTotalPrice: segmentCharge.standardTotalPrice !== undefined ? segmentCharge.standardTotalPrice : segmentCharge.totalPrice,
          source: manual ? 'manual' : ruleSegment?.source ?? (ruleCodes.length ? 'rule' : 'list'),
          name: manual ? (row?.phaseName ?? null) : ruleSegment?.name ?? null,
          ...(ruleCodes.length ? { ruleCodes } : {}),
          ...(manual?.adjustmentId ? { adjustmentId: manual.adjustmentId } : {}),
        }
      }))
      return schedule ? { ...merged, schedule } : merged
    }),
  }))
  return { lines: out, errors }
}

/** The charge as priced in `month`: its standard (and stored offer) price of that segment, without a schedule. */
function chargeAtMonth(charge: ResolvedCharge, month: number): ResolvedCharge {
  const { schedule, ...rest } = charge
  const segment = schedule?.length ? segmentAt(schedule, month) : undefined
  if (!segment) return rest
  return { ...rest, unitPrice: segment.unitPrice, totalPrice: segment.totalPrice,
    standardUnitPrice: segment.standardUnitPrice, standardTotalPrice: segment.standardTotalPrice }
}

/** One month segment: the waterfall with the adjustments in force in it (spec F). */
function resolveSegment(
  lines: AdjustmentPricingLine[],
  adjustments: PriceAdjustment[],
  currencyCode: string,
): { lines: AdjustmentPricingLine[]; errors: AdjustmentError[] } {
  const errors: AdjustmentError[] = []
  const byId = new Map(lines.map((line) => [line.lineId, line]))
  const output: OutputLine[] = lines.map((line) => ({
    ...line,
    charges: line.charges.map((charge) => {
      const normalized = withChargeWaterfall(charge)
      return { ...normalized, unitPrice: eligible(line) ? normalized.standardUnitPrice! : normalized.unitPrice,
        totalPrice: eligible(line) ? normalized.standardTotalPrice! : normalized.totalPrice,
        adjustments: (eligible(line) ? normalized.adjustments?.filter((entry) => entry.origin !== 'manual') : normalized.adjustments) ?? [], adjustmentErrors: [] as AdjustmentError[] }
    }),
  }))
  const outById = new Map(output.map((line) => [line.lineId, line]))
  const addError = (row: PriceAdjustment, code: AdjustmentError['code'], chargeCode?: string, lineId = row.quoteLineId) => {
    if (errors.some((entry) => entry.adjustmentId === row.id && entry.quoteLineId === lineId && entry.chargeCode === chargeCode && entry.code === code)) return
    const error: AdjustmentError = { adjustmentId: row.id, quoteLineId: lineId, ...(chargeCode ? { chargeCode } : {}), code }
    errors.push(error)
    for (const charge of outById.get(lineId)?.charges ?? []) {
      if (!chargeCode || charge.chargeCode === chargeCode) charge.adjustmentErrors.push(error)
    }
  }
  const lineageOf = (line: AdjustmentPricingLine): string[] => {
    const lineage: string[] = []
    const visited = new Set<string>([line.lineId])
    let parent = line.parentLineId
    while (parent && !visited.has(parent)) {
      visited.add(parent); lineage.push(parent); parent = byId.get(parent)?.parentLineId ?? null
    }
    return lineage
  }
  const lineages = new Map(output.map((line) => [line.lineId, lineageOf(line)]))

  // Missing/ambiguous targets are invalid even if another adjustment could win.
  const invalid = new Set<string>()
  for (const row of adjustments) {
    const target = byId.get(row.quoteLineId)
    let code: AdjustmentError['code'] | undefined
    if (!target) code = 'ADJUSTMENT_TARGET_MISSING'
    else if (!eligible(target)) code = 'LINE_NOT_ELIGIBLE'
    else if (row.level === 'charge') {
      const matches = target.charges.filter((charge) => charge.chargeCode === row.chargeCode)
      if (!matches.length) code = 'ADJUSTMENT_TARGET_MISSING'
      else if (matches.length > 1) code = 'TARGET_AMBIGUOUS'
    }
    if (code) { addError(row, code, row.chargeCode ?? undefined); invalid.add(row.id) }
  }

  const winners = pickWinners(output, adjustments, invalid, lineages, currencyCode, addError)

  // 2. Charge targets and line % off: per charge, independent of other charges.
  const spreads = new Map<string, { row: PriceAdjustment; won: ChargeRef[] }>()
  for (const { ref, row } of winners.values()) {
    if (row.level === 'line' && isLineAmountType(row.adjustmentType)) {
      const group = spreads.get(row.id) ?? { row, won: [] }
      group.won.push(ref)
      spreads.set(row.id, group)
    } else applyToCharge(row, ref.charge)
  }

  // 3. Line Set price / Amount off, deepest target first: a component line's own
  // spread is final before its bundle parent counts it as a fixed charge.
  const depth = (lineId: string) => lineages.get(lineId)?.length ?? 0
  const ordered = [...spreads.values()].sort((a, b) => depth(b.row.quoteLineId) - depth(a.row.quoteLineId) || a.row.id.localeCompare(b.row.id))
  for (const { row, won } of ordered) {
    const scope: ChargeRef[] = []
    for (const line of output) {
      if (!eligible(line) || (line.lineId !== row.quoteLineId && !lineages.get(line.lineId)!.includes(row.quoteLineId))) continue
      for (const charge of line.charges) if (charge.chargeType === row.chargeTypeFilter) scope.push({ line, charge })
    }
    applyLineSpread(row, scope, won)
  }
  return { lines: output, errors }
}

function pickWinners(
  output: OutputLine[],
  adjustments: PriceAdjustment[],
  invalid: Set<string>,
  lineages: Map<string, string[]>,
  currencyCode: string,
  addError: (row: PriceAdjustment, code: AdjustmentError['code'], chargeCode?: string, lineId?: string) => void,
): Map<OutputCharge, { ref: ChargeRef; row: PriceAdjustment }> {
  // Insertion order = quote line order, then charge order ("first charge" for an all-zero spread).
  const winners = new Map<OutputCharge, { ref: ChargeRef; row: PriceAdjustment }>()
  for (const line of output) {
    if (!eligible(line)) continue
    const lineage = lineages.get(line.lineId)!
    // Declared before use: `.sort()` below calls it eagerly (a `const` after it would hit the TDZ).
    const rank = (row: PriceAdjustment) =>
      row.level === 'charge' ? 0 : row.quoteLineId === line.lineId ? 1 : 2 + lineage.indexOf(row.quoteLineId)
    for (const charge of line.charges) {
      const candidates = adjustments.filter((row) => !invalid.has(row.id) && (
        row.level === 'charge'
          ? row.quoteLineId === line.lineId && row.chargeCode === charge.chargeCode
          : (row.quoteLineId === line.lineId || lineage.includes(row.quoteLineId)) &&
            (!row.chargeTypeFilter || row.chargeTypeFilter === charge.chargeType)
      )).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
      const valid = candidates.filter((row) => {
        // Line adjustments cover billable NRC/MRC, never metered usage.
        if (charge.chargeType === 'usage' && row.level === 'line') return false
        const code = chargeRejection(row, charge, currencyCode)
        if (code) addError(row, code, charge.chargeCode, line.lineId)
        return !code
      })
      for (const row of valid) {
        if (valid.filter((other) => rank(other) === rank(row)).length > 1) {
          addError(row, 'ADJUSTMENT_OVERLAP', charge.chargeCode, line.lineId)
          continue
        }
        if (!winners.has(charge)) winners.set(charge, { ref: { line, charge }, row })
      }
    }
  }
  return winners
}

function chargeRejection(row: PriceAdjustment, charge: OutputCharge, currencyCode: string): AdjustmentError['code'] | undefined {
  if (charge.chargeType === 'usage' || charge.standardTotalPrice === null || charge.standardTotalPrice === undefined ||
    !Number.isFinite(row.value) || row.value < 0 ||
    (row.level === 'line' && isLineAmountType(row.adjustmentType) && !row.chargeTypeFilter) ||
    (row.adjustmentType === 'discount_percent' && (row.value <= 0 || row.value > 100)) ||
    (row.adjustmentType === 'discount_absolute' && row.value <= 0)) return 'TYPE_NOT_ALLOWED'
  if ((row.currencyCode && row.currencyCode !== currencyCode) || charge.currencyCode !== currencyCode ||
    (row.adjustmentType !== 'discount_percent' && !row.currencyCode)) return 'CURRENCY_MISMATCH'
  return undefined
}

/** Charge-level adjustments and line % off, evaluated against the charge's own standard price. */
function applyToCharge(row: PriceAdjustment, charge: OutputCharge) {
  const standard = charge.standardUnitPrice!
  const total = charge.standardTotalPrice!
  const quantity = charge.quantity ?? 1
  const perUnit = (amount: number) => (quantity > 0 ? amount / quantity : 0)
  let afterTotal: number, afterUnit: number
  if (row.adjustmentType === 'discount_percent') {
    afterTotal = Math.max(0, total * (1 - row.value / 100))
    afterUnit = standard * (1 - row.value / 100)
  } else if (row.adjustmentType === 'discount_absolute') {
    afterTotal = Math.max(0, total - row.value)
    afterUnit = perUnit(afterTotal)
  } else if (setsChargeTotal(charge)) {
    afterTotal = row.value
    afterUnit = perUnit(afterTotal)
  } else {
    afterTotal = row.value * quantity
    afterUnit = row.value
  }
  record(row, charge, afterUnit, afterTotal)
}

/**
 * Line Set price / Amount off for one charge type (spec F-D3). `scope` is every
 * eligible charge of that type on the target line and its bundle components;
 * `won` the ones no more specific adjustment claimed. The won charges share
 * the amount in proportion to their standard line totals.
 */
function applyLineSpread(row: PriceAdjustment, scope: ChargeRef[], won: ChargeRef[]) {
  const contribution = (ref: ChargeRef, amount: number | null | undefined) => (amount ?? 0) * lineQuantity(ref.line)
  const wonSet = new Set(won.map((ref) => ref.charge))
  const standardWon = won.reduce((sum, ref) => sum + contribution(ref, ref.charge.standardTotalPrice), 0)
  const fixed = scope.filter((ref) => !wonSet.has(ref.charge)).reduce((sum, ref) => sum + contribution(ref, ref.charge.totalPrice), 0)
  const target = row.adjustmentType === 'price_override' ? row.value - fixed : standardWon - row.value
  const shares = spreadAmount(Math.max(0, target), won.map((ref) => contribution(ref, ref.charge.standardTotalPrice)))
  won.forEach((ref, index) => {
    const lineQty = lineQuantity(ref.line)
    const afterTotal = lineQty > 0 ? shares[index] / lineQty : 0
    const quantity = ref.charge.quantity ?? 1
    record(row, ref.charge, quantity > 0 ? afterTotal / quantity : 0, afterTotal)
  })
}

function record(row: PriceAdjustment, charge: OutputCharge, afterUnit: number, afterTotal: number) {
  const standard = charge.standardUnitPrice!
  charge.unitPrice = afterUnit
  charge.totalPrice = afterTotal
  charge.adjustments.push({
    origin: 'manual', adjustmentId: row.id, class: 'rep', level: row.level,
    windowKind: 'relative', fromMonth: normalizeRange(row).fromMonth, toMonth: normalizeRange(row).toMonth,
    ruleCode: row.id, ruleName: row.reasonCode, ruleType: row.adjustmentType,
    reasonCode: row.reasonCode, createdByUserId: row.createdByUserId,
    value: row.value, unitPriceBefore: standard, unitPriceAfter: afterUnit, delta: afterUnit - standard,
  })
}
