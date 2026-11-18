import { resolveCreateCycle, resolveCycleUpdate } from '../../lib/accountCycle'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
const TODAY = d('2026-11-16')

describe('resolveCreateCycle', () => {
  it('omitted next bill date → first cycle day on or after today', () => {
    const res = resolveCreateCycle({ cycle: 'monthly', interval: 1, day: '15' }, TODAY)
    expect(iso(res.nextBillDate)).toBe('2026-12-15')
    expect(iso(resolveCreateCycle({ cycle: 'monthly', interval: 1, day: '16' }, TODAY).nextBillDate)).toBe('2026-11-16')
  })

  it('defaults: day 1 every month, or the explicit date’s day', () => {
    expect(resolveCreateCycle({ cycle: 'monthly', interval: 1 }, TODAY)).toEqual({
      spec: { cycle: 'monthly', interval: 1, day: '1' },
      nextBillDate: d('2026-12-01'),
    })
    expect(resolveCreateCycle({ cycle: 'monthly', interval: 1, nextBillDate: d('2027-01-20') }, TODAY).spec.day).toBe('20')
  })

  it('keeps an explicit off-day date (first period aligns)', () => {
    const res = resolveCreateCycle({ cycle: 'monthly', interval: 1, day: '1', nextBillDate: d('2026-11-20') }, TODAY)
    expect(iso(res.nextBillDate)).toBe('2026-11-20')
    expect(res.spec.day).toBe('1')
  })

  it('daily cycles start today and carry no day', () => {
    expect(resolveCreateCycle({ cycle: 'daily', interval: 30 }, TODAY)).toEqual({
      spec: { cycle: 'daily', interval: 30, day: null },
      nextBillDate: TODAY,
    })
  })
})

describe('resolveCycleUpdate', () => {
  const current = { cycle: 'monthly' as const, interval: 1, day: '15', lastBillDate: d('2026-11-14') }

  it('no cycle change → next bill date untouched', () => {
    expect(resolveCycleUpdate(current, {}, TODAY)).toEqual({
      ok: true,
      spec: { cycle: 'monthly', interval: 1, day: '15' },
      changed: false,
      nextBillDate: null,
    })
  })

  it('day change → next occurrence of the new day (short alignment period)', () => {
    const res = resolveCycleUpdate(current, { day: '1' }, TODAY)
    expect(res.ok && iso(res.nextBillDate)).toBe('2026-12-01')
  })

  it('the alignment period is never empty (at least one day after the period start)', () => {
    // Last billed through 14 Nov → period starts 15 Nov; day 15 must not give 15 Nov.
    const res = resolveCycleUpdate({ ...current, day: '20' }, { day: '15' }, d('2026-11-10'))
    expect(res.ok && iso(res.nextBillDate)).toBe('2026-12-15')
  })

  it('interval change re-aligns on the existing day', () => {
    const res = resolveCycleUpdate(current, { interval: 3 }, TODAY)
    expect(res.ok && iso(res.nextBillDate)).toBe('2026-12-15')
    expect(res.ok && res.spec).toEqual({ cycle: 'monthly', interval: 3, day: '15' })
  })

  it('unit change without a day falls back to the unit default', () => {
    const weekly = resolveCycleUpdate(current, { cycle: 'weekly' }, TODAY)
    expect(weekly.ok && weekly.spec.day).toBe('mon')
    expect(weekly.ok && iso(weekly.nextBillDate)).toBe('2026-11-16')
    const daily = resolveCycleUpdate(current, { cycle: 'daily', interval: 30 }, TODAY)
    expect(daily.ok && daily.spec).toEqual({ cycle: 'daily', interval: 30, day: null })
    expect(daily.ok && iso(daily.nextBillDate)).toBe('2026-12-15')
  })

  it('an explicit next bill date wins', () => {
    const res = resolveCycleUpdate(current, { day: '1', nextBillDate: d('2027-01-01') }, TODAY)
    expect(res.ok && iso(res.nextBillDate)).toBe('2027-01-01')
  })

  it('rejects an invalid merged spec', () => {
    const res = resolveCycleUpdate(current, { day: 'mon' }, TODAY)
    expect(res).toEqual({ ok: false, issue: expect.objectContaining({ path: 'billCycleDay' }) })
  })
})
