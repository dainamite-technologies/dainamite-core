import { isCostPlusItem } from '../costPlusItem'

describe('isCostPlusItem (Q4: stored charges only)', () => {
  it('is true when a stored charge is priced cost_plus', () => {
    expect(isCostPlusItem({ charges: [{ pricingMethod: 'flat' }, { pricingMethod: 'cost_plus' }] })).toBe(true)
  })
  it('is false for flat-only, empty, missing or malformed charges', () => {
    expect(isCostPlusItem({ charges: [{ pricingMethod: 'flat' }] })).toBe(false)
    expect(isCostPlusItem({ charges: [] })).toBe(false)
    expect(isCostPlusItem({ charges: null })).toBe(false)
    expect(isCostPlusItem({ charges: { pricingMethod: 'cost_plus' } })).toBe(false)
    expect(isCostPlusItem({ charges: [null] })).toBe(false)
    expect(isCostPlusItem(null)).toBe(false)
  })
})
