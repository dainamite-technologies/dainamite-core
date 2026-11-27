import {
  billingPeriodKey,
  billingPeriodMonths,
  buildRecurringPayloadCharges,
  chargeMonthlyTotal,
  normalizeBillingPeriod,
  recurringChargesByPeriod,
  sumMonthlyRecurring,
  toMonthlyEquivalent,
} from '../chargeBillingPeriod'
import { cpqProductChargeCreateSchema, cpqProductChargeUpdateSchema } from '../../data/validators'

const yearly = { unit: 'year' as const, interval: 1 }
const mrc = (totalPrice: number, billingPeriod?: { unit: 'month' | 'year'; interval: number }) =>
  ({ chargeType: 'mrc', totalPrice, ...(billingPeriod ? { billingPeriod } : {}) })

describe('charge billing period (D5)', () => {
  it('normalizes stored values; anything unknown reads as every 1 month', () => {
    expect(normalizeBillingPeriod(undefined)).toEqual({ unit: 'month', interval: 1 })
    expect(normalizeBillingPeriod({ unit: 'week', interval: 0 })).toEqual({ unit: 'month', interval: 1 })
    expect(normalizeBillingPeriod({ billingPeriodUnit: 'year', billingPeriodInterval: 2 })).toEqual({ unit: 'year', interval: 2 })
  })

  it('converts a price per period to the monthly equivalent (480,000 / year → 40,000)', () => {
    expect(billingPeriodMonths(yearly)).toBe(12)
    expect(toMonthlyEquivalent(480000, yearly)).toBe(40000)
    expect(toMonthlyEquivalent(90, { unit: 'month', interval: 3 })).toBe(30)
    expect(toMonthlyEquivalent(79900, { unit: 'month', interval: 1 })).toBe(79900)
    expect(billingPeriodKey(yearly)).toBe('1y')
  })

  it('MRC totals use the monthly equivalent; NRC is untouched', () => {
    expect(sumMonthlyRecurring([mrc(79900), mrc(480000, yearly), { chargeType: 'nrc', totalPrice: 100 }])).toBe(119900)
    expect(chargeMonthlyTotal({ chargeType: 'nrc', totalPrice: 100 })).toBe(100)
    expect(chargeMonthlyTotal(mrc(480000, yearly), 240000)).toBe(20000)
  })

  it('a monthly-only line keeps exactly today\'s single recurring charge', () => {
    expect(buildRecurringPayloadCharges([mrc(30)], 2, 60)).toEqual([{ type: 'recurring', unitPrice: 60, description: 'Recurring charge' }])
    expect(buildRecurringPayloadCharges(null, 1, 45)).toEqual([{ type: 'recurring', unitPrice: 45, description: 'Recurring charge' }])
  })

  it('emits one recurring charge per distinct period, priced per that period (quantity applied)', () => {
    // Internet 79,900 / month + Mobile 480,000 / year, quantity 2. Line MRC (monthly equivalent) = 2 × 119,900.
    expect(recurringChargesByPeriod([mrc(79900), mrc(480000, yearly)], 2, 239800)).toEqual([
      { billingPeriod: { unit: 'month', interval: 1 }, unitPrice: 159800 },
      { billingPeriod: yearly, unitPrice: 960000 },
    ])
    expect(buildRecurringPayloadCharges([mrc(480000, yearly)], 1, 40000)).toEqual([
      { type: 'recurring', unitPrice: 480000, description: 'Recurring charge', billingPeriod: yearly },
    ])
  })

  it('review F1: the monthly charge does not absorb the qty-multiplied rounding of a yearly charge', () => {
    // M = 50 / month + Y = 100 / year, quantity 1000. Line MRC as stored = round4(50 + 8.3333) × 1000 = 58,333.3.
    const charges = [mrc(50), mrc(100, yearly)]
    const lineMrc = sumMonthlyRecurring(charges) * 1000
    expect(recurringChargesByPeriod(charges, 1000, lineMrc)).toEqual([
      { billingPeriod: { unit: 'month', interval: 1 }, unitPrice: 50000 },
      { billingPeriod: yearly, unitPrice: 100000 },
    ])
    // The phases of the monthly entry and its unitPrice use the same amount.
    const phased = { ...mrc(50), schedule: [
      { fromMonth: 1, toMonth: 3, unitPrice: 0, totalPrice: 0, standardUnitPrice: 0, standardTotalPrice: 0, source: 'manual', name: 'Trial' },
      { fromMonth: 4, toMonth: null, unitPrice: 50, totalPrice: 50, standardUnitPrice: 50, standardTotalPrice: 50, source: 'list', name: null },
    ] }
    const [monthly] = buildRecurringPayloadCharges([phased, mrc(100, yearly)], 1000, lineMrc)
    expect(monthly).toEqual({ type: 'recurring', unitPrice: 50000, description: 'Recurring charge',
      phases: [{ name: 'Trial', months: 3, priceType: 'fixed', value: 0 }] })
  })

  it('review F1: per-period amounts are summed unrounded and rounded once', () => {
    // Three yearly charges of 0.00004 × qty 1 each round to 0 per charge but sum to 0.0001.
    expect(recurringChargesByPeriod([mrc(0.00004, yearly), mrc(0.00004, yearly), mrc(0.00004, yearly)], 1, 0)).toEqual([
      { billingPeriod: yearly, unitPrice: 0.0001 },
    ])
  })

  it('groups charges of the same period and orders periods by length', () => {
    const quarterly = { unit: 'month' as const, interval: 3 }
    expect(recurringChargesByPeriod([mrc(100, yearly), mrc(30, quarterly), mrc(20, yearly)], 1, 20)).toEqual([
      { billingPeriod: quarterly, unitPrice: 30 },
      { billingPeriod: yearly, unitPrice: 120 },
    ])
  })

  it('validators: only an MRC charge can have a non-monthly period (V-CHG-2)', () => {
    const base = { code: 'mob', name: 'Mobile', pricingMethod: 'fixed', chargeModel: 'flat', fixedPrice: '480000', currencyCode: 'COP' }
    expect(cpqProductChargeCreateSchema.safeParse({ ...base, chargeType: 'mrc', billingPeriodUnit: 'year', billingPeriodInterval: 1 }).success).toBe(true)
    const nrc = cpqProductChargeCreateSchema.safeParse({ ...base, chargeType: 'nrc', billingPeriodUnit: 'year' })
    expect(nrc.success).toBe(false)
    expect(cpqProductChargeCreateSchema.safeParse({ ...base, chargeType: 'mrc', billingPeriodUnit: 'week' }).success).toBe(false)
    expect(cpqProductChargeCreateSchema.safeParse({ ...base, chargeType: 'mrc', billingPeriodInterval: 0 }).success).toBe(false)
  })

  it('validators: the update schema injects no period default', () => {
    const parsed = cpqProductChargeUpdateSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'Renamed' })
    expect(parsed).not.toHaveProperty('billingPeriodUnit')
    expect(parsed).not.toHaveProperty('billingPeriodInterval')
  })
})
