import { DefaultTaxCalculationService } from '@open-mercato/core/modules/sales/services/taxCalculationService'
import { lineAmountsFromGross, lineAmountsFromNet, money4, round2, sumTotals } from '../../lib/vat'

describe('vat', () => {
  it('rounds half-up symmetrically', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(2.675)).toBe(2.68)
  })

  it('computes from net with net + tax = gross', () => {
    expect(lineAmountsFromNet(100, 23)).toEqual({ net: 100, tax: 23, gross: 123 })
    expect(lineAmountsFromNet(56.67, 23)).toEqual({ net: 56.67, tax: 13.03, gross: 69.7 })
    expect(lineAmountsFromNet(10, 0)).toEqual({ net: 10, tax: 0, gross: 10 })
    expect(lineAmountsFromNet(-51.61, 23)).toEqual({ net: -51.61, tax: -11.87, gross: -63.48 })
  })

  it('splits gross with net + tax = gross exactly', () => {
    for (const [gross, rate] of [[100, 23], [99.99, 8], [0.01, 23], [123, 5], [50, 0]] as const) {
      const r = lineAmountsFromGross(gross, rate)
      expect(round2(r.net + r.tax)).toBe(r.gross)
      expect(r.gross).toBe(round2(gross))
    }
    expect(lineAmountsFromGross(123, 23)).toEqual({ net: 100, tax: 23, gross: 123 })
  })

  it('sums rounded lines into 4dp column strings', () => {
    expect(sumTotals([lineAmountsFromNet(100, 23), lineAmountsFromNet(56.67, 23)])).toEqual({
      subtotalNet: '156.6700',
      taxTotal: '36.0300',
      totalGross: '192.7000',
    })
    expect(money4(Number.NaN)).toBe('0.0000')
  })

  it('stays within half a cent of the core tax service (gross split parity)', async () => {
    const core = new DefaultTaxCalculationService({} as never)
    for (const [gross, rate] of [[100, 23], [99.99, 8], [250, 5], [1234.56, 23], [0.99, 23]] as const) {
      const ours = lineAmountsFromGross(gross, rate)
      const theirs = await core.calculateUnitAmounts({
        amount: gross,
        mode: 'gross',
        organizationId: 'o',
        tenantId: 't',
        taxRate: rate,
      })
      expect(Math.abs(ours.net - theirs.netAmount)).toBeLessThanOrEqual(0.005)
      expect(Math.abs(ours.tax - theirs.taxAmount)).toBeLessThanOrEqual(0.005)
    }
  })
})
