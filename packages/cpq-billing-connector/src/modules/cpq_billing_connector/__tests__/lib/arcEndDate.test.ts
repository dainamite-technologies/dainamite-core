import { arcItemEndDate, buildArcEndDateUpdate, buildArcEndDateUpdates } from '../../lib/arcEndDate'

describe('arcItemEndDate — max(effective − 1, billStart − 1)', () => {
  it('ends a started item the day before the effective date', () => {
    expect(arcItemEndDate('2026-11-16', '2026-10-01')).toBe('2026-11-15')
  })

  it('ends a not-yet-started item the day before its own start', () => {
    expect(arcItemEndDate('2026-11-16', '2026-11-20')).toBe('2026-11-19')
  })

  it('treats an item starting on the effective date as cancelled before start', () => {
    expect(arcItemEndDate('2026-11-20', '2026-11-20')).toBe('2026-11-19')
  })

  it('accepts Date bill starts and crosses month / year boundaries', () => {
    expect(arcItemEndDate('2027-01-01', new Date('2026-06-01T00:00:00.000Z'))).toBe('2026-12-31')
    expect(arcItemEndDate('2026-03-01', '2026-01-01')).toBe('2026-02-28')
  })
})

describe('buildArcEndDateUpdate', () => {
  const change = { effectiveDate: '2026-11-16', code: 'subscription_cancelled' as const, reference: 'SO-1234' }

  it('carries the generated credit reason with the reference and effective date', () => {
    expect(buildArcEndDateUpdate({ id: 'i-1', billStartDate: '2026-10-01', billEndDate: null }, change)).toEqual({
      id: 'i-1',
      billEndDate: '2026-11-15',
      creditReasonCode: 'subscription_cancelled',
      creditReasonParams: { reference: 'SO-1234', effectiveDate: '2026-11-16' },
    })
  })

  it('omits the reference when the order number is unknown', () => {
    const update = buildArcEndDateUpdate(
      { id: 'i-1', billStartDate: '2026-10-01' },
      { effectiveDate: '2026-11-16', code: 'subscription_amended' },
    )
    expect(update?.creditReasonParams).toEqual({ effectiveDate: '2026-11-16' })
  })

  it('shortens a later end date', () => {
    expect(
      buildArcEndDateUpdate({ id: 'i-1', billStartDate: '2026-10-01', billEndDate: '2027-09-30' }, change)?.billEndDate,
    ).toBe('2026-11-15')
  })

  it('skips an item already ended on that date (re-delivered event) or earlier (never extends)', () => {
    expect(buildArcEndDateUpdate({ id: 'i-1', billStartDate: '2026-10-01', billEndDate: '2026-11-15' }, change)).toBeNull()
    expect(
      buildArcEndDateUpdate({ id: 'i-1', billStartDate: '2026-10-01', billEndDate: new Date('2026-11-01T00:00:00Z') }, change),
    ).toBeNull()
  })

  it('builds updates for many items, leaving out the ones with nothing to write', () => {
    const updates = buildArcEndDateUpdates(
      [
        { id: 'started', billStartDate: '2026-10-01' },
        { id: 'future', billStartDate: '2026-12-01' },
        { id: 'done', billStartDate: '2026-10-01', billEndDate: '2026-10-31' },
      ],
      change,
    )
    expect(updates.map((u) => [u.id, u.billEndDate])).toEqual([
      ['started', '2026-11-15'],
      ['future', '2026-11-30'],
    ])
  })
})
