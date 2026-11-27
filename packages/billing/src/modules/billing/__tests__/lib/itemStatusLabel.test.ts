import {
  currentPhasePill,
  currentStatusPill,
  isStatusReadOnly,
  minResumeDate,
  ownBillingPeriod,
  shiftIsoDay,
  upcomingStatusPeriod,
  type PhaseRow,
  type StatusPeriodRow,
} from '../../lib/itemStatusLabel'

function period(partial: Partial<StatusPeriodRow>): StatusPeriodRow {
  return {
    id: 'p1',
    status: 'paused',
    fromDate: '2026-12-01',
    toDate: null,
    chargeBehavior: 'no_charge',
    reason: null,
    ...partial,
  }
}

function phase(partial: Partial<PhaseRow>): PhaseRow {
  return {
    id: 'ph',
    sequence: 0,
    name: null,
    durationUnit: 'month',
    durationCount: 1,
    untilDate: null,
    startDate: '2026-11-14',
    endDate: '2026-12-13',
    priceType: 'free',
    value: null,
    ...partial,
  }
}

describe('currentStatusPill', () => {
  it('returns null with no periods or none in force', () => {
    expect(currentStatusPill(undefined, '2026-12-05')).toBeNull()
    expect(currentStatusPill([period({ fromDate: '2027-01-01' })], '2026-12-05')).toBeNull()
    expect(currentStatusPill([period({ toDate: '2026-12-03' })], '2026-12-05')).toBeNull()
  })

  it('reports a paused period with its end date and no-charge flag', () => {
    expect(currentStatusPill([period({ toDate: '2027-01-15' })], '2026-12-05')).toEqual({
      status: 'paused',
      until: '2027-01-15',
      noCharge: true,
      periodId: 'p1',
    })
  })

  it('includes the first and last day of the period', () => {
    expect(currentStatusPill([period({ toDate: '2026-12-05' })], '2026-12-05')?.status).toBe('paused')
    expect(currentStatusPill([period({})], '2026-12-01')?.status).toBe('paused')
  })

  it('never flags grace as no charge and keeps open-ended suspensions open', () => {
    expect(
      currentStatusPill([period({ status: 'grace', chargeBehavior: 'no_charge' })], '2026-12-05'),
    ).toMatchObject({ status: 'grace', noCharge: false, until: null })
    expect(currentStatusPill([period({ status: 'suspended', chargeBehavior: 'charge' })], '2026-12-05')).toMatchObject({
      status: 'suspended',
      noCharge: false,
    })
  })
})

describe('upcomingStatusPeriod', () => {
  it('finds the earliest period that starts after today', () => {
    const rows = [period({ id: 'b', fromDate: '2027-03-01' }), period({ id: 'a', fromDate: '2027-02-01' }), period({ id: 'c', fromDate: '2026-11-01' })]
    expect(upcomingStatusPeriod(rows, '2026-12-05')?.id).toBe('a')
    expect(upcomingStatusPeriod([], '2026-12-05')).toBeNull()
  })
})

describe('minResumeDate / shiftIsoDay', () => {
  it('is the day after the period start, across month ends', () => {
    expect(minResumeDate({ fromDate: '2026-12-31' })).toBe('2027-01-01')
    expect(shiftIsoDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('currentPhasePill', () => {
  const phases = [
    phase({ id: 'a', sequence: 0, name: 'Free trial', startDate: '2026-11-14', endDate: '2026-12-13' }),
    phase({ id: 'b', sequence: 1, name: 'Intro', priceType: 'percent_off', value: 50, startDate: '2026-12-14', endDate: '2027-03-13' }),
  ]

  it('is null when phases are off or empty', () => {
    expect(currentPhasePill(phases, false, '2026-11-20')).toBeNull()
    expect(currentPhasePill([], true, '2026-11-20')).toBeNull()
  })

  it('picks the phase in force today', () => {
    expect(currentPhasePill(phases, true, '2026-11-20')).toEqual({
      index: 0,
      name: 'Free trial',
      priceType: 'free',
      value: null,
      endDate: '2026-12-13',
      upcoming: false,
    })
    expect(currentPhasePill(phases, true, '2026-12-14')).toMatchObject({ index: 1, priceType: 'percent_off', value: 50 })
  })

  it('shows the first phase as upcoming before the schedule starts', () => {
    expect(currentPhasePill(phases, true, '2026-11-01')).toMatchObject({ index: 0, upcoming: true })
  })

  it('is null once the schedule is over', () => {
    expect(currentPhasePill(phases, true, '2027-03-14')).toBeNull()
  })

  it('orders by sequence regardless of array order', () => {
    expect(currentPhasePill([phases[1], phases[0]], true, '2026-11-20')?.index).toBe(0)
  })
})

describe('ownBillingPeriod', () => {
  it('maps cycles to units and defaults the interval to 1', () => {
    expect(ownBillingPeriod('annually', 1)).toEqual({ unit: 'year', count: 1 })
    expect(ownBillingPeriod('weekly', '2')).toEqual({ unit: 'week', count: 2 })
    expect(ownBillingPeriod('monthly', null)).toEqual({ unit: 'month', count: 1 })
    expect(ownBillingPeriod('daily', 0)).toEqual({ unit: 'day', count: 1 })
  })

  it('is null when the item follows the account', () => {
    expect(ownBillingPeriod(null, null)).toBeNull()
    expect(ownBillingPeriod('fortnightly', 1)).toBeNull()
  })
})

describe('isStatusReadOnly', () => {
  it('is read-only for CPQ lines (subscription id set)', () => {
    expect(isStatusReadOnly({ subscription_id: 'sub-1' })).toBe(true)
    expect(isStatusReadOnly({ subscription_id: '  ' })).toBe(false)
    expect(isStatusReadOnly({ subscription_id: null })).toBe(false)
  })
})
