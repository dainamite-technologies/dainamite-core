import {
  advanceNextBillDate,
  clampPeriodToBillingStart,
  cloneAtMidnight,
  cycleContaining,
  deriveBillPeriod,
  gridAnchorFor,
  isCycleDue,
  nextCycleDay,
  onCycleDay,
  previousCycleDay,
  shiftCycles,
} from '../../lib/billPeriod'

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

describe('deriveBillPeriod — spec reference table', () => {
  it('monthly anchor 1: next=2026-06-01 → 2026-05-01..2026-05-31', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-06-01'), 'monthly')
    expect(iso(periodStart)).toBe('2026-05-01')
    expect(iso(periodEnd)).toBe('2026-05-31')
  })

  it('monthly anchor 1: next=2026-03-01 → 2026-02-01..2026-02-28', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-03-01'), 'monthly')
    expect(iso(periodStart)).toBe('2026-02-01')
    expect(iso(periodEnd)).toBe('2026-02-28')
  })

  it('monthly anchor 1: leap year — next=2024-03-01 → 2024-02-01..2024-02-29', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2024-03-01'), 'monthly')
    expect(iso(periodStart)).toBe('2024-02-01')
    expect(iso(periodEnd)).toBe('2024-02-29')
  })

  it('every 3 months on day 1 (quarterly): next=2026-07-01 → 2026-04-01..2026-06-30', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-07-01'), { cycle: 'monthly', interval: 3, day: '1' } as const)
    expect(iso(periodStart)).toBe('2026-04-01')
    expect(iso(periodEnd)).toBe('2026-06-30')
  })

  it('weekly anchor mon: next=2026-05-04 (Mon) → 2026-04-27 (Mon)..2026-05-03 (Sun)', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-05-04'), 'weekly')
    expect(iso(periodStart)).toBe('2026-04-27')
    expect(iso(periodEnd)).toBe('2026-05-03')
  })

  it('annually: next=2026-01-01 → 2025-01-01..2025-12-31', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-01-01'), 'annually')
    expect(iso(periodStart)).toBe('2025-01-01')
    expect(iso(periodEnd)).toBe('2025-12-31')
  })

  it('month-end clamp: next=2026-03-31 → 2026-02-28..2026-03-30 (Feb has 28 days)', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-03-31'), 'monthly')
    expect(iso(periodStart)).toBe('2026-02-28')
    expect(iso(periodEnd)).toBe('2026-03-30')
  })
})

describe('advanceNextBillDate', () => {
  it.each([
    ['monthly', '2026-05-01', '2026-06-01'],
    ['monthly', '2024-01-31', '2024-02-29'], // leap clamp
    ['weekly', '2026-04-27', '2026-05-04'],
    ['annually', '2025-01-01', '2026-01-01'],
  ] as const)('%s: %s → %s', (cycle, from, to) => {
    expect(iso(advanceNextBillDate(date(from), cycle))).toBe(to)
  })

  it('chained advances stay anchored (monthly: 2024-01-31 → … → 2024-04-30)', () => {
    let d = date('2024-01-31')
    d = advanceNextBillDate(d, 'monthly') // → 2024-02-29
    d = advanceNextBillDate(d, 'monthly') // → 2024-03-29 (drifts off 31)
    d = advanceNextBillDate(d, 'monthly') // → 2024-04-29
    // Calendar drift is the documented JS semantic — once we clamp on
    // Feb 29 we lose the "always last day of month" intent. This test
    // pins the behavior so it doesn't quietly change.
    expect(iso(d)).toBe('2024-04-29')
  })
})

describe('isCycleDue', () => {
  it('returns true when nextBillDate ≤ asOfDate', () => {
    expect(isCycleDue(date('2026-06-01'), date('2026-06-01'))).toBe(true)
    expect(isCycleDue(date('2026-05-15'), date('2026-06-01'))).toBe(true)
  })

  it('returns false when nextBillDate > asOfDate', () => {
    expect(isCycleDue(date('2026-06-02'), date('2026-06-01'))).toBe(false)
  })

  it('ignores time-of-day (date-only comparison)', () => {
    const next = new Date('2026-06-01T23:59:59Z')
    const asOf = new Date('2026-06-01T00:00:00Z')
    expect(isCycleDue(next, asOf)).toBe(true)
  })
})

describe('cloneAtMidnight', () => {
  it('zeros UTC time without mutating the source', () => {
    const src = new Date('2026-06-01T13:45:30Z')
    const result = cloneAtMidnight(src)
    expect(result.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(src.toISOString()).toBe('2026-06-01T13:45:30.000Z')
  })
})

describe('cycleContaining', () => {
  it.each([
    // anchor (a known boundary), cycle, target, expectedStart, expectedEnd
    ['2026-06-01', 'monthly', '2026-05-15', '2026-05-01', '2026-05-31'],
    ['2026-06-01', 'monthly', '2026-06-01', '2026-06-01', '2026-06-30'], // anchor = cycle start
    ['2026-06-01', 'monthly', '2026-06-10', '2026-06-01', '2026-06-30'],
    ['2026-06-01', 'monthly', '2026-07-15', '2026-07-01', '2026-07-31'], // walk forward
    ['2026-06-01', 'monthly', '2026-02-15', '2026-02-01', '2026-02-28'], // walk backward
    ['2026-05-04', 'weekly', '2026-05-06', '2026-05-04', '2026-05-10'],
  ] as const)('%s %s containing %s → %s..%s', (anchor, cycle, target, start, end) => {
    const period = cycleContaining(date(anchor), cycle, date(target))
    expect(iso(period.periodStart)).toBe(start)
    expect(iso(period.periodEnd)).toBe(end)
  })

  it('accepts YYYY-MM-DD strings for anchor and target', () => {
    const period = cycleContaining('2026-06-01', 'monthly', '2026-05-15')
    expect(iso(period.periodStart)).toBe('2026-05-01')
    expect(iso(period.periodEnd)).toBe('2026-05-31')
  })
})

describe('bill cycle day — pinned cycles', () => {
  const monthlyOn = (day: string, interval = 1) => ({ cycle: 'monthly' as const, interval, day })

  it('re-pins month-end days instead of drifting (31 → 28/29 Feb → 31 Mar)', () => {
    const spec = monthlyOn('31')
    let d = date('2024-01-31')
    d = advanceNextBillDate(d, spec)
    expect(iso(d)).toBe('2024-02-29')
    d = advanceNextBillDate(d, spec)
    expect(iso(d)).toBe('2024-03-31')
    d = advanceNextBillDate(d, spec)
    expect(iso(d)).toBe('2024-04-30')
  })

  it('treats a clamped month-end as on the cycle day', () => {
    expect(onCycleDay(date('2026-02-28'), monthlyOn('30'))).toBe(true)
    expect(onCycleDay(date('2026-02-27'), monthlyOn('30'))).toBe(false)
    expect(onCycleDay(date('2026-04-30'), monthlyOn('31'))).toBe(true)
  })

  it('every N months / years / weeks / days', () => {
    expect(iso(advanceNextBillDate(date('2026-01-15'), monthlyOn('15', 6)))).toBe('2026-07-15')
    expect(iso(advanceNextBillDate(date('2026-03-15'), { cycle: 'annually', interval: 2, day: '15' }))).toBe('2028-03-15')
    expect(iso(advanceNextBillDate(date('2026-11-16'), { cycle: 'weekly', interval: 2, day: 'mon' }))).toBe('2026-11-30')
    expect(iso(advanceNextBillDate(date('2026-11-16'), { cycle: 'daily', interval: 30, day: null }))).toBe('2026-12-16')
  })

  it('every 30 days walks across month ends without calendar rounding', () => {
    const spec = { cycle: 'daily' as const, interval: 30, day: null }
    let d = date('2026-01-31')
    d = advanceNextBillDate(d, spec)
    expect(iso(d)).toBe('2026-03-02')
    expect(deriveBillPeriod(d, spec)).toEqual({ periodStart: date('2026-01-31'), periodEnd: date('2026-03-01') })
  })

  it('an off-day bill date aligns to the next cycle day (one short period)', () => {
    expect(iso(advanceNextBillDate(date('2026-11-16'), monthlyOn('1')))).toBe('2026-12-01')
    expect(iso(advanceNextBillDate(date('2026-11-16'), monthlyOn('20')))).toBe('2026-11-20')
    expect(iso(advanceNextBillDate(date('2026-11-18'), { cycle: 'weekly', interval: 1, day: 'mon' }))).toBe('2026-11-23')
  })

  it('next / previous cycle day', () => {
    expect(iso(nextCycleDay(date('2026-11-16'), monthlyOn('15')))).toBe('2026-12-15')
    expect(iso(nextCycleDay(date('2026-11-15'), monthlyOn('15')))).toBe('2026-11-15')
    expect(iso(nextCycleDay(date('2026-02-10'), monthlyOn('31')))).toBe('2026-02-28')
    expect(iso(previousCycleDay(date('2026-11-16'), monthlyOn('20')))).toBe('2026-10-20')
    expect(iso(previousCycleDay(date('2026-11-18'), { cycle: 'weekly', interval: 1, day: 'mon' }))).toBe('2026-11-16')
  })

  it('deriveBillPeriod starts the day after the last billed period when known', () => {
    // Day changed from 15 to 1: last billed through 14 Nov, next bill 1 Dec.
    expect(deriveBillPeriod(date('2026-12-01'), monthlyOn('1'), date('2026-11-14'))).toEqual({
      periodStart: date('2026-11-15'),
      periodEnd: date('2026-11-30'),
    })
    // Without history: one cycle back.
    expect(deriveBillPeriod(date('2026-12-01'), monthlyOn('1'))).toEqual({
      periodStart: date('2026-11-01'),
      periodEnd: date('2026-11-30'),
    })
  })

  it('gridAnchorFor and cycleContaining follow the pinned grid', () => {
    expect(iso(gridAnchorFor(date('2026-11-16'), monthlyOn('1')))).toBe('2026-11-01')
    const period = cycleContaining(date('2026-07-01'), monthlyOn('1', 3), date('2026-05-20'))
    expect(iso(period.periodStart)).toBe('2026-04-01')
    expect(iso(period.periodEnd)).toBe('2026-06-30')
    const days30 = cycleContaining('2026-01-01', { cycle: 'daily', interval: 30, day: null }, '2026-02-15')
    expect(iso(days30.periodStart)).toBe('2026-01-31')
    expect(iso(days30.periodEnd)).toBe('2026-03-01')
  })

  it('shiftCycles from a clamped anchor lands back on the pinned day', () => {
    expect(iso(shiftCycles(date('2026-02-28'), monthlyOn('31'), 1))).toBe('2026-03-31')
    expect(iso(shiftCycles(date('2026-02-28'), monthlyOn('31'), -1))).toBe('2026-01-31')
  })
})

describe('clampPeriodToBillingStart — first-cycle rule (#138)', () => {
  const cycleDay10 = { cycle: 'monthly' as const, interval: 1, day: '10' }

  it('returns null when the derived first period lies entirely before the billing start', () => {
    // First bill date = start date: deriveBillPeriod reaches one full cycle back.
    const derived = deriveBillPeriod(date('2026-11-10'), cycleDay10)
    expect([iso(derived.periodStart), iso(derived.periodEnd)]).toEqual(['2026-10-10', '2026-11-09'])
    expect(clampPeriodToBillingStart(derived, date('2026-11-10'))).toBeNull()
    // MikroORM date columns hydrate as strings.
    expect(clampPeriodToBillingStart(derived, '2026-11-10')).toBeNull()
  })

  it('clamps the start when the billing start falls inside the period', () => {
    const derived = deriveBillPeriod(date('2026-11-10'), cycleDay10)
    const clamped = clampPeriodToBillingStart(derived, '2026-10-20')!
    expect([iso(clamped.periodStart), iso(clamped.periodEnd)]).toEqual(['2026-10-20', '2026-11-09'])
    // Start on the last day still leaves a one-day period.
    const lastDay = clampPeriodToBillingStart(derived, '2026-11-09')!
    expect([iso(lastDay.periodStart), iso(lastDay.periodEnd)]).toEqual(['2026-11-09', '2026-11-09'])
  })

  it('leaves the period unchanged when the billing start is on / before it, or unknown', () => {
    const derived = deriveBillPeriod(date('2026-11-10'), cycleDay10)
    expect(clampPeriodToBillingStart(derived, '2026-10-10')).toBe(derived)
    expect(clampPeriodToBillingStart(derived, '2026-01-01')).toBe(derived)
    expect(clampPeriodToBillingStart(derived, null)).toBe(derived)
    expect(clampPeriodToBillingStart(derived, undefined)).toBe(derived)
  })
})
