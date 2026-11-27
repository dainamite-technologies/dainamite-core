import {
  computeRecurringLines,
  type ItemStatusPeriodState,
  type RecurringComputation,
  type RecurringItemState,
} from '../../lib/servicePeriods'
import { resolvePhases, type PhaseDefinition } from '../../lib/pricePhases'
import type { CycleInput, CycleSpec } from '../../lib/billCycle'

/**
 * Line period (L §4.2), line status (L §4.3) and price phases (P §4.2) on the
 * shared recurring engine — every worked example of both specs plus the
 * boundary table (month ends, leap year, prorate off, catch-up, weekly line
 * on a monthly account, in arrears, end mid-period).
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
const monthlyOn1: CycleSpec = { cycle: 'monthly', interval: 1, day: '1' }
const annuallyOn1: CycleSpec = { cycle: 'annually', interval: 1, day: '1' }

function item(overrides: Partial<RecurringItemState> & { phaseDefs?: PhaseDefinition[] } = {}): RecurringItemState {
  const { phaseDefs, ...rest } = overrides
  const base: RecurringItemState = {
    id: 'item-1',
    chargeTiming: 'in_advance',
    prorate: true,
    billStartDate: d('2026-12-01'),
    billEndDate: null,
    billedToDate: null,
    unitPrice: 79_900,
    isActive: true,
    deletedAt: null,
    ...rest,
  }
  if (phaseDefs) base.phases = resolvePhases(base.billStartDate, phaseDefs)
  return base
}

type Row = [string | null, string | null, number, string | null, number]

function rows(res: RecurringComputation): Row[] {
  return res.lines.map((l) => [iso(l.servicePeriodStart), iso(l.servicePeriodEnd), l.amount, l.phase?.name ?? null, l.quantity])
}

function run(state: RecurringItemState, billDate: string, cycle: CycleInput = monthlyOn1) {
  return computeRecurringLines(state, { billDate: d(billDate), cycle })
}

/** Runs consecutive bill dates, carrying the watermark and status `applied*`. */
function runSeries(state: RecurringItemState, billDates: string[], cycle: CycleInput = monthlyOn1) {
  let current = { ...state, statusPeriods: state.statusPeriods?.map((s) => ({ ...s })) }
  return billDates.map((billDate) => {
    const res = run(current, billDate, cycle)
    const statusPeriods = current.statusPeriods?.map((s) => {
      const update = res.statusApplied.find((u) => u.id === s.id)
      return update ? { ...s, appliedFrom: update.appliedFrom, appliedTo: update.appliedTo } : s
    })
    current = { ...current, billedToDate: res.newBilledToDate, statusPeriods }
    return { billDate, res, rows: rows(res) }
  })
}

const freeThenHalf: PhaseDefinition[] = [
  { name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' },
  { name: 'Promo 50%', durationUnit: 'month', durationCount: 2, priceType: 'percent_off', value: 50 },
]

describe('price phases — spec P §4.2 worked examples', () => {
  it('A: start on the bill date — free month, then 50% for two months, then regular', () => {
    const series = runSeries(item({ phaseDefs: freeThenHalf }), ['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
    expect(series.map((s) => s.rows)).toEqual([
      [['2026-12-01', '2026-12-31', 0, 'Free trial', 1]],
      [['2027-01-01', '2027-01-31', 39_950, 'Promo 50%', 1]],
      [['2027-02-01', '2027-02-28', 39_950, 'Promo 50%', 1]],
      [['2027-03-01', '2027-03-31', 79_900, null, 1]],
    ])
  })

  it('B: mid-cycle start — the free month is split on the exact date (prorate on)', () => {
    const phaseDefs: PhaseDefinition[] = [{ name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' }]
    const series = runSeries(item({ billStartDate: d('2026-11-14'), phaseDefs }), ['2026-12-01', '2027-01-01'])
    expect(series[0].rows).toEqual([
      ['2026-11-14', '2026-12-13', 0, 'Free trial', 1],
      ['2026-12-14', '2026-12-31', 46_393.55, null, 1],
    ])
    expect(series[0].res.lines[1].proration).toEqual({ activeDays: 18, periodDays: 31 })
    expect(series[1].rows).toEqual([['2027-01-01', '2027-01-31', 79_900, null, 1]])
  })

  it('B with prorate off: the phase in force on 1 Dec prices the whole December', () => {
    const phaseDefs: PhaseDefinition[] = [{ name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' }]
    const res = run(item({ billStartDate: d('2026-11-14'), prorate: false, phaseDefs }), '2026-12-01')
    expect(rows(res)).toEqual([['2026-12-01', '2026-12-31', 0, 'Free trial', 1]])
    expect(res.skipped.map((s) => s.reason)).toEqual(['partial-period-not-prorated'])
  })

  it('C: annual ramp 100 → 110 → regular 120 on an annual account', () => {
    const phaseDefs: PhaseDefinition[] = [
      { name: 'Year 1', durationUnit: 'year', durationCount: 1, priceType: 'fixed', value: 100 },
      { name: 'Year 2', durationUnit: 'year', durationCount: 1, priceType: 'fixed', value: 110 },
    ]
    const series = runSeries(
      item({ billStartDate: d('2027-01-01'), unitPrice: 120, phaseDefs }),
      ['2027-01-01', '2028-01-01', '2029-01-01'],
      annuallyOn1,
    )
    expect(series.map((s) => s.rows)).toEqual([
      [['2027-01-01', '2027-12-31', 100, 'Year 1', 1]],
      [['2028-01-01', '2028-12-31', 110, 'Year 2', 1]],
      [['2029-01-01', '2029-12-31', 120, null, 1]],
    ])
  })

  it('amount off and fixed phases price per period; a phase ending mid-period splits it', () => {
    const phaseDefs: PhaseDefinition[] = [
      { name: 'Intro', endDate: '2026-12-15', priceType: 'fixed', value: 1 },
      { name: 'Discount', durationUnit: 'day', durationCount: 16, priceType: 'amount_off', value: 900 },
    ]
    const res = run(item({ unitPrice: 3_100, phaseDefs }), '2026-12-01')
    expect(rows(res)).toEqual([
      ['2026-12-01', '2026-12-15', 0.48, 'Intro', 1],
      ['2026-12-16', '2026-12-31', 1_135.48, 'Discount', 1],
    ])
  })

  it('catch-up: one run over several periods keeps each phase on its own line', () => {
    const res = run(item({ phaseDefs: freeThenHalf, chargeTiming: 'in_arrears' }), '2027-04-01')
    expect(rows(res)).toEqual([
      ['2026-12-01', '2026-12-31', 0, 'Free trial', 1],
      ['2027-01-01', '2027-02-28', 79_900, 'Promo 50%', 2],
      ['2027-03-01', '2027-03-31', 79_900, null, 1],
    ])
    expect(res.lines[1].unitAmount).toBe(39_950)
    expect(iso(res.newBilledToDate)).toBe('2027-03-31')
  })

  it('month ends: a one-month phase from 31 Jan ends 27 Feb (clamped), the next starts 28 Feb', () => {
    const phases = resolvePhases(d('2027-01-31'), [
      { durationUnit: 'month', durationCount: 1, priceType: 'free' },
      { durationUnit: 'month', durationCount: 1, priceType: 'percent_off', value: 10 },
    ])
    expect(phases.map((p) => [iso(p.start), iso(p.end)])).toEqual([
      ['2027-01-31', '2027-02-27'],
      ['2027-02-28', '2027-03-27'],
    ])
  })

  it('leap year: a free February 2028 prints 29 days at 0, March at the regular price', () => {
    const phaseDefs: PhaseDefinition[] = [{ name: 'Free', durationUnit: 'month', durationCount: 1, priceType: 'free' }]
    const series = runSeries(item({ billStartDate: d('2028-02-01'), phaseDefs }), ['2028-02-01', '2028-03-01'])
    expect(series[0].rows).toEqual([['2028-02-01', '2028-02-29', 0, 'Free', 1]])
    expect(series[1].rows).toEqual([['2028-03-01', '2028-03-31', 79_900, null, 1]])
  })

  it('ending the item drops later phases and credits billed-in-advance days at the phase price', () => {
    const state = item({ phaseDefs: freeThenHalf, billedToDate: d('2027-01-31'), billEndDate: d('2027-01-15') })
    const res = run(state, '2027-02-01')
    expect(rows(res)).toEqual([['2027-01-16', '2027-01-31', -20_619.35, 'Promo 50%', 1]])
    expect(iso(res.newBilledToDate)).toBe('2027-01-15')
  })

  it('without phases the result is unchanged (no phase, quantity 1)', () => {
    const res = run(item(), '2026-12-01')
    expect(rows(res)).toEqual([['2026-12-01', '2026-12-31', 79_900, null, 1]])
  })
})

describe('own billing period per line — spec L §4.2', () => {
  const mobile = (overrides: Partial<RecurringItemState> = {}) =>
    item({
      id: 'mobile',
      unitPrice: 480_000,
      billStartDate: d('2026-12-10'),
      billingPeriod: { unit: 'annually', interval: 1 },
      ...overrides,
    })

  it('mobile annual on a monthly internet account: billed 1 Jan 2027, then 1 Dec 2027', () => {
    const series = runSeries(mobile(), [
      '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01',
      '2027-07-01', '2027-08-01', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01',
    ])
    expect(series[0].rows).toEqual([['2026-12-10', '2027-12-09', 480_000, null, 1]])
    for (const s of series.slice(1, 11)) expect(s.rows).toEqual([])
    expect(series[11].rows).toEqual([['2027-12-10', '2028-12-09', 480_000, null, 1]])
  })

  it('in advance: the bill date on or before the period start (a line existing on 1 Dec bills then)', () => {
    const res = run(mobile(), '2026-12-01')
    expect(rows(res)).toEqual([['2026-12-10', '2027-12-09', 480_000, null, 1]])
  })

  it('internet on the same account stays on the account grid', () => {
    const series = runSeries(item({ id: 'internet' }), ['2026-12-01', '2027-01-01'])
    expect(series.map((s) => s.rows)).toEqual([
      [['2026-12-01', '2026-12-31', 79_900, null, 1]],
      [['2027-01-01', '2027-01-31', 79_900, null, 1]],
    ])
  })

  it('in arrears: billed on the first bill date after the period ends', () => {
    const series = runSeries(mobile({ chargeTiming: 'in_arrears' }), ['2027-12-01', '2028-01-01'])
    expect(series[0].rows).toEqual([])
    expect(series[1].rows).toEqual([['2026-12-10', '2027-12-09', 480_000, null, 1]])
  })

  it('weekly line on a monthly account, in arrears: one line, 4 weeks (1–28 Dec) × 15,000', () => {
    const weekly = item({ unitPrice: 15_000, billingPeriod: { unit: 'weekly', interval: 1 }, chargeTiming: 'in_arrears' })
    const res = run(weekly, '2027-01-01')
    expect(rows(res)).toEqual([['2026-12-01', '2026-12-28', 60_000, null, 4]])
    expect(res.lines[0].unitAmount).toBe(15_000)
    expect(iso(res.newBilledToDate)).toBe('2026-12-28')
    // The week 29 Dec – 4 Jan ends in January → the 1 Feb invoice.
    const feb = run({ ...weekly, billedToDate: d('2026-12-28') }, '2027-02-01')
    expect(rows(feb)).toEqual([['2026-12-29', '2027-01-25', 60_000, null, 4]])
  })

  it('weekly line, in advance: every week starting before the next bill date', () => {
    const weekly = item({ unitPrice: 15_000, billingPeriod: { unit: 'weekly', interval: 1 } })
    const res = run(weekly, '2026-12-01')
    expect(rows(res)).toEqual([['2026-12-01', '2027-01-04', 75_000, null, 5]])
  })

  it('daily line on a monthly account in arrears groups the days', () => {
    const daily = item({ unitPrice: 1_000, billingPeriod: { unit: 'daily', interval: 1 }, chargeTiming: 'in_arrears' })
    expect(rows(run(daily, '2027-01-01'))).toEqual([['2026-12-01', '2026-12-31', 31_000, null, 31]])
  })

  it('end date inside a period prorates it (in advance, known before billing)', () => {
    const res = run(mobile({ billEndDate: d('2027-06-09') }), '2027-01-01')
    // 10 Dec 2026 – 9 Jun 2027 = 182 of 365 days.
    expect(rows(res)).toEqual([['2026-12-10', '2027-06-09', 239_342.47, null, 1]])
    expect(res.lines[0].proration).toEqual({ activeDays: 182, periodDays: 365 })
  })

  it('end date set after billing in advance credits the unused days on the item grid', () => {
    const res = run(mobile({ billedToDate: d('2027-12-09'), billEndDate: d('2027-06-09') }), '2027-07-01')
    expect(rows(res)).toEqual([['2027-06-10', '2027-12-09', -240_657.53, null, 1]])
    expect(iso(res.newBilledToDate)).toBe('2027-06-09')
  })

  it('in arrears with an end mid-period bills the cut period on the next bill date', () => {
    const res = run(mobile({ chargeTiming: 'in_arrears', billEndDate: d('2027-06-09') }), '2027-07-01')
    expect(rows(res)).toEqual([['2026-12-10', '2027-06-09', 239_342.47, null, 1]])
  })

  it('catch-up: two annual periods due on one run, grouped as × 2', () => {
    const res = run(mobile(), '2027-12-01')
    expect(rows(res)).toEqual([['2026-12-10', '2028-12-09', 960_000, null, 2]])
  })

  it('every 3 months on a monthly account', () => {
    const quarterly = item({ unitPrice: 300, billingPeriod: { unit: 'monthly', interval: 3 }, billStartDate: d('2026-12-15') })
    const series = runSeries(quarterly, ['2027-01-01', '2027-02-01', '2027-03-01'])
    expect(series.map((s) => s.rows)).toEqual([
      [['2026-12-15', '2027-03-14', 300, null, 1]],
      [],
      [['2027-03-15', '2027-06-14', 300, null, 1]],
    ])
  })

  it('phases on an own-period line: the phase price is per item period', () => {
    const phased = mobile({
      phases: resolvePhases(d('2026-12-10'), [{ name: 'Year 1', durationUnit: 'year', durationCount: 1, priceType: 'percent_off', value: 25 }]),
    })
    expect(rows(run(phased, '2027-01-01'))).toEqual([['2026-12-10', '2027-12-09', 360_000, 'Year 1', 1]])
  })
})

describe('line status — spec L §4.3', () => {
  const pause = (overrides: Partial<ItemStatusPeriodState> = {}): ItemStatusPeriodState => ({
    id: 'sp-1',
    status: 'paused',
    fromDate: d('2027-01-10'),
    toDate: d('2027-01-19'),
    chargeBehavior: null,
    reason: null,
    ...overrides,
  })

  it('pause recorded after January was billed in advance → credit on 1 Feb, February in full', () => {
    const state = item({ billedToDate: d('2027-01-31'), statusPeriods: [pause()] })
    const res = run(state, '2027-02-01')
    expect(rows(res)).toEqual([
      ['2027-01-10', '2027-01-19', -25_774.19, null, 1],
      ['2027-02-01', '2027-02-28', 79_900, null, 1],
    ])
    expect(res.lines[0].reason).toMatchObject({ kind: 'status', status: 'paused', statusPeriodId: 'sp-1' })
    expect(res.statusApplied.map((u) => [u.id, iso(u.appliedFrom), iso(u.appliedTo)])).toEqual([['sp-1', '2027-01-10', '2027-01-19']])
  })

  it('the credit is issued once — a re-run with the applied range does nothing more', () => {
    const series = runSeries(item({ billedToDate: d('2027-01-31'), statusPeriods: [pause()] }), ['2027-02-01', '2027-03-01'])
    expect(series[1].rows).toEqual([['2027-03-01', '2027-03-31', 79_900, null, 1]])
  })

  it('a pause known before billing leaves the paused days uncharged (prorated)', () => {
    const res = run(item({ billStartDate: d('2027-01-01'), statusPeriods: [pause()] }), '2027-01-01')
    expect(rows(res)).toEqual([
      ['2027-01-01', '2027-01-09', 23_196.77, null, 1],
      ['2027-01-20', '2027-01-31', 30_929.03, null, 1],
    ])
    expect(iso(res.newBilledToDate)).toBe('2027-01-31')
  })

  it('a pause applies even with prorate off (paused days are always prorated)', () => {
    const res = run(item({ billStartDate: d('2027-01-01'), prorate: false, statusPeriods: [pause()] }), '2027-01-01')
    expect(rows(res).map((r) => r[2])).toEqual([23_196.77, 30_929.03])
  })

  it('open-ended pause: nothing charged, then resume re-charges the days left uncharged', () => {
    const open = pause({ fromDate: d('2027-02-01'), toDate: null })
    const series = runSeries(item({ billedToDate: d('2027-01-31'), statusPeriods: [open] }), ['2027-02-01'])
    expect(series[0].rows).toEqual([])
    expect(iso(series[0].res.newBilledToDate)).toBe('2027-02-28')
    // Resume on 15 Feb: the pause ends 14 Feb.
    const resumed = run(
      item({
        billedToDate: d('2027-02-28'),
        statusPeriods: [{ ...open, toDate: d('2027-02-14'), appliedFrom: d('2027-02-01'), appliedTo: d('2027-02-28') }],
      }),
      '2027-03-01',
    )
    expect(rows(resumed)).toEqual([
      ['2027-02-15', '2027-02-28', 39_950, null, 1],
      ['2027-03-01', '2027-03-31', 79_900, null, 1],
    ])
    expect(resumed.lines[0].reason).toMatchObject({ kind: 'status_reversal' })
    expect(resumed.statusApplied.map((u) => [iso(u.appliedFrom), iso(u.appliedTo)])).toEqual([['2027-02-01', '2027-02-14']])
  })

  it('a deleted pause re-charges its applied days', () => {
    const res = run(
      item({
        billedToDate: d('2027-01-31'),
        statusPeriods: [pause({ deletedAt: d('2027-01-25'), appliedFrom: d('2027-01-10'), appliedTo: d('2027-01-19') })],
      }),
      '2027-02-01',
    )
    expect(rows(res)[0]).toEqual(['2027-01-10', '2027-01-19', 25_774.19, null, 1])
    expect(res.statusApplied).toEqual([{ id: 'sp-1', appliedFrom: null, appliedTo: null }])
  })

  it('suspended keeps charging by default; no_charge removes the days', () => {
    const charged = run(item({ statusPeriods: [pause({ status: 'suspended', fromDate: d('2026-12-10'), toDate: null })] }), '2026-12-01')
    expect(rows(charged)).toEqual([['2026-12-01', '2026-12-31', 79_900, null, 1]])
    const free = run(
      item({ statusPeriods: [pause({ status: 'suspended', chargeBehavior: 'no_charge', fromDate: d('2026-12-10'), toDate: null })] }),
      '2026-12-01',
    )
    expect(rows(free)).toEqual([['2026-12-01', '2026-12-09', 23_196.77, null, 1]])
  })

  it('grace is a flag only', () => {
    const res = run(item({ statusPeriods: [pause({ status: 'grace', chargeBehavior: 'no_charge' })] }), '2026-12-01')
    expect(rows(res)).toEqual([['2026-12-01', '2026-12-31', 79_900, null, 1]])
  })

  it('paused with charge behaviour "charge" keeps billing', () => {
    const res = run(item({ billedToDate: d('2027-01-31'), statusPeriods: [pause({ chargeBehavior: 'charge' })] }), '2027-02-01')
    expect(rows(res)).toEqual([['2027-02-01', '2027-02-28', 79_900, null, 1]])
  })

  it('ending a paused item credits only the days that were charged', () => {
    const res = run(
      item({
        billedToDate: d('2027-01-31'),
        billEndDate: d('2027-01-14'),
        statusPeriods: [pause({ appliedFrom: d('2027-01-10'), appliedTo: d('2027-01-19') })],
      }),
      '2027-02-01',
    )
    expect(rows(res)).toEqual([['2027-01-20', '2027-01-31', -30_929.03, null, 1]])
    expect(iso(res.newBilledToDate)).toBe('2027-01-14')
    expect(res.statusApplied.map((u) => [iso(u.appliedFrom), iso(u.appliedTo)])).toEqual([['2027-01-10', '2027-01-14']])
  })

  it('a pause does not extend a phase (phases follow the calendar, W5 default)', () => {
    const phaseDefs: PhaseDefinition[] = [{ name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' }]
    const res = run(
      item({ phaseDefs, statusPeriods: [pause({ fromDate: d('2026-12-10'), toDate: d('2026-12-19') })] }),
      '2026-12-01',
    )
    expect(rows(res)).toEqual([
      ['2026-12-01', '2026-12-09', 0, 'Free trial', 1],
      ['2026-12-20', '2026-12-31', 0, 'Free trial', 1],
    ])
  })

  it('weekly own-period line paused for one week: the other weeks still group', () => {
    const weekly = item({
      unitPrice: 15_000,
      billingPeriod: { unit: 'weekly', interval: 1 },
      chargeTiming: 'in_arrears',
      statusPeriods: [pause({ fromDate: d('2026-12-08'), toDate: d('2026-12-14') })],
    })
    expect(rows(run(weekly, '2027-01-01'))).toEqual([
      ['2026-12-01', '2026-12-07', 15_000, null, 1],
      ['2026-12-15', '2026-12-28', 30_000, null, 2],
    ])
  })
})
