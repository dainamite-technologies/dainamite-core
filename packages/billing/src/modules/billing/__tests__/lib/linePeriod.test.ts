import { lineServicePeriod, localizeDescriptionPeriod, transactionServicePeriod } from '../../lib/linePeriod'

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

describe('localizeDescriptionPeriod (#129)', () => {
  const day = (iso: string) => iso.split('-').reverse().join('/')

  it('re-renders the stored ISO period at the end of a prorated / credit description', () => {
    expect(localizeDescriptionPeriod('Recurring Fee · 2026-11-16 – 2026-12-11', day)).toBe('Recurring Fee · 16/11/2026 – 11/12/2026')
  })

  it('leaves descriptions without a stored period untouched, including dates typed by the user', () => {
    expect(localizeDescriptionPeriod('Recurring Fee', day)).toBe('Recurring Fee')
    expect(localizeDescriptionPeriod('Promo 2026-01-01 – 2026-02-01', day)).toBe('Promo 2026-01-01 – 2026-02-01')
    expect(localizeDescriptionPeriod('Fee · 2026-11-16 – 2026-12-11 (adjusted)', day)).toBe('Fee · 2026-11-16 – 2026-12-11 (adjusted)')
  })

  it('maps empty input to an empty string', () => {
    expect(localizeDescriptionPeriod(null, day)).toBe('')
    expect(localizeDescriptionPeriod(undefined, day)).toBe('')
    expect(localizeDescriptionPeriod('', day)).toBe('')
  })

  it('keeps lineServicePeriod detection working on the localized text', () => {
    const localized = localizeDescriptionPeriod('Fee · 2026-12-01 – 2026-12-14', day)
    expect(lineServicePeriod({ description: localized, servicePeriodStart: '2026-12-01', servicePeriodEnd: '2026-12-14' })).toBeNull()
  })
})
