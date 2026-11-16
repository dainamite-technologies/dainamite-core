import { formatIndexNumber, hasIndexNoValue, indexLockHint, indexSnapshotLine, indexSnapshotTooltip, indexTodayHelp, readIndexSnapshot } from '../indexView'

// Mirrors the I18nProvider's `{name}` interpolation with the fallback text.
const t = (_key: string, fallback?: string, params?: Record<string, string | number>) =>
  (fallback ?? '').replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))

const snapshot = { indexId: 'i1', currencyCode: 'EUR', effectiveDate: '2026-11-01', revision: 2, value: '82.4', factor: '0.5', offset: '0', asOfDate: '2026-11-16' }

describe('readIndexSnapshot', () => {
  it('reads a full snapshot and rejects anything partial', () => {
    expect(readIndexSnapshot(snapshot)).toEqual(snapshot)
    expect(readIndexSnapshot(null)).toBeNull()
    expect(readIndexSnapshot({ ...snapshot, value: undefined })).toBeNull()
    expect(readIndexSnapshot({ ...snapshot, revision: 'x' })).toBeNull()
  })
})

describe('formatIndexNumber', () => {
  it('shows 2 to 4 decimals', () => {
    expect(formatIndexNumber('82.4')).toBe('82.40')
    expect(formatIndexNumber('7')).toBe('7.00')
    expect(formatIndexNumber('43.2125')).toBe('43.2125')
    expect(formatIndexNumber('')).toBe('')
  })
})

describe('indexSnapshotLine', () => {
  it('names the index, the value in force, date, revision and the factor', () => {
    expect(indexSnapshotLine(snapshot, { code: 'DEMO-DC-POWER', unit: 'MWh' }, t)).toBe('DEMO-DC-POWER 82.40 EUR/MWh · 2026-11-01 r2 · × 0.5')
  })
  it('appends a non-zero offset and leaves the name out without a label', () => {
    expect(indexSnapshotLine({ ...snapshot, offset: '2' }, null, t)).toBe('82.40 EUR · 2026-11-01 r2 · × 0.5 + 2.00')
  })
  it('tooltip adds the freeze rule only while locked', () => {
    expect(indexSnapshotTooltip(snapshot, { locked: true }, t)).toContain(indexLockHint(t))
    expect(indexSnapshotTooltip(snapshot, { locked: false }, t)).not.toContain('Frozen')
    expect(indexSnapshotTooltip(snapshot, {}, t)).toBe('Value in force on 2026-11-16, effective 2026-11-01 (revision 2)')
  })
})

describe('hasIndexNoValue', () => {
  it('matches only the INDEX_NO_VALUE code', () => {
    expect(hasIndexNoValue({ error: 'INDEX_NO_VALUE' })).toBe(true)
    expect(hasIndexNoValue({ error: 'CURRENCY_NO_RATE' })).toBe(false)
    expect(hasIndexNoValue({})).toBe(false)
  })
})

describe('indexTodayHelp', () => {
  const current = { effectiveDate: '2026-11-10', value: '82.4', revision: 2 }
  it('is empty until an index is picked', () => expect(indexTodayHelp(null, t)).toBeNull())
  it('shows the value in force and the unit cost the engine will compute', () => {
    expect(indexTodayHelp({ current, currencyCode: 'USD', unit: 'bbl', factor: '0.5', offset: '2' }, t))
      .toBe('Today: 82.40 USD/bbl (2026-11-10, r2) → unit cost 43.20 USD')
  })
  it('treats a blank factor / offset as 1 / 0', () => {
    expect(indexTodayHelp({ current, currencyCode: 'USD', unit: 'bbl', factor: '', offset: '' }, t)).toContain('unit cost 82.40 USD')
  })
  it('warns when the index has no value in force', () => {
    expect(indexTodayHelp({ current: null, currencyCode: 'USD', factor: '1', offset: '0' }, t)).toContain('No value in force today')
  })
})
