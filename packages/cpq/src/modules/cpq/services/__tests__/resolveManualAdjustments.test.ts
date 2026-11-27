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
  expect(Math.round(priced.unitPrice * 4 * 100)).toBe(cents)
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
  const result = price([{ ...row, adjustmentType: 'price_override', currencyCode: 'EUR', value: 30 }, { ...row, id: 'line-discount', level: 'line', chargeCode: undefined, value: 10 }])
  expect(result.errors).toEqual([expect.objectContaining({ code: 'CURRENCY_MISMATCH' })])
  expect(result.lines[0].charges[0].totalPrice).toBe(90)
})
it('allows a set price above standard and records the uplift (F-D1)', () => {
  const result = price([{ ...row, adjustmentType: 'price_override', currencyCode: 'USD', value: 30 }])
  expect(result.errors).toEqual([])
  expect(result.lines[0].charges[0]).toMatchObject({ unitPrice: 30, totalPrice: 120, standardUnitPrice: 25 })
  expect(result.lines[0].charges[0].adjustments?.[0]).toMatchObject({ unitPriceBefore: 25, unitPriceAfter: 30, delta: 5 })
})
it.each(['volume', 'tiered'] as const)('sets the charge total on a %s charge', (pricingMethod) => {
  const result = price([{ ...row, adjustmentType: 'price_override', currencyCode: 'USD', value: 150 }], [{ ...line, charges: [{ ...charge, pricingMethod }] }])
  expect(result.errors).toEqual([])
  expect(result.lines[0].charges[0]).toMatchObject({ totalPrice: 150, unitPrice: 37.5 })
})
it.each([
  [{ chargeCode: 'missing' }, {}, 'ADJUSTMENT_TARGET_MISSING'],
  [{ quoteLineId: 'missing' }, {}, 'ADJUSTMENT_TARGET_MISSING'],
  [{ currencyCode: 'EUR' }, {}, 'CURRENCY_MISMATCH'],
  [{ adjustmentType: 'discount_absolute', currencyCode: undefined }, {}, 'CURRENCY_MISMATCH'],
  [{ level: 'line', chargeCode: undefined, adjustmentType: 'price_override', currencyCode: 'USD' }, {}, 'TYPE_NOT_ALLOWED'],
  [{ level: 'line', chargeCode: undefined, adjustmentType: 'discount_absolute', currencyCode: 'USD' }, {}, 'TYPE_NOT_ALLOWED'],
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
  const result = price([row, { ...row, id: 'invalid', adjustmentType: 'price_override', currencyCode: 'EUR', value: 200 }])
  expect(result.errors).toEqual([expect.objectContaining({ adjustmentId: 'invalid', code: 'CURRENCY_MISMATCH' })])
  expect(result.lines[0].charges[0].totalPrice).toBe(80)
})

describe('line-level Set price and Amount off (F-D3)', () => {
  // Three recurring charges with standard totals 60 / 30 / 10 (per line instance) and a one-time setup.
  const mrc = (chargeCode: string, unitPrice: number, quantity = 1, patch: Partial<ResolvedCharge> = {}): ResolvedCharge =>
    ({ ...charge, chargeCode, pricingMethod: 'flat', unitPrice, quantity, totalPrice: unitPrice * quantity, ...patch })
  const setup = mrc('setup', 50, 1, { chargeType: 'nrc' })
  const spreadLine: AdjustmentPricingLine = { ...line, charges: [mrc('a', 60), mrc('b', 15, 2), mrc('c', 10), setup] }
  const lineRow = (patch: Partial<PriceAdjustment>): PriceAdjustment =>
    ({ ...row, id: 'line-adj', level: 'line', chargeCode: undefined, chargeTypeFilter: 'mrc', adjustmentType: 'price_override', currencyCode: 'USD', value: 50, ...patch })
  const totals = (result: ReturnType<typeof price>, index = 0) => result.lines[index].charges.map((item) => item.totalPrice)
  const sumMrc = (result: ReturnType<typeof price>, quantities: number[] = []) => result.lines.reduce((sum, item, index) =>
    sum + item.charges.filter((entry) => entry.chargeType === 'mrc').reduce((acc, entry) => acc + entry.totalPrice! * (quantities[index] ?? 1), 0), 0)

  it('spreads a line Set price in proportion to the standard totals, leaving the other charge type alone', () => {
    const result = price([lineRow({})], [spreadLine])
    expect(result.errors).toEqual([])
    expect(totals(result)).toEqual([30, 15, 5, 50])
    expect(result.lines[0].charges[1]).toMatchObject({ unitPrice: 7.5, quantity: 2 })
    expect(result.lines[0].charges[0].adjustments?.[0]).toMatchObject({ origin: 'manual', level: 'line', ruleType: 'price_override', value: 50, unitPriceBefore: 60, unitPriceAfter: 30 })
  })

  it('spreads a line Amount off over the charges', () => {
    const result = price([lineRow({ adjustmentType: 'discount_absolute', value: 20 })], [spreadLine])
    expect(totals(result)).toEqual([48, 24, 8, 50])
  })

  it('clamps an Amount off larger than the line total to zero', () => {
    expect(totals(price([lineRow({ adjustmentType: 'discount_absolute', value: 500 })], [spreadLine]))).toEqual([0, 0, 0, 50])
  })

  it('allows a line Set price above standard', () => {
    const result = price([lineRow({ value: 200 })], [spreadLine])
    expect(totals(result)).toEqual([120, 60, 20, 50])
    expect(result.lines[0].charges[0].adjustments?.[0].delta).toBe(60)
  })

  it('gives the rounding remainder to the largest charge, so the cents add up to the typed price', () => {
    const thirds: AdjustmentPricingLine = { ...line, charges: [mrc('a', 10), mrc('b', 10), mrc('c', 20)] }
    const result = price([lineRow({ value: 100.01 })], [thirds])
    expect(totals(result)).toEqual([25, 25, 50.01])
    expect(sumMrc(result)).toBeCloseTo(100.01, 10)
  })

  it('puts the whole amount on the first charge when every charge is at 0', () => {
    const free: AdjustmentPricingLine = { ...line, charges: [mrc('a', 0), mrc('b', 0)] }
    expect(totals(price([lineRow({ value: 40 })], [free]))).toEqual([40, 0])
  })

  it('applies a line Set price to the line total over all line quantities', () => {
    const result = price([lineRow({ value: 300 })], [{ ...spreadLine, quantity: 3 }])
    expect(totals(result)).toEqual([60, 30, 10, 50])
    expect(sumMrc(result, [3])).toBe(300)
  })

  it('lets a charge adjustment beat the line Set price, which is then spread over the remaining charges only', () => {
    const chargeRow: PriceAdjustment = { ...row, id: 'charge-adj', chargeCode: 'a', adjustmentType: 'price_override', currencyCode: 'USD', value: 10 }
    const result = price([lineRow({ value: 50 }), chargeRow], [spreadLine])
    expect(result.errors).toEqual([])
    // a is fixed at 10; b and c share 40 in proportion 30:10.
    expect(totals(result)).toEqual([10, 30, 10, 50])
    expect(sumMrc(result)).toBe(50)
    expect(result.lines[0].charges[0].adjustments?.map((entry) => entry.adjustmentId)).toEqual(['charge-adj'])
  })

  it('floors the remaining amount at zero when the fixed charges already exceed the typed price', () => {
    const chargeRow: PriceAdjustment = { ...row, id: 'charge-adj', chargeCode: 'a', adjustmentType: 'price_override', currencyCode: 'USD', value: 80 }
    expect(totals(price([lineRow({ value: 50 }), chargeRow], [spreadLine]))).toEqual([80, 0, 0, 50])
  })

  it('lets a line % off and a line Set price coexist on different charge types', () => {
    const result = price([lineRow({ value: 50 }), lineRow({ id: 'nrc-pct', chargeTypeFilter: 'nrc', adjustmentType: 'discount_percent', currencyCode: undefined, value: 10 })], [spreadLine])
    expect(result.errors).toEqual([])
    expect(totals(result)).toEqual([30, 15, 5, 45])
  })

  it('sets the bundle total on a bundle parent, spread over parent and components', () => {
    const parent: AdjustmentPricingLine = { ...line, lineId: 'bundle', charges: [mrc('base', 50)] }
    const childA: AdjustmentPricingLine = { ...line, lineId: 'child-a', parentLineId: 'bundle', quantity: 2, charges: [mrc('seat', 25)] }
    const childB: AdjustmentPricingLine = { ...line, lineId: 'child-b', parentLineId: 'bundle', charges: [mrc('addon', 50), setup] }
    const result = price([lineRow({ quoteLineId: 'bundle', value: 100 })], [parent, childA, childB])
    expect(result.errors).toEqual([])
    // Standard bundle MRC: 50 + 2×25 + 50 = 150 → 100 keeps the 1:1:1 split.
    // Equal weights tie: the cent remainder goes to the first largest charge.
    expect(totals(result, 0)).toEqual([33.34])
    expect(totals(result, 1)).toEqual([16.665])
    expect(totals(result, 2)).toEqual([33.33, 50])
    expect(sumMrc(result, [1, 2, 1])).toBeCloseTo(100, 10)
  })

  it('treats a component with its own line adjustment as fixed inside the bundle Set price', () => {
    const parent: AdjustmentPricingLine = { ...line, lineId: 'bundle', charges: [mrc('base', 50)] }
    const child: AdjustmentPricingLine = { ...line, lineId: 'child', parentLineId: 'bundle', charges: [mrc('seat', 50)] }
    const result = price([lineRow({ quoteLineId: 'bundle', value: 100 }), lineRow({ id: 'child-adj', quoteLineId: 'child', value: 20 })], [parent, child])
    expect(result.errors).toEqual([])
    expect(totals(result, 1)).toEqual([20])
    expect(totals(result, 0)).toEqual([80])
  })

  it('is idempotent when re-resolved on its own output', () => {
    const first = price([lineRow({})], [spreadLine])
    expect(price([lineRow({})], first.lines)).toEqual(first)
  })
})
