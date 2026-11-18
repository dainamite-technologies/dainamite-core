import {
  addValueFormIssues,
  buildAddValueBody,
  buildCreateIndexBody,
  classifyIndexError,
  createIndexFormIssues,
  emptyCreateIndexForm,
  formatCurrentValue,
  formatIndexDate,
  formatIndexValue,
  groupValuesByDate,
  importErrorLines,
  parseIndexValuesCsv,
  readImportErrors,
  sameDateNotice,
  splitCsvLine,
  summarizeImport,
  valueBadges,
  type CostIndexValueRow,
} from '../costIndexView'

const row = (patch: Partial<CostIndexValueRow>): CostIndexValueRow => ({
  id: 'v', effectiveDate: '2026-11-10', value: '80.000000', revision: 1, sourceNote: null, createdByUserId: null,
  createdAt: '2026-11-10T00:00:00Z', inForceToday: false, superseded: false, future: false, ...patch,
})

describe('formatting', () => {
  it('formats dates without a timezone shift and tolerates junk', () => {
    expect(formatIndexDate('2026-11-10')).toBe('10 Nov 2026')
    expect(formatIndexDate('2026-01-05')).toBe('5 Jan 2026')
    expect(formatIndexDate('nope')).toBe('nope')
  })
  it('shows at least two decimals and drops trailing zeros beyond that', () => {
    expect(formatIndexValue('82.400000')).toBe('82.40')
    expect(formatIndexValue('82.123400')).toBe('82.1234')
    expect(formatIndexValue('82')).toBe('82.00')
    expect(formatIndexValue(0.5)).toBe('0.50')
  })
  it('renders the current value label or null', () => {
    expect(formatCurrentValue({ effectiveDate: '2026-11-10', value: '82.400000', revision: 2 })).toBe('82.40 · 10 Nov 2026 · r2')
    expect(formatCurrentValue(null)).toBeNull()
  })
})

describe('value list helpers', () => {
  it('badges: in force, future, superseded; a superseded row is never in force', () => {
    expect(valueBadges(row({ inForceToday: true }))).toEqual(['inForce'])
    expect(valueBadges(row({ future: true }))).toEqual(['future'])
    expect(valueBadges(row({ superseded: true, inForceToday: true }))).toEqual(['superseded'])
    expect(valueBadges(row({}))).toEqual([])
  })
  it('groups revisions of a date, highest revision as latest', () => {
    const groups = groupValuesByDate([
      row({ id: 'a', effectiveDate: '2026-12-01', revision: 1, future: true }),
      row({ id: 'b2', effectiveDate: '2026-11-10', revision: 2 }),
      row({ id: 'b1', effectiveDate: '2026-11-10', revision: 1, superseded: true }),
      row({ id: 'c', effectiveDate: '2026-10-10', revision: 1 }),
    ])
    expect(groups.map((g) => [g.effectiveDate, g.latest.id, g.corrections.map((c) => c.id)])).toEqual([
      ['2026-12-01', 'a', []],
      ['2026-11-10', 'b2', ['b1']],
      ['2026-10-10', 'c', []],
    ])
  })
  it('groups out-of-order revisions too', () => {
    const [group] = groupValuesByDate([row({ id: 'r1', revision: 1 }), row({ id: 'r3', revision: 3 }), row({ id: 'r2', revision: 2 })])
    expect(group.latest.id).toBe('r3')
    expect(group.corrections.map((c) => c.id)).toEqual(['r2', 'r1'])
  })
  it('same-date notice names the next revision and the replaced value', () => {
    expect(sameDateNotice(null)).toBeNull()
    expect(sameDateNotice({ revision: 1, value: '80.000000' })).toEqual({ nextRevision: 2, replaces: '80.00' })
  })
})

describe('forms', () => {
  it('validates the create form and builds a trimmed body', () => {
    expect(createIndexFormIssues(emptyCreateIndexForm())).toEqual(['code', 'name', 'unit', 'currency'])
    const form = { code: ' DEMO-DC-POWER ', name: ' Power ', unit: 'EUR/MWh', currencyCode: 'EUR', description: '  ' }
    expect(createIndexFormIssues(form)).toEqual([])
    expect(buildCreateIndexBody(form)).toEqual({ code: 'DEMO-DC-POWER', name: 'Power', unit: 'EUR/MWh', currencyCode: 'EUR' })
    expect(createIndexFormIssues({ ...form, code: 'a' })).toEqual(['code'])
  })
  it('validates the value form (date, strictly positive, max 6 decimals)', () => {
    expect(addValueFormIssues({ effectiveDate: '2026-11-10', value: '82.4', sourceNote: '' })).toEqual([])
    expect(addValueFormIssues({ effectiveDate: '2026-02-30', value: '0', sourceNote: '' })).toEqual(['date', 'value'])
    expect(addValueFormIssues({ effectiveDate: '2026-11-10', value: '1.1234567', sourceNote: '' })).toEqual(['value'])
    expect(addValueFormIssues({ effectiveDate: '2026-11-10', value: '-3', sourceNote: '' })).toEqual(['value'])
    expect(buildAddValueBody({ effectiveDate: '2026-11-10', value: '82.4', sourceNote: ' note ' })).toEqual({ effectiveDate: '2026-11-10', value: 82.4, sourceNote: 'note' })
    expect(buildAddValueBody({ effectiveDate: '2026-11-10', value: '82.4', sourceNote: '' })).toEqual({ effectiveDate: '2026-11-10', value: 82.4 })
  })
})

describe('CSV import parsing', () => {
  it('parses the header, rows and notes into the import body', () => {
    const result = parseIndexValuesCsv('indexCode,effectiveDate,value,note\nDEMO,2026-11-01,82.40,Monthly\nDEMO,2026-12-01,83\n')
    expect(result.issues).toEqual([])
    expect(result.items).toEqual([
      { indexCode: 'DEMO', effectiveDate: '2026-11-01', value: 82.4, sourceNote: 'Monthly' },
      { indexCode: 'DEMO', effectiveDate: '2026-12-01', value: 83 },
    ])
    expect(result.lines).toEqual([2, 3])
  })
  it('works without a header, with CRLF, BOM, blank lines, tabs and semicolons', () => {
    expect(parseIndexValuesCsv('﻿DEMO,2026-11-01,1\r\n\r\nDEMO,2026-11-02,2').items).toHaveLength(2)
    expect(parseIndexValuesCsv('DEMO\t2026-11-01\t1.5').items[0].value).toBe(1.5)
    expect(parseIndexValuesCsv('DEMO;2026-11-01;1;a, b').items[0]).toMatchObject({ value: 1, sourceNote: 'a, b' })
  })
  it('honours quoted notes with commas and escaped quotes', () => {
    expect(splitCsvLine('DEMO,2026-11-01,1,"a, ""b"""', ',')).toEqual(['DEMO', '2026-11-01', '1', 'a, "b"'])
    expect(parseIndexValuesCsv('DEMO,2026-11-01,1,"x, y"').items[0].sourceNote).toBe('x, y')
  })
  it('reports line-numbered issues and keeps the good rows', () => {
    const result = parseIndexValuesCsv('indexCode,effectiveDate,value\nDEMO,2026-11-01,1\nDEMO,2026-13-01,1\nDEMO,2026-11-03,0\nDEMO,2026-11-04\nDEMO\n,2026-11-04,1')
    expect(result.items).toHaveLength(1)
    expect(result.issues).toEqual([
      { line: 3, code: 'BAD_DATE' }, { line: 4, code: 'BAD_VALUE' }, { line: 5, code: 'BAD_COLUMNS' },
      { line: 6, code: 'BAD_COLUMNS' }, { line: 7, code: 'BAD_COLUMNS' },
    ])
  })
  it('flags empty input and more than 1000 rows', () => {
    expect(parseIndexValuesCsv('  \n').issues).toEqual([{ line: 0, code: 'EMPTY' }])
    expect(parseIndexValuesCsv('indexCode,effectiveDate,value\n').issues).toEqual([{ line: 0, code: 'EMPTY' }])
    const many = Array.from({ length: 1001 }, () => 'DEMO,2026-11-01,1').join('\n')
    expect(parseIndexValuesCsv(many).issues).toEqual([{ line: 0, code: 'TOO_MANY_ROWS' }])
  })
})

describe('import responses and errors', () => {
  it('summarizes dry-run results', () => {
    expect(summarizeImport([
      { row: 1, indexCode: 'A', effectiveDate: '2026-11-01', status: 'created', revision: 1 },
      { row: 2, indexCode: 'A', effectiveDate: '2026-11-02', status: 'unchanged', revision: 1 },
      { row: 3, indexCode: 'A', effectiveDate: '2026-11-03', status: 'created', revision: 2 },
    ])).toEqual({ created: 2, unchanged: 1 })
  })
  it('reads row errors and maps them back to pasted lines', () => {
    const errors = readImportErrors({ error: 'IMPORT_VALIDATION_FAILED', errors: [{ row: 2, code: 'UNKNOWN_INDEX', indexCode: 'X' }, { row: 'bad' }, null] })
    expect(errors).toEqual([{ row: 2, code: 'UNKNOWN_INDEX', indexCode: 'X' }])
    expect(importErrorLines(errors, [2, 5])).toEqual([{ row: 2, code: 'UNKNOWN_INDEX', indexCode: 'X', line: 5 }])
    expect(importErrorLines([{ row: 9, code: 'X' }], [2])[0].line).toBeNull()
    expect(readImportErrors({ error: 'x' })).toEqual([])
  })
  it('classifies API failures', () => {
    expect(classifyIndexError(404, { error: 'Not found' })).toMatchObject({ code: 'COST_PLUS_DISABLED', toggleOff: true })
    expect(classifyIndexError(404, { error: 'Cost index not found' })).toMatchObject({ toggleOff: false })
    const element = { id: 'e', code: 'c', name: 'n', role: 'price_basis', productChargeId: 'p', chargeCode: 'fee', isActive: true }
    expect(classifyIndexError(422, { error: 'INDEX_IN_USE', elements: [element] })).toEqual({ code: 'INDEX_IN_USE', elements: [element], toggleOff: false })
    expect(classifyIndexError(409, { error: 'CONCURRENT_INDEX_WRITE' }).code).toBe('CONCURRENT_INDEX_WRITE')
    expect(classifyIndexError(409, null).code).toBe('CONCURRENT_INDEX_WRITE')
    expect(classifyIndexError(403, {}).code).toBe('FORBIDDEN')
    expect(classifyIndexError(400, { error: 'Validation error' }).code).toBe('VALIDATION')
  })
})
