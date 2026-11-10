import { createHash } from 'node:crypto'
import type { PriceAdjustment } from '../../data/price-adjustments'
import type { PricingWaterfallSummary, ResolvedCharge } from '../types'
import { withChargeWaterfall } from './chargeWaterfall'

export interface SnapshotLine {
  lineId: string
  quantity: number
  termMonths?: number | null
  /** ARC mirrors are excluded from deal value until their negotiated re-rate is supported. */
  includeInDeal?: boolean
  charges: ResolvedCharge[]
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Signed fractions: a rule surcharge yields a negative discount depth. */
function depth(before: number, after: number): number | null {
  return before === 0 ? null : 1 - after / before
}

export function computeWaterfallSummary(
  lines: SnapshotLine[],
  adjustments: PriceAdjustment[],
  currencyCode: string,
): PricingWaterfallSummary {
  let listNrcTotal = 0, listMrcTotal = 0, standardNrcTotal = 0, standardMrcTotal = 0
  let ruleDiscountTotal = 0, manualDiscountTotal = 0
  const dealValue = { list: 0, standard: 0, offer: 0 }
  const lineDepths: number[] = []
  for (const line of lines) {
    let standardDeal = 0, offerDeal = 0
    for (const input of line.charges) {
      const charge = withChargeWaterfall(input)
      if (charge.chargeType === 'usage') continue
      const list = (charge.listTotalPrice ?? 0) * line.quantity
      const standard = (charge.standardTotalPrice ?? 0) * line.quantity
      const offer = (charge.totalPrice ?? 0) * line.quantity
      if (charge.chargeType === 'nrc') { listNrcTotal += list; standardNrcTotal += standard }
      else { listMrcTotal += list; standardMrcTotal += standard }
      for (const entry of charge.adjustments ?? []) {
        const discount = Math.max(0, -entry.delta) * (charge.quantity ?? 1) * line.quantity
        if (entry.origin === 'manual') manualDiscountTotal += discount
        else ruleDiscountTotal += discount
      }
      if (line.includeInDeal === false) continue
      const months = charge.chargeType === 'nrc' ? 1 : line.termMonths ?? 12
      dealValue.list += list * months
      dealValue.standard += standard * months
      dealValue.offer += offer * months
      standardDeal += standard * months; offerDeal += offer * months
    }
    const manualDepth = depth(standardDeal, offerDeal)
    if (manualDepth !== null) lineDepths.push(manualDepth)
  }
  const pricedLines = lines.map((line) => ({
    lineId: line.lineId, quantity: line.quantity, termMonths: line.termMonths ?? 12,
    charges: line.charges.map((input) => {
      const charge = withChargeWaterfall(input)
      return { chargeCode: charge.chargeCode, chargeType: charge.chargeType, currencyCode: charge.currencyCode,
        listUnitPrice: charge.listUnitPrice, listTotalPrice: charge.listTotalPrice,
        standardUnitPrice: charge.standardUnitPrice, standardTotalPrice: charge.standardTotalPrice,
        unitPrice: charge.unitPrice, totalPrice: charge.totalPrice }
    }).sort((a, b) => a.chargeCode.localeCompare(b.chargeCode) || canonical(a).localeCompare(canonical(b))),
  })).sort((a, b) => a.lineId.localeCompare(b.lineId))
  const pricedAdjustments = adjustments.map((row) => ({
    id: row.id, level: row.level, quoteLineId: row.quoteLineId, chargeCode: row.chargeCode ?? null,
    chargeTypeFilter: row.chargeTypeFilter ?? null, adjustmentType: row.adjustmentType, value: row.value,
    currencyCode: row.currencyCode ?? null, windowKind: row.windowKind ?? 'relative', fromMonth: row.fromMonth ?? 1, toMonth: row.toMonth ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id))
  return {
    listNrcTotal, listMrcTotal, standardNrcTotal, standardMrcTotal,
    ruleDiscountTotal, manualDiscountTotal, dealValue,
    discountDepth: { rule: depth(dealValue.list, dealValue.standard), manual: depth(dealValue.standard, dealValue.offer),
      total: depth(dealValue.list, dealValue.offer), maxLineManual: lineDepths.length ? Math.max(...lineDepths) : null },
    hasTimeBasedAdjustments: false,
    snapshotHash: createHash('sha256').update(canonical({ currencyCode, lines: pricedLines, adjustments: pricedAdjustments })).digest('hex'),
  }
}
