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
it('hash tracks deal eligibility and normalizes omitted eligibility to true', () => {
  const baseline = computeWaterfallSummary([line], [], 'USD')
  expect(computeWaterfallSummary([{ ...line, includeInDeal: true }], [], 'USD').snapshotHash).toBe(baseline.snapshotHash)
  const excluded = computeWaterfallSummary([{ ...line, includeInDeal: false }], [], 'USD')
  expect(excluded.dealValue.offer).toBe(0)
  expect(excluded.snapshotHash).not.toBe(baseline.snapshotHash)
})
it('D5: a yearly MRC counts its monthly equivalent in MRC totals and deal value', () => {
  const yearly = { chargeCode: 'mob', chargeName: 'Mobile', chargeType: 'mrc' as const, pricingMethod: 'flat' as const, currencyCode: 'COP', quantity: 1,
    unitPrice: 480000, totalPrice: 480000, billingPeriod: { unit: 'year' as const, interval: 1 } }
  const summary = computeWaterfallSummary([{ lineId: 'l', quantity: 1, termMonths: 12, charges: [yearly] }], [], 'COP')
  expect(summary.listMrcTotal).toBe(40000)
  expect(summary.dealValue).toEqual({ list: 480000, standard: 480000, offer: 480000 })
})
it('D5: a non-monthly period changes the hash; monthly charges keep their existing hash', () => {
  const plain = computeWaterfallSummary([line], [], 'USD').snapshotHash
  const yearly = { ...line, charges: [{ ...line.charges[0], billingPeriod: { unit: 'year' as const, interval: 1 } }] }
  expect(computeWaterfallSummary([yearly], [], "USD").snapshotHash).not.toBe(plain)
})
const yearlyCharge = (price: number, adjustments: NonNullable<SnapshotLine['charges'][number]['adjustments']> = []) => ({
  chargeCode: 'y', chargeName: 'Yearly', chargeType: 'mrc' as const, pricingMethod: 'flat', currencyCode: 'USD', quantity: 1,
  billingPeriod: { unit: 'year' as const, interval: 1 },
  listUnitPrice: price, listTotalPrice: price, standardUnitPrice: price, standardTotalPrice: price, unitPrice: price, totalPrice: price, adjustments,
})
it('review F2: deal value of a yearly charge does not drift with the 4-dp monthly equivalent × quantity', () => {
  // 100 / year, quantity 1000, 36 months = 3 years × 100,000 = 300,000 (was 8.3333 × 1000 × 36 = 299,998.8).
  const summary = computeWaterfallSummary([{ lineId: 'l', quantity: 1000, termMonths: 36, charges: [yearlyCharge(100)] }], [], 'USD')
  expect(summary.dealValue).toEqual({ list: 300000, standard: 300000, offer: 300000 })
  expect(summary.listMrcTotal).toBeCloseTo(8333.3333, 4)
})
it('review F2: deal value of a phased yearly charge sums its segments without drift', () => {
  const charge = { ...yearlyCharge(100), schedule: [
    { fromMonth: 1, toMonth: 12, unitPrice: 50, totalPrice: 50, standardUnitPrice: 100, standardTotalPrice: 100, source: 'manual' as const, name: 'Year 1' },
    { fromMonth: 13, toMonth: null, unitPrice: 100, totalPrice: 100, standardUnitPrice: 100, standardTotalPrice: 100, source: 'list' as const, name: null },
  ] }
  const summary = computeWaterfallSummary([{ lineId: 'l', quantity: 1000, termMonths: 36, charges: [charge] }], [], 'USD')
  expect(summary.dealValue).toEqual({ list: 300000, standard: 300000, offer: 250000 })
})
it('review F3: rule and manual discount totals are monthly equivalents like the MRC totals', () => {
  // Yearly 1,200: rule −120 → standard 1,080; manual 10 % off → offer 972. Monthly: list 100, standard 90, offer 81.
  const charge = { ...yearlyCharge(1200, [
    { origin: 'rule', ruleCode: 'r', ruleName: 'Rule', ruleType: 'discount_absolute', value: 120, unitPriceBefore: 1200, unitPriceAfter: 1080, delta: -120 },
    { origin: 'manual', ruleCode: 'm', ruleName: 'Manual', ruleType: 'discount_percent', value: 10, unitPriceBefore: 1080, unitPriceAfter: 972, delta: -108 },
  ]), standardUnitPrice: 1080, standardTotalPrice: 1080, unitPrice: 972, totalPrice: 972 }
  const summary = computeWaterfallSummary([{ lineId: 'l', quantity: 1, termMonths: 12, charges: [charge] }], [], 'USD')
  expect(summary).toMatchObject({ listMrcTotal: 100, standardMrcTotal: 90, ruleDiscountTotal: 10, manualDiscountTotal: 9 })
})
