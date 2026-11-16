import { dateColumnToIso, toDateColumn } from '../dateColumns'

describe('dateColumnToIso', () => {
  it('formats a hydrated date column string', () => {
    expect(dateColumnToIso('2026-12-01')).toBe('2026-12-01T00:00:00.000Z')
  })

  it('formats a Date assigned in the same unit of work', () => {
    expect(dateColumnToIso(new Date('2026-12-01'))).toBe('2026-12-01T00:00:00.000Z')
  })

  it.each([null, undefined, '', 'not-a-date'])('returns null for %p', (value) => {
    expect(dateColumnToIso(value as string | null | undefined)).toBeNull()
  })
})

describe('toDateColumn', () => {
  it('stores YYYY-MM-DD for strings and Dates', () => {
    expect(toDateColumn('2026-12-01')).toBe('2026-12-01')
    expect(toDateColumn('2026-12-01T00:00:00.000Z')).toBe('2026-12-01')
    expect(toDateColumn(new Date('2027-01-15T00:00:00.000Z'))).toBe('2027-01-15')
  })

  it('returns null for empty or invalid input', () => {
    expect(toDateColumn(null)).toBeNull()
    expect(toDateColumn('nope')).toBeNull()
  })
})
