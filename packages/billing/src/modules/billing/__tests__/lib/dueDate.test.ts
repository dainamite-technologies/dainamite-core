import { computeDueDate, resolvePaymentTermsDays } from '../../lib/dueDate'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)

describe('resolvePaymentTermsDays', () => {
  it('prefers the account terms, including 0 (due on issue)', () => {
    expect(resolvePaymentTermsDays(7, 14)).toBe(7)
    expect(resolvePaymentTermsDays(0, 14)).toBe(0)
  })

  it('falls back to the organization default, then 14', () => {
    expect(resolvePaymentTermsDays(null, 30)).toBe(30)
    expect(resolvePaymentTermsDays(undefined, undefined)).toBe(14)
    expect(resolvePaymentTermsDays(-1, -5)).toBe(14)
    expect(resolvePaymentTermsDays(2.5, 21)).toBe(21)
  })
})

describe('computeDueDate', () => {
  it('adds calendar days across month and year ends', () => {
    expect(iso(computeDueDate(d('2026-11-14'), 14))).toBe('2026-11-28')
    expect(iso(computeDueDate(d('2026-12-25'), 14))).toBe('2027-01-08')
    expect(iso(computeDueDate(d('2027-01-31'), 30))).toBe('2027-03-02')
  })

  it('handles leap years', () => {
    expect(iso(computeDueDate(d('2028-02-15'), 14))).toBe('2028-02-29')
  })

  it('returns the issue date itself for 0 days, at UTC midnight', () => {
    const due = computeDueDate(new Date('2026-11-14T22:30:00Z'), 0)
    expect(due.toISOString()).toBe('2026-11-14T00:00:00.000Z')
  })
})
