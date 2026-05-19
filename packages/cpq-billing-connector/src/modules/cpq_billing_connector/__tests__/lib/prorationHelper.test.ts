import {
  computeProration,
  formatProrationDescription,
} from '../../lib/prorationHelper'

describe('computeProration', () => {
  it('canonical spec example: 29 EUR × 17/31 → 15.90 (Story 2)', () => {
    const result = computeProration({
      unitPrice: 29,
      quantity: 1,
      daysInPeriod: 31,
      daysRemaining: 17,
    })
    // 29 × 17 / 31 = 15.903225… → 15.90
    expect(result.amount).toBe(15.9)
    expect(result.amountString).toBe('15.9000')
  })

  it('full-period proration equals full unit_price × quantity', () => {
    const result = computeProration({
      unitPrice: 49.99,
      quantity: 2,
      daysInPeriod: 30,
      daysRemaining: 30,
    })
    expect(result.amount).toBe(99.98)
  })

  it('zero days remaining → zero amount', () => {
    const result = computeProration({
      unitPrice: 49,
      quantity: 1,
      daysInPeriod: 30,
      daysRemaining: 0,
    })
    expect(result.amount).toBe(0)
  })

  it('rounds half-up to 2dp', () => {
    // 1 × 1 × 1 / 200 = 0.005 → 0.01 (half-up)
    const result = computeProration({
      unitPrice: 1,
      quantity: 1,
      daysInPeriod: 200,
      daysRemaining: 1,
    })
    expect(result.amount).toBe(0.01)
    expect(result.amountString).toBe('0.0100')
  })

  it('defends against daysInPeriod === 0 (degenerate input)', () => {
    const result = computeProration({
      unitPrice: 49,
      quantity: 1,
      daysInPeriod: 0,
      daysRemaining: 5,
    })
    expect(result.amount).toBe(0)
  })

  it('clamps negative daysRemaining to 0 (defensive)', () => {
    const result = computeProration({
      unitPrice: 49,
      quantity: 1,
      daysInPeriod: 30,
      daysRemaining: -3,
    })
    expect(result.amount).toBe(0)
  })

  it('scales by quantity correctly', () => {
    // 10 seats × 5 EUR × 15/30 = 25 EUR
    const result = computeProration({
      unitPrice: 5,
      quantity: 10,
      daysInPeriod: 30,
      daysRemaining: 15,
    })
    expect(result.amount).toBe(25)
  })
})

describe('formatProrationDescription', () => {
  it('matches the spec example phrasing', () => {
    expect(
      formatProrationDescription({
        productName: 'Package X',
        effectiveDate: '2026-05-15',
        cycleEnd: '2026-05-31',
      }),
    ).toBe('Proration: Package X from 2026-05-15 to 2026-05-31')
  })
})
