import { formatDateOnly, toIsoDate } from '../../lib/dateOnly'

describe('dateOnly', () => {
  it('toIsoDate keeps the calendar day of a YYYY-MM-DD string', () => {
    expect(toIsoDate('2026-12-01')).toBe('2026-12-01')
  })

  it('formatDateOnly formats the stored day in UTC (no off-by-one)', () => {
    expect(formatDateOnly('2026-12-01', 'en-GB')).toBe('01/12/2026')
    expect(formatDateOnly(new Date('2026-12-31T00:00:00Z'), 'en-GB')).toBe('31/12/2026')
  })

  it('formatDateOnly renders an em dash for empty values', () => {
    expect(formatDateOnly(null)).toBe('—')
    expect(formatDateOnly(undefined)).toBe('—')
  })
})
