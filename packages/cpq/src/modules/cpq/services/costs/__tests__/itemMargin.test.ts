import { computeAssetMargin, computeItemMargin, computeSubscriptionMargin, type MarginInventoryCost } from '../itemMargin'

const cost = (over: Partial<MarginInventoryCost> = {}): MarginInventoryCost => ({ chargeCode: 'mrc', costType: 'mrc', valueStatus: 'confirmed', totalAmount: '60', ...over })
const charges = [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 50 }, { chargeCode: 'nrc', chargeType: 'nrc', totalPrice: 100 }, { chargeCode: 'use', chargeType: 'usage', totalPrice: 9 }]

describe('computeItemMargin', () => {
  it('MRC margin = item MRC - open MRC totals; NRC margin = item NRC - NRC totals (quantity already in both)', () => {
    const margin = computeItemMargin({
      mrcAmount: '200', nrcAmount: '300', quantity: 2, charges: charges as never,
      costs: [cost({ totalAmount: '120' }), cost({ totalAmount: '30', chargeCode: null }), cost({ chargeCode: 'nrc', costType: 'nrc', totalAmount: '250' })],
    })
    expect(margin).toEqual({ mrcOffer: 200, mrcCost: 150, mrcMargin: 50, mrcMarginPercent: 25, nrcOffer: 300, nrcCost: 250, nrcMargin: 50, coverage: 100 })
  })
  it('an unknown cost contributes 0 and leaves its charge uncovered', () => {
    const margin = computeItemMargin({
      mrcAmount: '100', nrcAmount: '200', quantity: 1, charges: charges as never,
      costs: [cost({ valueStatus: 'none', totalAmount: null }), cost({ chargeCode: 'nrc', costType: 'nrc', totalAmount: '80' })],
    })
    expect(margin.mrcCost).toBe(0)
    expect(margin.mrcMargin).toBe(100)
    // offer value = 50 (mrc) + 100 (nrc); only the nrc charge is covered
    expect(margin.coverage).toBeCloseTo(66.6667, 3)
  })
  it('no costs: full margin, coverage 0; zero MRC offer gives a null percent; usage never counts', () => {
    expect(computeItemMargin({ mrcAmount: '0', nrcAmount: '0', quantity: 1, charges: null, costs: [] })).toEqual({
      mrcOffer: 0, mrcCost: 0, mrcMargin: 0, mrcMarginPercent: null, nrcOffer: 0, nrcCost: 0, nrcMargin: 0, coverage: 0,
    })
    expect(computeItemMargin({ mrcAmount: '10', nrcAmount: '0', quantity: 1, charges: [{ chargeCode: 'use', chargeType: 'usage', totalPrice: 9 }], costs: [] }).coverage).toBe(0)
  })
})

describe('computeAssetMargin', () => {
  it('NRC margin = purchase price - NRC totals; recurring costs are a recurring cost with no revenue', () => {
    expect(computeAssetMargin({ purchasePrice: '1000', costs: [cost({ costType: 'nrc', totalAmount: '700' }), cost({ totalAmount: '15' })] }))
      .toEqual({ nrcOffer: 1000, nrcCost: 700, nrcMargin: 300, mrcCost: 15 })
  })
})

describe('computeSubscriptionMargin', () => {
  it('sums items and cost-owning assets: a recurring asset cost reduces the MRC margin', () => {
    const item = { mrcAmount: '200', nrcAmount: '0', quantity: 1, charges: [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 200 }] as never, costs: [cost({ totalAmount: '100' })] }
    const asset = { purchasePrice: '500', costs: [cost({ chargeCode: null, totalAmount: '20' }), cost({ chargeCode: null, costType: 'nrc', totalAmount: '400' })] }
    const total = computeSubscriptionMargin([item], [asset])
    expect(total).toMatchObject({ mrcOffer: 200, mrcCost: 120, mrcMargin: 80, nrcOffer: 500, nrcCost: 400, nrcMargin: 100 })
    // offer value 200 (item, covered) + 500 (asset, all costs known)
    expect(total.coverage).toBe(100)
  })
  it('an uncosted live item still counts its offer and drags coverage down', () => {
    const covered = { mrcAmount: '100', nrcAmount: '0', quantity: 1, charges: [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 100 }] as never, costs: [cost({ totalAmount: '40' })] }
    const bare = { mrcAmount: '100', nrcAmount: '0', quantity: 1, charges: [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 100 }] as never, costs: [] }
    expect(computeSubscriptionMargin([covered, bare], [])).toMatchObject({ mrcOffer: 200, mrcCost: 40, mrcMargin: 160, coverage: 50 })
  })
  it('is all zeros for nothing live', () => {
    expect(computeSubscriptionMargin([], [])).toMatchObject({ mrcOffer: 0, mrcMargin: 0, mrcMarginPercent: null, coverage: 0 })
  })
})
