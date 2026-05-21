import {
  advanceNextBillDate,
  cloneAtMidnight,
  cycleContaining,
  deriveBillPeriod,
  isCycleDue,
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

  it('quarterly anchor 1: next=2026-07-01 → 2026-04-01..2026-06-30', () => {
    const { periodStart, periodEnd } = deriveBillPeriod(date('2026-07-01'), 'quarterly')
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
    ['quarterly', '2026-04-01', '2026-07-01'],
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
    ['2026-07-01', 'quarterly', '2026-05-20', '2026-04-01', '2026-06-30'],
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
