import { normalizeChargePricing } from '../charge-pricing'

// Pins the documented decision table for the legacy-disambiguation logic.
describe('normalizeChargePricing', () => {
  it('legacy flat without a table → fixed / flat', () => {
    expect(normalizeChargePricing({ pricingMethod: 'flat' })).toEqual({ model: 'flat', source: 'fixed' })
  })

  it('legacy flat with a pricingTableId → table / flat (preserves calculateFlat-via-table)', () => {
    expect(normalizeChargePricing({ pricingMethod: 'flat', pricingTableId: 't1' })).toEqual({ model: 'flat', source: 'table' })
  })

  it('legacy per_unit → table / per_unit', () => {
    expect(normalizeChargePricing({ pricingMethod: 'per_unit' })).toEqual({ model: 'per_unit', source: 'table' })
  })

  it('legacy tiered → table / tiered', () => {
    expect(normalizeChargePricing({ pricingMethod: 'tiered' })).toEqual({ model: 'tiered', source: 'table' })
  })

  it('legacy fixed → fixed / flat', () => {
    expect(normalizeChargePricing({ pricingMethod: 'fixed' })).toEqual({ model: 'flat', source: 'fixed' })
  })

  it('new split: chargeModel=volume + pricingMethod=table → table / volume', () => {
    expect(normalizeChargePricing({ chargeModel: 'volume', pricingMethod: 'table' })).toEqual({ model: 'volume', source: 'table' })
  })

  it('new split: chargeModel=per_unit + pricingMethod=fixed → fixed / per_unit', () => {
    expect(normalizeChargePricing({ chargeModel: 'per_unit', pricingMethod: 'fixed' })).toEqual({ model: 'per_unit', source: 'fixed' })
  })

  it('explicit chargeModel wins over a legacy pricingMethod value', () => {
    expect(normalizeChargePricing({ chargeModel: 'volume', pricingMethod: 'tiered' })).toEqual({ model: 'volume', source: 'table' })
  })

  it('chargeModel only (no pricingMethod), pricingTableId set → table / <model>', () => {
    expect(normalizeChargePricing({ chargeModel: 'volume', pricingTableId: 't1' })).toEqual({ model: 'volume', source: 'table' })
  })

  it('all empty / null → fixed / flat (default)', () => {
    expect(normalizeChargePricing({})).toEqual({ model: 'flat', source: 'fixed' })
    expect(normalizeChargePricing({ chargeModel: null, pricingMethod: null })).toEqual({ model: 'flat', source: 'fixed' })
  })

  it('is case-insensitive on both axes', () => {
    expect(normalizeChargePricing({ chargeModel: 'TIERED', pricingMethod: 'TABLE' })).toEqual({ model: 'tiered', source: 'table' })
  })
})
