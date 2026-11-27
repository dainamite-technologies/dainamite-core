import { buildRecurringLineDescriptors } from '../../lib/invoiceWriter'
import { computeRecurringLines } from '../../lib/servicePeriods'
import { resolvePhases } from '../../lib/pricePhases'
import { creditReasonText } from '../../lib/creditReason'
import type { CycleSpec } from '../../lib/billCycle'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const monthly: CycleSpec = { cycle: 'monthly', interval: 1, day: '1' }
const base = { id: 'i', description: 'Internet 200 Mb', chargeTiming: 'in_advance' as const, taxRate: '19', priceBasis: 'net' as const }

describe('recurring line descriptors — phases, grouping, status', () => {
  it('prints the phase name and dates, and a 0.00 line for a free phase', () => {
    const state = {
      id: 'i', chargeTiming: 'in_advance' as const, prorate: true, billStartDate: d('2026-12-01'), unitPrice: 79_900, isActive: true,
      phases: resolvePhases(d('2026-12-01'), [{ name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' }]),
    }
    const [line] = buildRecurringLineDescriptors(base, computeRecurringLines(state, { billDate: d('2026-12-01'), cycle: monthly }).lines)
    expect(line.description).toBe('Internet 200 Mb — Free trial · 2026-12-01 – 2026-12-31')
    expect(line.lineAmount).toBe('0.0000')
    expect(line.metadataExtra).toMatchObject({ phase: { sequence: 0, name: 'Free trial', price_type: 'free' } })
  })

  it('a grouped weekly line carries quantity × unit price and the period count', () => {
    const state = {
      id: 'i', chargeTiming: 'in_arrears' as const, prorate: true, billStartDate: d('2026-12-01'), unitPrice: 15_000, isActive: true,
      billingPeriod: { unit: 'weekly' as const, interval: 1 },
    }
    const lines = computeRecurringLines(state, { billDate: d('2027-01-01'), cycle: monthly }).lines
    const [line] = buildRecurringLineDescriptors({ ...base, description: 'Mobile weekly pack', billingPeriodUnit: 'weekly', billingPeriodInterval: 1 }, lines)
    expect(line).toMatchObject({ description: 'Mobile weekly pack · 2026-12-01 – 2026-12-28', quantity: '4', unitPrice: '15000.0000', lineAmount: '60000.0000' })
    expect(line.metadataExtra).toMatchObject({ billing_period: { unit: 'weekly', interval: 1, count: 4 } })
  })

  it('a late pause credit carries the generated reason "Paused 10 Jan – 19 Jan"', () => {
    const state = {
      id: 'i', chargeTiming: 'in_advance' as const, prorate: true, billStartDate: d('2027-01-01'), billedToDate: d('2027-01-31'), unitPrice: 79_900, isActive: true,
      statusPeriods: [{ id: 'sp', status: 'paused' as const, fromDate: d('2027-01-10'), toDate: d('2027-01-19') }],
    }
    const [credit] = buildRecurringLineDescriptors(base, computeRecurringLines(state, { billDate: d('2027-02-01'), cycle: monthly }).lines)
    expect(credit.lineAmount).toBe('-25774.1900')
    const meta = credit.metadataExtra as { credit_reason: Parameters<typeof creditReasonText>[0]; item_status: unknown }
    expect(meta.item_status).toMatchObject({ status: 'paused', from_date: '2027-01-10', to_date: '2027-01-19', effect: 'credit' })
    expect(creditReasonText(meta.credit_reason, (_k, fallback) => fallback, (day) => day)).toBe('Paused 2027-01-10 – 2027-01-19')
  })

  it('the operator reason on the status period wins over the generated one', () => {
    const state = {
      id: 'i', chargeTiming: 'in_advance' as const, prorate: true, billStartDate: d('2027-01-01'), billedToDate: d('2027-01-31'), unitPrice: 100, isActive: true,
      statusPeriods: [{ id: 'sp', status: 'paused' as const, fromDate: d('2027-01-10'), toDate: d('2027-01-19'), reason: 'Customer travelling' }],
    }
    const [credit] = buildRecurringLineDescriptors(base, computeRecurringLines(state, { billDate: d('2027-02-01'), cycle: monthly }).lines)
    expect((credit.metadataExtra as { credit_reason: unknown }).credit_reason).toEqual({ kind: 'text', text: 'Customer travelling' })
  })

  it('a plain full period keeps the bare description (unchanged behaviour)', () => {
    const state = { id: 'i', chargeTiming: 'in_advance' as const, prorate: true, billStartDate: d('2026-12-01'), unitPrice: 10, isActive: true }
    const [line] = buildRecurringLineDescriptors(base, computeRecurringLines(state, { billDate: d('2026-12-01'), cycle: monthly }).lines)
    expect(line.description).toBe('Internet 200 Mb')
    expect(line.quantity).toBe('1')
  })
})
