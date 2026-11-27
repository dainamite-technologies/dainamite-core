import {
  computeRecurringLines,
  type ItemStatusPeriodState,
  type RecurringComputation,
  type RecurringItemState,
} from '../../lib/servicePeriods'
import type { CycleSpec } from '../../lib/billCycle'

/**
 * Regression tests for the status credit / re-charge review findings
 * (line-period-and-status spec §4.3): a status credit or re-charge may only
 * ever touch days that were actually charged, and each day at most once —
 * whatever the number of overlapping status rows, partial periods skipped by
 * `prorate=false`, or end dates set after billing.
 *
 * Item at 3 100 / month on a monthly account billed on the 1st, so a day of
 * December or January is exactly 100.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
const monthlyOn1: CycleSpec = { cycle: 'monthly', interval: 1, day: '1' }

function item(overrides: Partial<RecurringItemState> = {}): RecurringItemState {
  return {
    id: 'item-1',
    chargeTiming: 'in_advance',
    prorate: true,
    billStartDate: d('2026-12-01'),
    billEndDate: null,
    billedToDate: null,
    unitPrice: 3_100,
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

const pause = (id: string, overrides: Partial<ItemStatusPeriodState> = {}): ItemStatusPeriodState => ({
  id,
  status: 'paused',
  fromDate: d('2026-12-11'),
  toDate: d('2026-12-20'),
  chargeBehavior: null,
  reason: null,
  ...overrides,
})

function run(state: RecurringItemState, billDate: string): RecurringComputation {
  return computeRecurringLines(state, { billDate: d(billDate), cycle: monthlyOn1 })
}

/** Carries the watermark and `applied*` of a computation into the next state. */
function carry(state: RecurringItemState, res: RecurringComputation): RecurringItemState {
  return {
    ...state,
    billedToDate: res.newBilledToDate,
    statusPeriods: state.statusPeriods?.map((s) => {
      const update = res.statusApplied.find((u) => u.id === s.id)
      return update ? { ...s, appliedFrom: update.appliedFrom, appliedTo: update.appliedTo } : s
    }),
  }
}

/** Sum of the lines whose service period falls in `[from, to]`. */
function sumIn(res: RecurringComputation, from: string, to: string): number {
  return res.lines
    .filter((l) => l.servicePeriodStart.getTime() >= d(from).getTime() && l.servicePeriodEnd.getTime() <= d(to).getTime())
    .reduce((acc, l) => Math.round((acc + l.amount) * 100) / 100, 0)
}

describe('F2 — overlapping no-charge rows credit / re-charge a day once', () => {
  it('two rows over the same billed days (undo restored a deleted pause) → one credit', () => {
    const state = item({ billedToDate: d('2026-12-31'), statusPeriods: [pause('a'), pause('b')] })
    const res = run(state, '2027-01-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(-1_000)
    expect(res.lines.filter((l) => l.kind === 'credit')).toHaveLength(1)
  })

  it('a second row over days already credited for the first → no further credit', () => {
    const state = item({
      billedToDate: d('2026-12-31'),
      statusPeriods: [pause('a', { appliedFrom: d('2026-12-11'), appliedTo: d('2026-12-20') }), pause('b')],
    })
    const res = run(state, '2027-01-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(0)
  })

  it('removing both overlapping rows re-charges the days once', () => {
    const credited = run(item({ billedToDate: d('2026-12-31'), statusPeriods: [pause('a'), pause('b')] }), '2027-01-01')
    let state = carry(item({ billedToDate: d('2026-12-31'), statusPeriods: [pause('a'), pause('b')] }), credited)
    state = { ...state, statusPeriods: state.statusPeriods!.map((s) => ({ ...s, deletedAt: d('2027-01-15') })) }
    const res = run(state, '2027-02-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(1_000)
    expect(res.statusApplied.map((u) => [u.id, u.appliedFrom, u.appliedTo])).toEqual([
      ['a', null, null],
      ['b', null, null],
    ])
  })

  it('removing one of two overlapping rows re-charges nothing (the other still covers the days)', () => {
    const state = item({
      billedToDate: d('2026-12-31'),
      statusPeriods: [
        pause('a', { appliedFrom: d('2026-12-11'), appliedTo: d('2026-12-20'), deletedAt: d('2027-01-15') }),
        pause('b', { appliedFrom: d('2026-12-11'), appliedTo: d('2026-12-20') }),
      ],
    })
    const res = run(state, '2027-02-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(0)
  })
})

describe('F1 — prorate=false: days of a skipped partial period were never charged', () => {
  const lateStart = { prorate: false, billStartDate: d('2026-12-15') }

  it('a late pause over the skipped partial December credits nothing', () => {
    // 1 Dec run skipped 15–31 Dec (partial, prorate off) and moved the watermark to 31 Dec.
    const state = item({ ...lateStart, billedToDate: d('2026-12-31'), statusPeriods: [pause('a', { fromDate: d('2026-12-15') })] })
    const res = run(state, '2027-01-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(0)
    expect(sumIn(res, '2027-01-01', '2027-01-31')).toBe(3_100)
    expect(res.statusApplied.every((u) => u.appliedFrom === null)).toBe(true)
  })

  it('deleting a pause over the skipped partial period re-charges nothing', () => {
    let state = item({ ...lateStart, statusPeriods: [pause('a', { fromDate: d('2026-12-15') })] })
    const first = run(state, '2026-12-01')
    expect(first.lines).toEqual([])
    state = carry(state, first)
    state = { ...state, statusPeriods: state.statusPeriods!.map((s) => ({ ...s, deletedAt: d('2026-12-25') })) }
    const res = run(state, '2027-01-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(0)
  })

  it('a legacy applied range over never-charged days is not re-charged', () => {
    const state = item({
      ...lateStart,
      billedToDate: d('2026-12-31'),
      statusPeriods: [pause('a', { fromDate: d('2026-12-15'), appliedFrom: d('2026-12-15'), appliedTo: d('2026-12-20'), deletedAt: d('2027-01-05') })],
    })
    const res = run(state, '2027-01-01')
    expect(sumIn(res, '2026-12-01', '2026-12-31')).toBe(0)
  })

  it('an end inside a period skipped by prorate=false is not credited by a later pause', () => {
    // Billed with the end known: January 1–25 was a partial period, skipped; watermark = end.
    const state = item({
      prorate: false,
      billEndDate: d('2027-01-25'),
      billedToDate: d('2027-01-25'),
      statusPeriods: [pause('a', { fromDate: d('2027-01-20'), toDate: d('2027-01-25') })],
    })
    const res = run(state, '2027-02-01')
    expect(sumIn(res, '2027-01-01', '2027-01-31')).toBe(0)
  })
})

describe('F3 — prorate=false end path: applied only over days up to the end', () => {
  it('end removed + pause deleted after an end-path credit charges 26–31 Jan once', () => {
    // Billed through 31 Jan, then the end (25 Jan) and a late pause 20–31 Jan were recorded.
    let state = item({
      prorate: false,
      billedToDate: d('2027-01-31'),
      billEndDate: d('2027-01-25'),
      statusPeriods: [pause('a', { fromDate: d('2027-01-20'), toDate: d('2027-01-31') })],
    })
    const ended = run(state, '2027-02-01')
    expect(sumIn(ended, '2027-01-01', '2027-01-31')).toBe(-600)
    expect(ended.statusApplied.map((u) => [iso(u.appliedFrom), iso(u.appliedTo)])).toEqual([['2027-01-20', '2027-01-25']])
    state = carry(state, ended)
    state = { ...state, billEndDate: null, statusPeriods: state.statusPeriods!.map((s) => ({ ...s, deletedAt: d('2027-02-10') })) }
    const reopened = run(state, '2027-03-01')
    // Only the 6 credited days come back; 26–31 Jan were charged all along.
    expect(sumIn(reopened, '2027-01-01', '2027-01-31')).toBe(600)
    // Net January = 3 100 charged − 600 + 600.
  })

  it('days after the end that were left uncharged keep their applied state (re-charged when reopened)', () => {
    // Pause 20–31 Jan known before January was billed: 1–19 charged, 20–31 left uncharged.
    let state = item({
      prorate: false,
      billedToDate: d('2026-12-31'),
      statusPeriods: [pause('a', { fromDate: d('2027-01-20'), toDate: d('2027-01-31') })],
    })
    const january = run(state, '2027-01-01')
    expect(sumIn(january, '2027-01-01', '2027-01-31')).toBe(1_900)
    state = carry(state, january)
    state = { ...state, billEndDate: d('2027-01-25') }
    const ended = run(state, '2027-02-01')
    expect(ended.lines).toEqual([])
    expect(ended.statusApplied).toEqual([])
    state = carry(state, ended)
    state = { ...state, billEndDate: null, statusPeriods: state.statusPeriods!.map((s) => ({ ...s, deletedAt: d('2027-02-10') })) }
    const reopened = run(state, '2027-03-01')
    expect(sumIn(reopened, '2027-01-01', '2027-01-31')).toBe(1_200)
  })
})
