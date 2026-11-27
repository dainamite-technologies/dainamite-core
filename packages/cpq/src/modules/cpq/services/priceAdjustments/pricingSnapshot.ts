import { createHash } from 'node:crypto'
import type { PriceAdjustment } from '../../data/price-adjustments'
import type { PricingWaterfallSummary, ResolvedCharge } from '../types'
import { withChargeWaterfall } from './chargeWaterfall'
import { billingPeriodMonths, chargeBillingPeriod } from '../../lib/chargeBillingPeriod'
import { monthsInTerm } from '../../lib/priceSchedule'

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

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * D5: the monthly equivalent of an amount of `charge` (identity for NRC and
 * every 1 month), **unrounded** — totals and deal value round once at the end,
 * so quantity × months never multiplies a 4-dp residue (review F2).
 */
function monthly(charge: ResolvedCharge, amount: number | null | undefined): number {
  const value = Number(amount ?? 0)
  if (!Number.isFinite(value)) return 0
  return charge.chargeType === 'mrc' ? value / billingPeriodMonths(chargeBillingPeriod(charge)) : value
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
  let hasSchedule = false
  for (const line of lines) {
    let standardDeal = 0, offerDeal = 0
    for (const input of line.charges) {
      const charge = withChargeWaterfall(input)
      if (charge.chargeType === 'usage') continue
      // D5: an MRC price is per its billing period; totals and deal value use
      // the monthly equivalent (identity for every 1 month).
      const list = monthly(charge, charge.listTotalPrice) * line.quantity
      const standard = monthly(charge, charge.standardTotalPrice) * line.quantity
      const offer = monthly(charge, charge.totalPrice) * line.quantity
      if (charge.chargeType === 'nrc') { listNrcTotal += list; standardNrcTotal += standard }
      else { listMrcTotal += list; standardMrcTotal += standard }
      for (const entry of charge.adjustments ?? []) {
        // Monthly equivalent, like the MRC totals beside it (review F3).
        const discount = monthly(charge, Math.max(0, -entry.delta) * (charge.quantity ?? 1)) * line.quantity
        if (entry.origin === 'manual') manualDiscountTotal += discount
        else ruleDiscountTotal += discount
      }
      if (line.includeInDeal === false) continue
      const months = charge.chargeType === 'nrc' ? 1 : line.termMonths ?? 12
      let standardValue = standard * months, offerValue = offer * months
      if (charge.chargeType === 'mrc' && charge.schedule?.length) {
        // Price phases: the deal is the sum over the schedule, month by month within the term.
        hasSchedule = true
        standardValue = 0; offerValue = 0
        for (const segment of charge.schedule) {
          const inTerm = monthsInTerm(segment, months)
          standardValue += monthly(charge, segment.standardTotalPrice) * line.quantity * inTerm
          offerValue += monthly(charge, segment.totalPrice) * line.quantity * inTerm
        }
      }
      dealValue.list += list * months
      dealValue.standard += standardValue
      dealValue.offer += offerValue
      standardDeal += standardValue; offerDeal += offerValue
    }
    const manualDepth = depth(standardDeal, offerDeal)
    if (manualDepth !== null) lineDepths.push(manualDepth)
  }
  listNrcTotal = round4(listNrcTotal); listMrcTotal = round4(listMrcTotal)
  standardNrcTotal = round4(standardNrcTotal); standardMrcTotal = round4(standardMrcTotal)
  ruleDiscountTotal = round4(ruleDiscountTotal); manualDiscountTotal = round4(manualDiscountTotal)
  dealValue.list = round4(dealValue.list); dealValue.standard = round4(dealValue.standard); dealValue.offer = round4(dealValue.offer)
  const pricedLines = lines.map((line) => ({
    lineId: line.lineId, quantity: line.quantity, termMonths: line.termMonths ?? 12, includeInDeal: line.includeInDeal !== false,
    charges: line.charges.map((input) => {
      const charge = withChargeWaterfall(input)
      return { chargeCode: charge.chargeCode, chargeType: charge.chargeType, currencyCode: charge.currencyCode,
        listUnitPrice: charge.listUnitPrice, listTotalPrice: charge.listTotalPrice,
        standardUnitPrice: charge.standardUnitPrice, standardTotalPrice: charge.standardTotalPrice,
        unitPrice: charge.unitPrice, totalPrice: charge.totalPrice,
        // Only a non-monthly period enters the hash, so existing hashes are unchanged.
        ...(charge.billingPeriod ? { billingPeriod: charge.billingPeriod } : {}),
        // Price phases: only a phased charge adds its schedule, so existing hashes are unchanged.
        ...(charge.schedule?.length ? { schedule: charge.schedule.map((segment) => ({ fromMonth: segment.fromMonth, toMonth: segment.toMonth,
          unitPrice: segment.unitPrice, totalPrice: segment.totalPrice, standardUnitPrice: segment.standardUnitPrice,
          standardTotalPrice: segment.standardTotalPrice, source: segment.source })) } : {}) }
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
    // Pricing signals: true when any deal line has a price phase (rule or manual).
    hasTimeBasedAdjustments: hasSchedule || adjustments.some((row) => (row.fromMonth ?? 1) > 1 || row.toMonth != null),
    snapshotHash: createHash('sha256').update(canonical({ currencyCode, lines: pricedLines, adjustments: pricedAdjustments })).digest('hex'),
  }
}
