import { lineServicePeriod } from '../../lib/linePeriod'

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
