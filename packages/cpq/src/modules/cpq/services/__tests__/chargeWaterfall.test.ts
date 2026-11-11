import { withChargeWaterfall, withoutChargeWaterfall } from '../priceAdjustments/chargeWaterfall'
import type { ResolvedCharge } from '../types'

const base: ResolvedCharge = {
  chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'per_unit',
  unitPrice: 20, quantity: 4, totalPrice: 80, currencyCode: 'USD',
}
const rule = { ruleCode: 'volume', ruleName: 'Volume', ruleType: 'discount_percent', value: 20, unitPriceBefore: 25, unitPriceAfter: 20, delta: -5 }
it('derives pre-rule and standard money from legacy adjustments without mutating the snapshot', () => {
  const input = { ...base, adjustments: [rule] }
  const result = withChargeWaterfall(input)
  expect(result).toMatchObject({ listUnitPrice: 25, listTotalPrice: 100, standardUnitPrice: 20, standardTotalPrice: 80 })
  expect(result.adjustments?.[0].origin).toBe('rule')
  expect(input.adjustments[0]).not.toHaveProperty('origin')
  expect(result.unitPrice).toBe(base.unitPrice)
  expect(result.totalPrice).toBe(base.totalPrice)
})
it('preserves exact tier totals and null usage totals', () => {
  const tier = { ...base, unitPrice: 1 / 3, quantity: 3, totalPrice: 1 }
  expect(withChargeWaterfall(tier).standardTotalPrice).toBe(1)
  expect(withChargeWaterfall({ ...base, chargeType: 'usage', quantity: null, totalPrice: null })).toMatchObject({ listTotalPrice: null, standardTotalPrice: null })
})
it('keeps explicitly captured zero values', () => {
  expect(withChargeWaterfall({ ...base, listUnitPrice: 0, listTotalPrice: 0 })).toMatchObject({ listUnitPrice: 0, listTotalPrice: 0 })
})
it('removes internal waterfall fields from the default public calculation response', () => {
  expect(withoutChargeWaterfall(withChargeWaterfall(base))).toEqual(base)
})
