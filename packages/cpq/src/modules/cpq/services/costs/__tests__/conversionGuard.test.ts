import { conversionCostBlockers } from '../conversionGuard'

const row = (over: Record<string, unknown> = {}) => ({ quoteLineId: 'mirror-1', costKey: 'tail', role: 'price_basis', valueStatus: 'estimated', validUntil: null, ...over }) as never

describe('conversion guard and reconfigured mirror lines (Q13, no deadlock)', () => {
  const pricedLine = { quoteLineId: 'mirror-1', charges: [{ chargeCode: 'mrc', pricingMethod: 'cost_plus', unitPrice: 120 }] }

  it('blocks a reconfigured mirror line while its catalog price-basis cost is unconfirmed, and releases once confirmed', () => {
    expect(conversionCostBlockers([pricedLine], [row()], '2027-01-01')).toEqual([{ quoteLineId: 'mirror-1', costKeys: ['tail'], chargeCodes: [] }])
    expect(conversionCostBlockers([pricedLine], [row({ valueStatus: 'confirmed' })], '2027-01-01')).toEqual([])
  })

  it('blocks an unreconfigured mirror stored without a cost-plus price (no cost rows) until it is reconfigured and repriced', () => {
    const unpriced = { quoteLineId: 'mirror-1', charges: [{ chargeCode: 'mrc', pricingMethod: 'cost_plus', unitPrice: null }] }
    expect(conversionCostBlockers([unpriced], [], '2027-01-01')).toEqual([{ quoteLineId: 'mirror-1', costKeys: [], chargeCodes: ['mrc'] }])
    expect(conversionCostBlockers([pricedLine], [], '2027-01-01')).toEqual([])
  })

  it('never blocks a frozen cost-plus Renew mirror: stored priced charges and no cost rows', () => {
    expect(conversionCostBlockers([pricedLine], [], '2027-01-01')).toEqual([])
  })
})
