import { counterpartAmount, lineVat, priceBasisOf, unitPriceNetOf } from '../../lib/lineAmounts'
import { billingItemCreateSchema, isTieredRate } from '../../data/validators'

describe('lineVat (Spec F, F-D2)', () => {
  it('net basis: tax on top of the net', () => {
    expect(lineVat({ amount: 49, priceBasis: 'net', taxRate: 23 })).toEqual({ net: 49, tax: 11.27, gross: 60.27 })
  })

  it('gross basis: the typed gross is reproduced exactly, for every cent', () => {
    // Net-only storage cannot reach ~1 in 5 gross values at 23 %; the basis can.
    for (let cents = 4900; cents <= 5100; cents += 1) {
      const gross = cents / 100
      const vat = lineVat({ amount: gross, priceBasis: 'gross', taxRate: 23 })
      expect(vat.gross).toBe(gross)
      expect(Math.round((vat.net + vat.tax) * 100)).toBe(cents)
    }
  })

  it('gross basis: rounds once on the extended amount (quantity / proration)', () => {
    // 3 × 12.30 gross = 36.90 → net 30.00, tax 6.90 (not 3 × rounded unit nets).
    expect(lineVat({ amount: 36.9, priceBasis: 'gross', taxRate: 23 })).toEqual({ net: 30, tax: 6.9, gross: 36.9 })
    // Prorated 16/30 of 49.99 gross = 26.66 (2 dp) → split on that amount.
    const prorated = lineVat({ amount: 26.66, priceBasis: 'gross', taxRate: 23 })
    expect(prorated.gross).toBe(26.66)
    expect(prorated.net).toBe(21.67)
  })

  it('0 % VAT: net = gross on both bases; negative amounts keep their sign', () => {
    expect(lineVat({ amount: 20, priceBasis: 'gross', taxRate: 0 })).toEqual({ net: 20, tax: 0, gross: 20 })
    expect(lineVat({ amount: '-12.30', priceBasis: 'gross', taxRate: '23' })).toEqual({ net: -10, tax: -2.3, gross: -12.3 })
  })
})

describe('price basis helpers', () => {
  it('priceBasisOf treats anything but gross as net', () => {
    expect(priceBasisOf('gross')).toBe('gross')
    expect(priceBasisOf('net')).toBe('net')
    expect(priceBasisOf(undefined)).toBe('net')
  })

  it('unitPriceNetOf keeps the net price and derives it from a gross one (4 dp)', () => {
    expect(unitPriceNetOf(49, 'net', 23)).toBe('49.0000')
    expect(unitPriceNetOf(60.27, 'gross', 23)).toBe('49.0000')
    expect(unitPriceNetOf(10, 'gross', 0)).toBe('10.0000')
  })

  it('counterpartAmount shows the other side for the form preview', () => {
    expect(counterpartAmount(49, 'net', 23)).toBe(60.27)
    expect(counterpartAmount(60.27, 'gross', 23)).toBe(49)
  })
})

describe('item validators — price basis', () => {
  const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    billAccountId: '33333333-3333-4333-8333-333333333333',
    billStartDate: '2026-11-14',
    description: 'Plan',
  }

  it('accepts a gross basis on recurring and simple usage rates', () => {
    expect(billingItemCreateSchema.safeParse({ ...base, type: 'recurring', rateJson: { unit_price: 60 }, priceBasis: 'gross' }).success).toBe(true)
    expect(
      billingItemCreateSchema.safeParse({ ...base, type: 'usage', uomCode: 'gb', rateJson: { unit_price: 0.5 }, priceBasis: 'gross' }).success,
    ).toBe(true)
  })

  it('rejects a gross basis on a tiered usage rate', () => {
    const result = billingItemCreateSchema.safeParse({
      ...base,
      type: 'usage',
      uomCode: 'gb',
      priceBasis: 'gross',
      rateJson: { model: 'volume', tiers: [{ up_to: null, unit_price: 1 }] },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((i) => i.message)).toContain('billing.item.gross_tiered_unsupported')
  })

  it('isTieredRate recognises the tiered shape only', () => {
    expect(isTieredRate({ model: 'graduated', tiers: [] })).toBe(true)
    expect(isTieredRate({ unit_price: 1 })).toBe(false)
    expect(isTieredRate(null)).toBe(false)
  })
})
