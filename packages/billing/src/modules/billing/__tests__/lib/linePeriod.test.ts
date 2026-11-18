import { lineServicePeriod, transactionServicePeriod } from '../../lib/linePeriod'

describe('lineServicePeriod', () => {
  it('returns the stored period for a full-period recurring line', () => {
    expect(
      lineServicePeriod({ description: 'Recurring Fee', servicePeriodStart: '2026-12-01', servicePeriodEnd: '2026-12-31' }),
    ).toEqual({ start: '2026-12-01', end: '2026-12-31' })
  })

  it('skips lines whose description already carries the dates (prorated / credit)', () => {
    expect(
      lineServicePeriod({
        description: 'Recurring Fee · 2026-12-01 – 2026-12-14',
        servicePeriodStart: '2026-12-01',
        servicePeriodEnd: '2026-12-14',
      }),
    ).toBeNull()
  })

  it('returns null when either bound is missing (one-time / manual lines)', () => {
    expect(lineServicePeriod({ description: 'Setup', servicePeriodStart: null, servicePeriodEnd: null })).toBeNull()
    expect(lineServicePeriod({ description: 'Setup', servicePeriodStart: '2026-12-01', servicePeriodEnd: null })).toBeNull()
  })

  it('tolerates a missing description', () => {
    expect(lineServicePeriod({ description: null, servicePeriodStart: '2026-12-01', servicePeriodEnd: '2026-12-31' })).not.toBeNull()
  })
})

describe('transactionServicePeriod (#130)', () => {
  it('returns the period stored in metadata for a full-period recurring charge', () => {
    expect(
      transactionServicePeriod({
        description: 'FTTH 900 Mbps',
        metadata: { service_period_start: '2026-12-12', service_period_end: '2027-01-11' },
      }),
    ).toEqual({ start: '2026-12-12', end: '2027-01-11' })
  })

  it('skips prorated charges whose description already shows the dates', () => {
    expect(
      transactionServicePeriod({
        description: 'FTTH 900 Mbps · 2026-11-16 – 2026-12-11',
        metadata: { service_period_start: '2026-11-16', service_period_end: '2026-12-11' },
      }),
    ).toBeNull()
  })

  it('returns null for movements without a service period (top-ups, adjustments, usage)', () => {
    expect(transactionServicePeriod({ description: 'Top-up', metadata: null })).toBeNull()
    expect(transactionServicePeriod({ description: 'Adjustment', metadata: undefined })).toBeNull()
    expect(
      transactionServicePeriod({
        description: 'Usage',
        metadata: { service_period_start: null, service_period_end: null },
      }),
    ).toBeNull()
  })

  it('ignores non-string metadata values', () => {
    expect(
      transactionServicePeriod({
        description: 'Fee',
        metadata: { service_period_start: 20261201, service_period_end: {} },
      }),
    ).toBeNull()
  })
})
