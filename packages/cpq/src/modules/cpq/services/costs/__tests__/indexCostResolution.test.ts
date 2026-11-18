import { CpqCostIndexValue } from '../../../data/entities'
import { computeIndexUnitAmount, loadValuesInForce, normalizeDecimal, resolveIndexCost, type IndexValueInForce } from '../indexCostResolution'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const INDEX = { id: 'idx-1', currencyCode: 'EUR' }
const inForce = (over: Partial<IndexValueInForce> = {}): IndexValueInForce => ({ indexId: 'idx-1', effectiveDate: '2026-11-10', revision: 2, value: '82.400000', ...over })
const values = (...rows: IndexValueInForce[]) => new Map(rows.map((row) => [row.indexId, row]))

describe('computeIndexUnitAmount (factor x value + offset, exact decimals, half-up to 4 dp)', () => {
  it.each([
    ['82.400000', '0.500000', '2.0000', '43.2'],
    ['82.400000', '1', '0', '82.4'],
    ['82.400000', null, null, '82.4'],
    ['0.100000', '3.000000', '0.0000', '0.3'], // 0.1 x 3 is exactly 0.3 (no float drift)
    ['1.000000', '0.333333', '0.0000', '0.3333'],
    ['2.000000', '0.333333', '0.0000', '0.6667'], // 0.666666 -> half up
    ['0.000050', '1.000000', '0.0000', '0.0001'], // exactly half -> up
    ['0.000049', '1.000000', '0.0000', '0'],
    ['1234567890.123456', '12.000000', '0.5000', '14814814681.9815'],
  ])('%s x %s + %s = %s', (value, factor, offset, expected) => {
    expect(computeIndexUnitAmount(value, factor, offset)).toBe(expected)
  })

  it('refuses input that is not a plain non-negative decimal (defensive: the DB CHECKs make it unreachable)', () => {
    expect(computeIndexUnitAmount('abc', '1', '0')).toBeNull()
    expect(computeIndexUnitAmount('-5', '1', '0')).toBeNull()
    expect(computeIndexUnitAmount('5', '1e3', '0')).toBeNull()
  })
})

describe('normalizeDecimal', () => {
  it('trims trailing zeros and falls back for null', () => {
    expect(normalizeDecimal('82.400000', '0')).toBe('82.4')
    expect(normalizeDecimal('2.0000', '0')).toBe('2')
    expect(normalizeDecimal(null, '1')).toBe('1')
  })
})

describe('resolveIndexCost', () => {
  const element = { costIndexId: 'idx-1', indexFactor: '0.500000', indexOffset: '2.0000' }

  it('returns the unit amount in the index currency and the full snapshot', () => {
    expect(resolveIndexCost({ element, index: INDEX, valuesInForce: values(inForce()), asOfDate: '2026-11-12' })).toEqual({
      ok: true, unitAmount: '43.2', currencyCode: 'EUR',
      snapshot: { indexId: 'idx-1', currencyCode: 'EUR', effectiveDate: '2026-11-10', revision: 2, value: '82.4', factor: '0.5', offset: '2', asOfDate: '2026-11-12' },
    })
  })

  it('defaults factor 1 and offset 0 when the element has none', () => {
    const result = resolveIndexCost({ element: { costIndexId: 'idx-1' }, index: INDEX, valuesInForce: values(inForce()), asOfDate: '2026-11-12' })
    expect(result).toMatchObject({ ok: true, unitAmount: '82.4', snapshot: { factor: '1', offset: '0' } })
  })

  it('no value in force, no index or no index id is INDEX_NO_VALUE', () => {
    expect(resolveIndexCost({ element, index: INDEX, valuesInForce: new Map(), asOfDate: '2026-11-12' })).toEqual({ ok: false, errorCode: 'INDEX_NO_VALUE' })
    expect(resolveIndexCost({ element, index: null, valuesInForce: values(inForce()), asOfDate: '2026-11-12' })).toEqual({ ok: false, errorCode: 'INDEX_NO_VALUE' })
    expect(resolveIndexCost({ element: {}, index: INDEX, valuesInForce: values(inForce()), asOfDate: '2026-11-12' })).toEqual({ ok: false, errorCode: 'INDEX_NO_VALUE' })
  })
})

describe('loadValuesInForce', () => {
  const row = (costIndexId: string, effectiveDate: string, revision: number, value: string) => ({ ...SCOPE, costIndexId, effectiveDate, revision, value })

  it('one query for all indices; picks the latest date then the highest revision, whatever order the rows come in', async () => {
    const find = jest.fn(async () => [
      row('a', '2026-11-01', 3, '1.000000'), row('a', '2026-11-10', 1, '5.000000'), row('a', '2026-11-10', 2, '6.000000'),
      row('b', '2026-10-01', 1, '9.000000'),
    ])
    const out = await loadValuesInForce({ find } as never, ['a', 'b', 'a', 'c'], '2026-11-12', SCOPE)
    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(CpqCostIndexValue, { ...SCOPE, costIndexId: { $in: ['a', 'b', 'c'] }, effectiveDate: { $lte: '2026-11-12' } }, expect.anything())
    expect(out.get('a')).toEqual({ indexId: 'a', effectiveDate: '2026-11-10', revision: 2, value: '6.000000' })
    expect(out.get('b')).toMatchObject({ revision: 1 })
    expect(out.has('c')).toBe(false)
  })

  it('reads nothing for no indices', async () => {
    const find = jest.fn()
    expect((await loadValuesInForce({ find } as never, [], '2026-11-12', SCOPE)).size).toBe(0)
    expect(find).not.toHaveBeenCalled()
  })
})
