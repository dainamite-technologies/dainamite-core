import type { AdjustmentError, PriceAdjustment } from '../../data/price-adjustments'
import type { ResolvedCharge } from '../types'
import { withChargeWaterfall } from './chargeWaterfall'

export interface AdjustmentPricingLine {
  lineId: string
  parentLineId: string | null
  enginePriced: boolean
  mirrored: boolean
  charges: ResolvedCharge[]
}

/** Most-specific valid manual adjustment wins; each is evaluated against standard. */
export function resolveManualAdjustments(
  lines: AdjustmentPricingLine[],
  adjustments: PriceAdjustment[],
  currencyCode: string,
): { lines: AdjustmentPricingLine[]; errors: AdjustmentError[] } {
  const errors: AdjustmentError[] = []
  const byId = new Map(lines.map((line) => [line.lineId, line]))
  const eligible = (line: AdjustmentPricingLine) => line.enginePriced && !line.mirrored
  const output = lines.map((line) => ({
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
  for (const line of output) {
    if (!eligible(line)) continue
    const lineage: string[] = []
    const visited = new Set<string>([line.lineId])
    let parent = line.parentLineId
    while (parent && !visited.has(parent)) {
      visited.add(parent); lineage.push(parent); parent = byId.get(parent)?.parentLineId ?? null
    }
    // Declared before use: `.sort()` below calls it eagerly (a `const` after it would hit the TDZ).
    const rank = (row: PriceAdjustment) =>
      row.level === 'charge' ? 0 : row.quoteLineId === line.lineId ? 1 : 2 + lineage.indexOf(row.quoteLineId)
    for (const charge of line.charges) {
      // An unpriced cost-plus charge (pending cost) has no standard price to adjust; the line is already not ready.
      if (charge.standardUnitPrice == null) continue
      const candidates = adjustments.filter((row) => !invalid.has(row.id) && (
        row.level === 'charge'
          ? row.quoteLineId === line.lineId && row.chargeCode === charge.chargeCode
          : (row.quoteLineId === line.lineId || lineage.includes(row.quoteLineId)) &&
            (!row.chargeTypeFilter || row.chargeTypeFilter === charge.chargeType)
      )).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
      const standard = charge.standardUnitPrice!
      const total = charge.standardTotalPrice
      const valid = candidates.filter((row) => {
        // Line discounts cover billable NRC/MRC, never metered usage.
        if (charge.chargeType === 'usage' && row.level === 'line') return false
        let code: AdjustmentError['code'] | undefined
        if (charge.chargeType === 'usage' || total === null || !Number.isFinite(row.value) || row.value < 0 ||
          (row.adjustmentType === 'price_override' && charge.pricingMethod !== 'flat' && charge.pricingMethod !== 'per_unit' && charge.pricingMethod !== 'cost_plus') ||
          (row.level === 'line' && row.adjustmentType !== 'discount_percent') ||
          (row.adjustmentType === 'discount_percent' && (row.value <= 0 || row.value > 100)) ||
          (row.adjustmentType === 'discount_absolute' && row.value <= 0)) code = 'TYPE_NOT_ALLOWED'
        else if ((row.currencyCode && row.currencyCode !== currencyCode) || charge.currencyCode !== currencyCode ||
          (row.adjustmentType !== 'discount_percent' && !row.currencyCode)) code = 'CURRENCY_MISMATCH'
        else if (row.adjustmentType === 'price_override' && row.value > standard) code = 'ABOVE_STANDARD'
        if (code) addError(row, code, charge.chargeCode, line.lineId)
        return !code
      })
      let applied = false
      for (const row of valid) {
        if (valid.filter((other) => rank(other) === rank(row)).length > 1) {
          addError(row, 'ADJUSTMENT_OVERLAP', charge.chargeCode, line.lineId)
          continue
        }
        if (applied) continue
        const quantity = charge.quantity ?? 1
        const afterTotal = row.adjustmentType === 'discount_absolute' ? Math.max(0, total! - row.value)
          : row.adjustmentType === 'discount_percent' ? Math.max(0, total! * (1 - row.value / 100))
            : row.value * quantity
        const afterUnit = row.adjustmentType === 'discount_percent' ? standard * (1 - row.value / 100)
          : row.adjustmentType === 'price_override' ? row.value : quantity > 0 ? afterTotal / quantity : 0
        charge.unitPrice = afterUnit
        charge.totalPrice = afterTotal
        charge.adjustments.push({
          origin: 'manual', adjustmentId: row.id, class: 'rep', level: row.level,
          windowKind: 'relative', fromMonth: 1, toMonth: null,
          ruleCode: row.id, ruleName: row.reasonCode, ruleType: row.adjustmentType,
          reasonCode: row.reasonCode, createdByUserId: row.createdByUserId,
          value: row.value, unitPriceBefore: standard, unitPriceAfter: afterUnit, delta: afterUnit - standard,
        })
        applied = true
      }
    }
  }
  return { lines: output, errors }
}
