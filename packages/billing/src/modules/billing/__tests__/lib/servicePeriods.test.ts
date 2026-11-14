import {
  MAX_PERIODS_PER_ITEM,
  computeRecurringLines,
  gridPeriodContaining,
  inclusiveDays,
  roundHalfUp2dp,
  type RecurringItemState,
} from '../../lib/servicePeriods'
import type { BillCycle } from '../../data/validators'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

function item(overrides: Partial<RecurringItemState> = {}): RecurringItemState {
  return {
    id: 'item-1',
    chargeTiming: 'in_advance',
    prorate: true,
    billStartDate: d('2026-11-14'),
    billEndDate: null,
    billedToDate: null,
    unitPrice: 100,
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function run(state: RecurringItemState, billDate: string, cycle: BillCycle = 'monthly') {
  const res = computeRecurringLines(state, { billDate: d(billDate), cycle })
  return {
    ...res,
    periods: res.lines.map((l) => [iso(l.servicePeriodStart), iso(l.servicePeriodEnd), l.amount]),
    watermark: iso(res.newBilledToDate),
  }
}

describe('helpers', () => {
  it('counts inclusive days and rounds half-up symmetrically', () => {
    expect(inclusiveDays(d('2026-11-14'), d('2026-11-30'))).toBe(17)
    expect(roundHalfUp2dp(1.005)).toBe(1.01)
    expect(roundHalfUp2dp(-1.005)).toBe(-1.01)
  })

  it('finds the grid period containing a date, without month-end drift', () => {
    const p = gridPeriodContaining(d('2026-01-31'), 'monthly', d('2026-03-31'))
    expect([iso(p.start), iso(p.end)]).toEqual(['2026-03-31', '2026-04-29'])
    const back = gridPeriodContaining(d('2026-12-01'), 'monthly', d('2026-11-14'))
    expect([iso(back.start), iso(back.end)]).toEqual(['2026-11-01', '2026-11-30'])
  })
})

describe('computeRecurringLines — spec worked examples', () => {
  it("operator's test: in advance from Nov 14 bills Nov 14–Dec 13 on Nov 14", () => {
    const r = run(item(), '2026-11-14')
    expect(r.periods).toEqual([['2026-11-14', '2026-12-13', 100]])
    expect(r.watermark).toBe('2026-12-13')
    expect(r.lines[0].proration).toBeNull()
  })

  it('catch-up chain: Dec 14 and Jan 14 continue from the watermark', () => {
    const dec = run(item({ billedToDate: d('2026-12-13') }), '2026-12-14')
    expect(dec.periods).toEqual([['2026-12-14', '2027-01-13', 100]])
    const jan = run(item({ billedToDate: d('2027-01-13') }), '2027-01-14')
    expect(jan.periods).toEqual([['2027-01-14', '2027-02-13', 100]])
  })

  it('mid-cycle add: prorated stub + full next period', () => {
    const r = run(item(), '2026-12-01')
    expect(r.periods).toEqual([
      ['2026-11-14', '2026-11-30', 56.67],
      ['2026-12-01', '2026-12-31', 100],
    ])
    expect(r.lines[0].proration).toEqual({ activeDays: 17, periodDays: 30 })
    expect(r.watermark).toBe('2026-12-31')
  })

  it('in arrears bills the period just ended', () => {
    const r = run(item({ chargeTiming: 'in_arrears', billStartDate: d('2026-11-01') }), '2026-12-01')
    expect(r.periods).toEqual([['2026-11-01', '2026-11-30', 100]])
  })

  it('cancel after prepay: credit for unused days, watermark pulled back', () => {
    const r = run(item({ billStartDate: d('2026-01-01'), billedToDate: d('2026-12-31'), billEndDate: d('2026-12-15') }), '2027-01-01')
    expect(r.periods).toEqual([['2026-12-16', '2026-12-31', -51.61]])
    expect(r.lines[0].kind).toBe('credit')
    expect(r.watermark).toBe('2026-12-15')
  })
})

describe('computeRecurringLines — edge cases', () => {
  it('nothing to bill before the item starts (in arrears, start in the future)', () => {
    const r = run(item({ chargeTiming: 'in_arrears', billStartDate: d('2026-12-05') }), '2026-12-01')
    expect(r.lines).toHaveLength(0)
    expect(r.watermark).toBeNull()
  })

  it('backdated item spanning 3 grid periods lands on one bill date', () => {
    const r = run(item({ chargeTiming: 'in_arrears', billStartDate: d('2026-09-01') }), '2026-12-01')
    expect(r.periods).toEqual([
      ['2026-09-01', '2026-09-30', 100],
      ['2026-10-01', '2026-10-31', 100],
      ['2026-11-01', '2026-11-30', 100],
    ])
  })

  it('prorates a mid-period end (in arrears)', () => {
    const r = run(
      item({ chargeTiming: 'in_arrears', billStartDate: d('2026-11-01'), billEndDate: d('2026-11-10') }),
      '2026-12-01',
    )
    expect(r.periods).toEqual([['2026-11-01', '2026-11-10', 33.33]])
    expect(r.watermark).toBe('2026-11-10')
  })

  it('an end exactly on a grid boundary is a full period (no proration)', () => {
    const r = run(item({ billStartDate: d('2026-12-01'), billEndDate: d('2026-12-31') }), '2026-12-01')
    expect(r.periods).toEqual([['2026-12-01', '2026-12-31', 100]])
  })

  it('prorate=false skips partial periods but still advances the watermark', () => {
    const r = run(item({ prorate: false }), '2026-12-01')
    expect(r.periods).toEqual([['2026-12-01', '2026-12-31', 100]])
    expect(r.skipped).toEqual([
      expect.objectContaining({ reason: 'partial-period-not-prorated' }),
    ])
    expect(r.watermark).toBe('2026-12-31')
  })

  it('prorate=false never credits an ended item and keeps the watermark', () => {
    const r = run(item({ prorate: false, billedToDate: d('2026-12-31'), billEndDate: d('2026-12-15') }), '2027-01-01')
    expect(r.lines).toHaveLength(0)
    expect(r.skipped[0].reason).toBe('ended-after-billing-no-credit')
    expect(r.watermark).toBe('2026-12-31')
  })

  it('re-running the same bill date with the new watermark yields nothing (idempotent)', () => {
    const first = run(item(), '2026-12-01')
    const again = run(item({ billedToDate: first.newBilledToDate }), '2026-12-01')
    expect(again.lines).toHaveLength(0)
  })

  it('switching in arrears → in advance never overlaps or gaps', () => {
    const arrears = run(item({ chargeTiming: 'in_arrears', billStartDate: d('2026-11-01') }), '2026-12-01')
    expect(arrears.watermark).toBe('2026-11-30')
    const advance = run(
      item({ chargeTiming: 'in_advance', billStartDate: d('2026-11-01'), billedToDate: arrears.newBilledToDate }),
      '2027-01-01',
    )
    expect(advance.periods).toEqual([
      ['2026-12-01', '2026-12-31', 100],
      ['2027-01-01', '2027-01-31', 100],
    ])
  })

  it('switching in advance → in arrears waits until the prepaid period has passed', () => {
    const r = run(item({ chargeTiming: 'in_arrears', billedToDate: d('2026-12-31') }), '2027-01-01')
    expect(r.lines).toHaveLength(0)
    expect(r.watermark).toBe('2026-12-31')
  })

  it('handles month-end anchors, leap years and other cycles', () => {
    expect(run(item({ billStartDate: d('2027-01-31') }), '2027-01-31').periods).toEqual([
      ['2027-01-31', '2027-02-27', 100],
    ])
    expect(run(item({ billStartDate: d('2028-02-01') }), '2028-02-01').periods).toEqual([
      ['2028-02-01', '2028-02-29', 100],
    ])
    expect(run(item({ billStartDate: d('2026-11-16') }), '2026-11-16', 'weekly').periods).toEqual([
      ['2026-11-16', '2026-11-22', 100],
    ])
    expect(run(item({ billStartDate: d('2026-10-01') }), '2026-10-01', 'quarterly').periods).toEqual([
      ['2026-10-01', '2026-12-31', 100],
    ])
    expect(run(item({ billStartDate: d('2026-01-01') }), '2026-01-01', 'annually').periods).toEqual([
      ['2026-01-01', '2026-12-31', 100],
    ])
  })

  it('skips inactive and soft-deleted items', () => {
    expect(run(item({ isActive: false }), '2026-12-01').skipped[0].reason).toBe('item-inactive')
    expect(run(item({ deletedAt: d('2026-11-20') }), '2026-12-01').skipped[0].reason).toBe('item-soft-deleted')
  })

  it('caps runaway backdating', () => {
    const r = run(item({ chargeTiming: 'in_arrears', billStartDate: d('2000-01-01') }), '2026-12-01')
    expect(r.lines).toHaveLength(MAX_PERIODS_PER_ITEM)
    expect(r.skipped.at(-1)?.reason).toBe('period-cap-reached')
  })
})
