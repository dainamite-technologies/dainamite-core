import { conversionCostBlockers, pendingAnswerCosts } from '../conversionGuard'

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

describe('pending supplier answers (COST_ANSWER_PENDING)', () => {
  it('lists price-basis cost lines holding an unapplied proposal, per live line, sorted, with no amounts', () => {
    const rows = [
      row({ quoteLineId: 'b', costKey: 'z', proposedAmount: '310.0000' }), row({ quoteLineId: 'b', costKey: 'a', proposedAmount: '1.0000' }),
      row({ quoteLineId: 'a', costKey: 'tail', proposedAmount: '0.0000' }),
      row({ quoteLineId: 'a', costKey: 'none', proposedAmount: null }),
      row({ quoteLineId: 'gone', costKey: 'tail', proposedAmount: '5.0000' }),
    ]
    const pending = pendingAnswerCosts(rows, ['a', 'b'])
    expect(pending).toEqual([{ quoteLineId: 'a', costKeys: ['tail'] }, { quoteLineId: 'b', costKeys: ['a', 'z'] }])
    expect(JSON.stringify(pending)).not.toMatch(/310|0\.0000/)
  })

  it('margin-only costs never block', () => {
    expect(pendingAnswerCosts([row({ role: 'margin_only', proposedAmount: '9.0000' })], ['mirror-1'])).toEqual([])
  })

  it('a confirmed line with a proposal is not an unconfirmed-cost blocker but is pending', () => {
    const confirmed = row({ valueStatus: 'confirmed', proposedAmount: '310.0000' })
    expect(conversionCostBlockers([], [confirmed], '2027-01-01')).toEqual([])
    expect(pendingAnswerCosts([confirmed], ['mirror-1'])).toEqual([{ quoteLineId: 'mirror-1', costKeys: ['tail'] }])
  })
})
