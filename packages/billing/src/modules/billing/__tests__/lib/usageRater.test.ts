import { rateUsageForItem, rateUsageQuantity } from '../../lib/usageRater'
import type { BillingItem } from '../../data/entities'

describe('rateUsageQuantity — simple flat rate', () => {
  it('charges quantity × unit_price (canonical case)', () => {
    const result = rateUsageQuantity({ unit_price: 0.001 }, 12000)
    expect(result.amount).toBe('12.0000')
    expect(result.breakdown).toEqual([
      { tierIndex: 0, upTo: null, rangeQuantity: 12000, rate: 0.001, amount: '12.0000' },
    ])
  })

  it('returns zero on zero quantity', () => {
    const result = rateUsageQuantity({ unit_price: 0.001 }, 0)
    expect(result.amount).toBe('0.0000')
  })

  it('rounds half-up to 2dp (1.005 → 1.01)', () => {
    // unit_price=0.001 × quantity=1005 = 1.005 → 1.01
    const result = rateUsageQuantity({ unit_price: 0.001 }, 1005)
    expect(result.amount).toBe('1.0100')
  })

  it('safe-guards negative quantity (treated as 0)', () => {
    const result = rateUsageQuantity({ unit_price: 0.001 }, -100)
    expect(result.amount).toBe('0.0000')
  })
})

describe('rateUsageQuantity — volume tier (whole-quantity at top reached tier)', () => {
  const volumeLadder = {
    model: 'volume' as const,
    tiers: [
      { up_to: 10000, unit_price: 0 },
      { up_to: 50000, unit_price: 0.001 },
      { up_to: null, unit_price: 0.0005 },
    ],
  }

  it('25k requests at [10k=0, 50k=0.001, ∞=0.0005] → 25000 × 0.001 = 25 EUR (spec example)', () => {
    const result = rateUsageQuantity(volumeLadder, 25000)
    expect(result.amount).toBe('25.0000')
    expect(result.breakdown[0].rangeQuantity).toBe(0)
    expect(result.breakdown[1].rangeQuantity).toBe(25000)
    expect(result.breakdown[2].rangeQuantity).toBe(0)
  })

  it('5k requests fall into the bottom (free) tier → 0 EUR', () => {
    const result = rateUsageQuantity(volumeLadder, 5000)
    expect(result.amount).toBe('0.0000')
    expect(result.breakdown[0].rangeQuantity).toBe(5000)
  })

  it('100k requests overflow into the open-ended top tier → 100k × 0.0005 = 50 EUR', () => {
    const result = rateUsageQuantity(volumeLadder, 100000)
    expect(result.amount).toBe('50.0000')
    expect(result.breakdown[2].rangeQuantity).toBe(100000)
  })

  it('exact boundary (50k) stays in the middle tier — 50000 × 0.001 = 50', () => {
    const result = rateUsageQuantity(volumeLadder, 50000)
    expect(result.amount).toBe('50.0000')
    expect(result.breakdown[1].rangeQuantity).toBe(50000)
  })
})

describe('rateUsageQuantity — graduated tier (per-unit at tier)', () => {
  const graduatedLadder = {
    model: 'graduated' as const,
    tiers: [
      { up_to: 10000, unit_price: 0 },
      { up_to: null, unit_price: 0.001 },
    ],
  }

  it('25k requests at [10k=0, ∞=0.001] → 10k×0 + 15k×0.001 = 15 EUR (spec example)', () => {
    const result = rateUsageQuantity(graduatedLadder, 25000)
    expect(result.amount).toBe('15.0000')
    expect(result.breakdown[0].rangeQuantity).toBe(10000)
    expect(result.breakdown[0].amount).toBe('0.0000')
    expect(result.breakdown[1].rangeQuantity).toBe(15000)
    expect(result.breakdown[1].amount).toBe('15.0000')
  })

  it('5k requests stay in the free tier → 0 EUR', () => {
    const result = rateUsageQuantity(graduatedLadder, 5000)
    expect(result.amount).toBe('0.0000')
    expect(result.breakdown[0].rangeQuantity).toBe(5000)
    expect(result.breakdown[1].rangeQuantity).toBe(0)
  })

  it('exactly 10k stays free (boundary inclusive of the lower tier)', () => {
    const result = rateUsageQuantity(graduatedLadder, 10000)
    expect(result.amount).toBe('0.0000')
  })

  it('three-tier ladder splits correctly', () => {
    const ladder = {
      model: 'graduated' as const,
      tiers: [
        { up_to: 100, unit_price: 1 },
        { up_to: 200, unit_price: 0.5 },
        { up_to: null, unit_price: 0.1 },
      ],
    }
    const result = rateUsageQuantity(ladder, 350)
    // 100 × 1 + 100 × 0.5 + 150 × 0.1 = 100 + 50 + 15 = 165
    expect(result.amount).toBe('165.0000')
  })
})

describe('rateUsageQuantity — flat tier (one fee for highest tier reached)', () => {
  const flatLadder = {
    model: 'flat' as const,
    tiers: [
      { up_to: 10000, flat_amount: 50 },
      { up_to: 50000, flat_amount: 200 },
      { up_to: null, flat_amount: 1000 },
    ],
  }

  it('25k requests → top tier reached is 50k → 200 EUR (spec example)', () => {
    const result = rateUsageQuantity(flatLadder, 25000)
    expect(result.amount).toBe('200.0000')
    expect(result.breakdown[1].amount).toBe('200.0000')
  })

  it('exactly 10k → bottom tier → 50 EUR', () => {
    const result = rateUsageQuantity(flatLadder, 10000)
    expect(result.amount).toBe('50.0000')
  })

  it('overflows into open-ended top tier → 1000 EUR', () => {
    const result = rateUsageQuantity(flatLadder, 75000)
    expect(result.amount).toBe('1000.0000')
  })

  it('zero quantity still hits the bottom tier (consistent with billable presence)', () => {
    const result = rateUsageQuantity(flatLadder, 0)
    // 0 is ≤ first tier's up_to=10000, so the rate is 50 EUR.
    expect(result.amount).toBe('50.0000')
  })
})

describe('rateUsageForItem (dispatch wrapper)', () => {
  function makeItem(rate: unknown, type: 'usage' | 'recurring' = 'usage'): BillingItem {
    return {
      id: 'i1',
      type,
      rateJson: rate,
    } as unknown as BillingItem
  }

  it('returns null for non-usage items (defensive)', () => {
    expect(rateUsageForItem(makeItem({ unit_price: 0.001 }, 'recurring'), 100)).toBeNull()
  })

  it('returns null for null rateJson', () => {
    expect(rateUsageForItem(makeItem(null), 100)).toBeNull()
  })

  it('returns null for tiered rate with empty tiers array', () => {
    expect(
      rateUsageForItem(makeItem({ model: 'graduated', tiers: [] }), 100),
    ).toBeNull()
  })

  it('returns null for simple rate missing unit_price', () => {
    expect(rateUsageForItem(makeItem({}), 100)).toBeNull()
  })

  it('dispatches to simple-flat path for { unit_price }', () => {
    const result = rateUsageForItem(makeItem({ unit_price: 0.001 }), 12000)
    expect(result?.amount).toBe('12.0000')
  })

  it('dispatches to graduated path for { model: graduated, tiers }', () => {
    const result = rateUsageForItem(
      makeItem({
        model: 'graduated',
        tiers: [
          { up_to: 10000, unit_price: 0 },
          { up_to: null, unit_price: 0.001 },
        ],
      }),
      25000,
    )
    expect(result?.amount).toBe('15.0000')
  })
})
