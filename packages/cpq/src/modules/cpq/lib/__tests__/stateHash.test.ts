import { canonicalJson, canonicalStateHash, normalizeDay, normalizeDecimal } from '../stateHash'

describe('canonicalJson / canonicalStateHash', () => {
  it('ignores object key order at every depth and keeps array order', () => {
    expect(canonicalStateHash({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(canonicalStateHash({ b: { d: 'x', c: [1, 2] }, a: 1 }))
    expect(canonicalStateHash({ a: [1, 2] })).not.toBe(canonicalStateHash({ a: [2, 1] }))
  })

  it('is a sha256 hex digest, stable across calls', () => {
    expect(canonicalStateHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
    expect(canonicalStateHash({ a: 1 })).toBe(canonicalStateHash({ a: 1 }))
    expect(canonicalStateHash({ a: 1 })).not.toBe(canonicalStateHash({ a: 2 }))
  })

  it('treats undefined and null alike, but a missing key differs from a null one', () => {
    expect(canonicalStateHash({ a: undefined, b: 1 })).toBe(canonicalStateHash({ a: null, b: 1 }))
    expect(canonicalStateHash({ b: 1 })).not.toBe(canonicalStateHash({ a: null, b: 1 }))
    expect(canonicalJson(undefined)).toBe('null')
  })

  it('hashes a Date as its ISO string, so a Date and the same instant as a string agree', () => {
    const date = new Date('2027-01-01T00:00:00.000Z')
    expect(canonicalStateHash({ d: date })).toBe(canonicalStateHash({ d: '2027-01-01T00:00:00.000Z' }))
    expect(canonicalStateHash({ d: date })).not.toBe(canonicalStateHash({ d: new Date('2027-01-02T00:00:00.000Z') }))
    expect(canonicalJson(new Date('invalid'))).toBe('null')
  })

  it('does not normalise numeric strings itself: "1" and 1 are different values (callers normalise decimal fields)', () => {
    expect(canonicalStateHash({ a: '1' })).not.toBe(canonicalStateHash({ a: 1 }))
  })

  it('is byte-identical to the canonical form arcPriceFreeze compared before the extraction', () => {
    expect(canonicalJson({ b: [1, { z: null, y: 'q' }], a: true })).toBe('{"a":true,"b":[1,{"y":"q","z":null}]}')
  })
})

describe('normalizeDecimal', () => {
  it.each([
    ['270', '270'], ['270.0000', '270'], [270, '270'], ['0270.00', '270'], ['270.5000', '270.5'], ['270.50', '270.5'], ['0.0000', '0'], ['-0.00', '0'],
    ['-12.300', '-12.3'], ['+5', '5'], ['.5', '0.5'], ['  7.10 ', '7.1'], [0, '0'], [1.25, '1.25'],
  ] as const)('%p -> %p', (input, expected) => expect(normalizeDecimal(input)).toBe(expected))

  it('maps empty input to null and never turns a non-decimal string into a number', () => {
    for (const empty of [null, undefined, '', '  ', Number.NaN, Number.POSITIVE_INFINITY]) expect(normalizeDecimal(empty as never)).toBeNull()
    expect(normalizeDecimal('abc')).toBe('abc')
    expect(normalizeDecimal('1e3')).toBe('1e3')
    expect(normalizeDecimal('.')).toBe('.')
  })

  it('makes two spellings of one amount hash alike and two amounts differ', () => {
    expect(canonicalStateHash({ v: normalizeDecimal('270.0000') })).toBe(canonicalStateHash({ v: normalizeDecimal(270) }))
    expect(canonicalStateHash({ v: normalizeDecimal('270.0001') })).not.toBe(canonicalStateHash({ v: normalizeDecimal(270) }))
  })
})

describe('normalizeDay', () => {
  it('reduces a Date or a timestamp string to YYYY-MM-DD and keeps empty as null', () => {
    expect(normalizeDay(new Date('2028-11-30T23:59:59.000Z'))).toBe('2028-11-30')
    expect(normalizeDay('2028-11-30T00:00:00.000Z')).toBe('2028-11-30')
    expect(normalizeDay('2028-11-30')).toBe('2028-11-30')
    expect(normalizeDay(null)).toBeNull()
    expect(normalizeDay(undefined)).toBeNull()
    expect(normalizeDay('')).toBeNull()
    expect(normalizeDay(new Date('invalid'))).toBeNull()
  })
})
