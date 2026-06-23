import {
  addMoney,
  absMoney,
  compareMoney,
  formatMoney,
  fromUnits,
  negateMoney,
  subMoney,
  toUnits,
} from '../../lib/money'

describe('money — exact decimal arithmetic', () => {
  it('round-trips numeric(18,4) strings through units', () => {
    expect(toUnits('12.3400')).toBe(123400)
    expect(fromUnits(123400)).toBe('12.3400')
    expect(fromUnits(toUnits('0.0001'))).toBe('0.0001')
    expect(fromUnits(toUnits('-7.5000'))).toBe('-7.5000')
  })

  it('formats whole + negative + sub-cent values', () => {
    expect(formatMoney('100')).toBe('100.0000')
    expect(formatMoney(0)).toBe('0.0000')
    expect(formatMoney('-3')).toBe('-3.0000')
    expect(fromUnits(-0)).toBe('0.0000') // no negative zero
  })

  it('adds/subtracts without floating-point drift', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754 — units math makes it exact.
    expect(addMoney('0.1000', '0.2000')).toBe('0.3000')
    let acc = '0.0000'
    for (let i = 0; i < 100; i++) acc = addMoney(acc, '0.0010')
    expect(acc).toBe('0.1000')
    expect(subMoney('100.0000', '0.0010')).toBe('99.9990')
  })

  it('negates and takes absolute value', () => {
    expect(negateMoney('5.0000')).toBe('-5.0000')
    expect(negateMoney('-5.0000')).toBe('5.0000')
    expect(negateMoney('0')).toBe('0.0000')
    expect(absMoney('-12.3400')).toBe('12.3400')
    expect(absMoney('12.3400')).toBe('12.3400')
  })

  it('compares values', () => {
    expect(compareMoney('1.0000', '2.0000')).toBe(-1)
    expect(compareMoney('2.0000', '2.0000')).toBe(0)
    expect(compareMoney('3.0000', '2.0000')).toBe(1)
    expect(compareMoney('-0.0001', '0')).toBe(-1)
  })

  it('treats null/undefined as zero', () => {
    expect(toUnits(null)).toBe(0)
    expect(toUnits(undefined)).toBe(0)
    expect(addMoney('5', null as unknown as string)).toBe('5.0000')
  })
})
