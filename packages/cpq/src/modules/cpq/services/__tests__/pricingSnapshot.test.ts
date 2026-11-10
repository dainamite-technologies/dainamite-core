import { computeWaterfallSummary, type SnapshotLine } from '../priceAdjustments/pricingSnapshot'
import { resolveManualAdjustments } from '../priceAdjustments/resolveManualAdjustments'
import type { PriceAdjustment } from '../../data/price-adjustments'
const line: SnapshotLine = {
  lineId: 'line', quantity: 2, termMonths: 3,
  charges: [{ chargeCode: 'mrc', chargeName: 'MRC', chargeType: 'mrc', pricingMethod: 'flat', currencyCode: 'USD', quantity: 1,
    listUnitPrice: 100, listTotalPrice: 100, standardUnitPrice: 90, standardTotalPrice: 90, unitPrice: 80, totalPrice: 80,
    adjustments: [
      { origin: 'rule', ruleCode: 'rule', ruleName: 'Rule', ruleType: 'discount_absolute', value: 10, unitPriceBefore: 100, unitPriceAfter: 90, delta: -10 },
      { origin: 'manual', ruleCode: 'manual', ruleName: 'Manual', ruleType: 'discount_absolute', value: 10, unitPriceBefore: 90, unitPriceAfter: 80, delta: -10 },
    ] }],
}
const row: PriceAdjustment = { id: 'a', quoteLineId: 'line', level: 'charge', chargeCode: 'mrc', adjustmentType: 'price_override', value: 80, currencyCode: 'USD', reasonCode: 'competitive_match' }
it('includes line quantity, term horizon and separate rule/manual totals', () => {
  const summary = computeWaterfallSummary([line], [row], 'USD')
  expect(summary).toMatchObject({ listMrcTotal: 200, standardMrcTotal: 180, ruleDiscountTotal: 20, manualDiscountTotal: 20, dealValue: { list: 600, standard: 540, offer: 480 } })
  expect(summary.discountDepth.manual).toBeCloseTo(1 - 480 / 540)
  expect(summary.discountDepth.total).toBeCloseTo(0.2)
})
it('counts NRC once and excludes usage even over a long horizon', () => {
  const nrc = { ...line.charges[0], chargeType: 'nrc' as const }
  const usage = { ...line.charges[0], chargeType: 'usage' as const }
  expect(computeWaterfallSummary([{ ...line, termMonths: 24, charges: [nrc, usage] }], [], 'USD').dealValue).toEqual({ list: 200, standard: 180, offer: 160 })
})
it('uses 12 months without a term; excludes unchanged ARC mirrors from deal value', () => {
  expect(computeWaterfallSummary([{ ...line, termMonths: null }], [], 'USD').dealValue.list).toBe(2400)
  expect(computeWaterfallSummary([{ ...line, includeInDeal: false }], [], 'USD').dealValue).toEqual({ list: 0, standard: 0, offer: 0 })
})
it('represents zero baselines by null and rule markups by negative depth', () => {
  expect(computeWaterfallSummary([], [], 'USD').discountDepth).toEqual({ rule: null, manual: null, total: null, maxLineManual: null })
  const marked = { ...line.charges[0], standardTotalPrice: 110, totalPrice: 110 }
  expect(computeWaterfallSummary([{ ...line, charges: [marked] }], [], 'USD').discountDepth.rule).toBeCloseTo(-0.1)
})
it('hash ignores ordering, reason notes and authors but tracks price, quantity, horizon and adjustment changes', () => {
  const other = { ...line, lineId: 'other' }
  const initial = computeWaterfallSummary([line, other], [row], 'USD').snapshotHash
  expect(computeWaterfallSummary([other, line], [{ ...row, reasonNote: 'Edited', reasonCode: 'other', createdByUserId: 'user' }], 'USD').snapshotHash).toBe(initial)
  for (const changed of [{ ...line, quantity: 3 }, { ...line, termMonths: 6 }, { ...line, charges: [{ ...line.charges[0], totalPrice: 70 }] }]) {
    expect(computeWaterfallSummary([changed, other], [row], 'USD').snapshotHash).not.toBe(initial)
  }
  expect(computeWaterfallSummary([line, other], [{ ...row, value: 70 }], 'USD').snapshotHash).not.toBe(initial)
})
it('normalizes legacy waterfall fields to the same hash and never changes legacy discountTotal', () => {
  const legacy = { ...line.charges[0] }
  delete legacy.listUnitPrice; delete legacy.listTotalPrice; delete legacy.standardUnitPrice; delete legacy.standardTotalPrice
  const result = computeWaterfallSummary([{ ...line, charges: [legacy] }], [row], 'USD')
  expect(result.snapshotHash).toBe(computeWaterfallSummary([line], [row], 'USD').snapshotHash)
  expect(result).not.toHaveProperty('discountTotal')
})
it('stable hash and money after repeated resolver passes', () => {
  const input = [{ ...line, parentLineId: null, enginePriced: true, mirrored: false }]
  const first = resolveManualAdjustments(input, [row], 'USD')
  const second = resolveManualAdjustments(first.lines, [row], 'USD')
  expect(computeWaterfallSummary(first.lines.map((priced) => ({ ...priced, quantity: 2 })), [row], 'USD')).toEqual(computeWaterfallSummary(second.lines.map((priced) => ({ ...priced, quantity: 2 })), [row], 'USD'))
})
