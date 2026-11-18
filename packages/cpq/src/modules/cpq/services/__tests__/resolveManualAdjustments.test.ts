import { resolveManualAdjustments, type AdjustmentPricingLine } from '../priceAdjustments/resolveManualAdjustments'
import type { PriceAdjustment } from '../../data/price-adjustments'
import type { ResolvedCharge } from '../types'

const charge: ResolvedCharge = { chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'per_unit', unitPrice: 25, totalPrice: 100, quantity: 4, currencyCode: 'USD' }
const line: AdjustmentPricingLine = { lineId: 'line', parentLineId: null, enginePriced: true, mirrored: false, charges: [charge] }
const row: PriceAdjustment = { id: 'adj', quoteLineId: 'line', level: 'charge', chargeCode: 'fee', adjustmentType: 'discount_percent', value: 20, reasonCode: 'competitive_match' }
function price(rows: PriceAdjustment[], lines = [line]) { return resolveManualAdjustments(lines, rows, 'USD') }

it.each([
  { adjustmentType: 'discount_percent' as const, value: 20, currencyCode: undefined, cents: 8000 },
  { adjustmentType: 'discount_absolute' as const, value: 20, currencyCode: 'USD', cents: 8000 },
  { adjustmentType: 'discount_absolute' as const, value: 200, currencyCode: 'USD', cents: 0 },
  { adjustmentType: 'price_override' as const, value: 20, currencyCode: 'USD', cents: 8000 },
  { adjustmentType: 'price_override' as const, value: 0, currencyCode: 'USD', cents: 0 },
])('applies $adjustmentType $value against standard, per charge instance', ({ cents, ...values }) => {
  const result = price([{ ...row, ...values }])
  expect(result.errors).toEqual([])
  const priced = result.lines[0].charges[0]
  expect(Math.round(priced.totalPrice! * 100)).toBe(cents)
  expect(Math.round(priced.unitPrice! * 4 * 100)).toBe(cents)
  expect(priced).toMatchObject({ listTotalPrice: 100, standardTotalPrice: 100 })
  expect(priced.adjustments?.[0]).toMatchObject({ origin: 'manual', adjustmentId: 'adj', unitPriceBefore: 25 })
  expect(charge).not.toHaveProperty('adjustments')
})
it('uses charge above line above nearest ancestor, without compounding', () => {
  const rows: PriceAdjustment[] = [
    { ...row, id: 'root', quoteLineId: 'root', level: 'line', chargeCode: undefined, value: 50 },
    { ...row, id: 'parent', quoteLineId: 'parent', level: 'line', chargeCode: undefined, value: 30 },
    { ...row, id: 'line', level: 'line', chargeCode: undefined, value: 10 }, row,
  ]
  const lines = [{ ...line, lineId: 'root' }, { ...line, lineId: 'parent', parentLineId: 'root' }, { ...line, parentLineId: 'parent' }]
  expect(price(rows, lines).lines.map((item) => item.charges[0].totalPrice)).toEqual([50, 70, 80])
  expect(price(rows.slice(0, -1), lines).lines[2].charges[0].totalPrice).toBe(90)
  expect(price(rows.slice(0, -2), lines).lines[2].charges[0].totalPrice).toBe(70)
})
it('skips an invalid charge override and falls back to a valid line discount', () => {
  const result = price([{ ...row, adjustmentType: 'price_override', currencyCode: 'USD', value: 30 }, { ...row, id: 'line-discount', level: 'line', chargeCode: undefined, value: 10 }])
  expect(result.errors).toEqual([expect.objectContaining({ code: 'ABOVE_STANDARD' })])
  expect(result.lines[0].charges[0].totalPrice).toBe(90)
})
it.each([
  [{ chargeCode: 'missing' }, {}, 'ADJUSTMENT_TARGET_MISSING'],
  [{ quoteLineId: 'missing' }, {}, 'ADJUSTMENT_TARGET_MISSING'],
  [{ currencyCode: 'EUR' }, {}, 'CURRENCY_MISMATCH'],
  [{ adjustmentType: 'discount_absolute', currencyCode: undefined }, {}, 'CURRENCY_MISMATCH'],
  [{ adjustmentType: 'price_override', currencyCode: 'USD' }, { pricingMethod: 'tiered' }, 'TYPE_NOT_ALLOWED'],
  [{ adjustmentType: 'price_override', currencyCode: 'USD' }, { pricingMethod: 'volume' }, 'TYPE_NOT_ALLOWED'],
  [{ value: 101 }, {}, 'TYPE_NOT_ALLOWED'],
  [{}, { chargeType: 'usage', totalPrice: null, quantity: null }, 'TYPE_NOT_ALLOWED'],
] as const)('keeps and flags invalid adjustments (%s)', (patch, chargePatch, code) => {
  const result = price([{ ...row, ...patch }], [{ ...line, charges: [{ ...charge, ...chargePatch }] }])
  expect(result.errors).toEqual([expect.objectContaining({ code })])
  expect(result.lines[0].charges[0].unitPrice).toBe(charge.unitPrice)
})
it('rejects ambiguous charge codes and overlapping same-level discounts', () => {
  expect(price([row], [{ ...line, charges: [charge, charge] }]).errors[0].code).toBe('TARGET_AMBIGUOUS')
  const result = price([row, { ...row, id: 'second' }])
  expect(result.errors).toHaveLength(2)
  expect(result.errors.every((error) => error.code === 'ADJUSTMENT_OVERLAP')).toBe(true)
  expect(result.lines[0].charges[0].totalPrice).toBe(100)
})
it('never changes mirror/free-form offers and rejects adjustments on them', () => {
  for (const patch of [{ mirrored: true }, { enginePriced: false }]) {
    const contracted = { ...charge, unitPrice: 20, totalPrice: 80, standardUnitPrice: 25, standardTotalPrice: 100 }
    const result = price([row], [{ ...line, ...patch, charges: [contracted] }])
    expect(result.errors[0].code).toBe('LINE_NOT_ELIGIBLE')
    expect(result.lines[0].charges[0].totalPrice).toBe(80)
  }
})
it('filters line discounts by charge type and never discounts usage', () => {
  const result = price([{ ...row, level: 'line', chargeCode: undefined, chargeTypeFilter: 'mrc' }], [{ ...line, charges: [charge, { ...charge, chargeCode: 'setup', chargeType: 'nrc' }, { ...charge, chargeCode: 'usage', chargeType: 'usage', totalPrice: null, quantity: null }] }])
  expect(result.lines[0].charges.map((item) => item.totalPrice)).toEqual([80, 100, null])
  expect(result.errors).toEqual([])
})
it('is idempotent on previously adjusted charges and safely traverses a malformed parent cycle', () => {
  const first = price([row])
  expect(price([row], first.lines)).toEqual(first)
  expect(price([{ ...row, level: 'line', chargeCode: undefined }], [{ ...line, parentLineId: 'line' }]).lines[0].charges[0].totalPrice).toBe(80)
})
it('handles zero charge quantities without division by zero', () => {
  const result = price([{ ...row, adjustmentType: 'discount_absolute', currencyCode: 'USD' }], [{ ...line, charges: [{ ...charge, quantity: 0, totalPrice: 0 }] }])
  expect(result.lines[0].charges[0].unitPrice).toBe(0)
  expect(result.lines[0].charges[0].totalPrice).toBe(0)
})
it('skips an invalid same-level override without treating it as an overlap with a valid discount', () => {
  const result = price([row, { ...row, id: 'invalid', adjustmentType: 'price_override', currencyCode: 'USD', value: 200 }])
  expect(result.errors).toEqual([expect.objectContaining({ adjustmentId: 'invalid', code: 'ABOVE_STANDARD' })])
  expect(result.lines[0].charges[0].totalPrice).toBe(80)
})
