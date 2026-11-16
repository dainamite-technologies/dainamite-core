import { cycleDayOf, defaultCycleDay, normalizeCycleDay, toCycleSpec, validateCycleSpec } from '../../lib/billCycle'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('billCycle', () => {
  it('normalizes day input', () => {
    expect(normalizeCycleDay('05')).toBe('5')
    expect(normalizeCycleDay(31)).toBe('31')
    expect(normalizeCycleDay(' Mon ')).toBe('mon')
    expect(normalizeCycleDay('0')).toBeNull()
    expect(normalizeCycleDay('32')).toBeNull()
    expect(normalizeCycleDay('monday')).toBeNull()
    expect(normalizeCycleDay('')).toBeNull()
    expect(normalizeCycleDay(null)).toBeNull()
  })

  it('validates the day shape per unit', () => {
    expect(validateCycleSpec({ cycle: 'monthly', interval: 1, day: '31' })).toBeNull()
    expect(validateCycleSpec({ cycle: 'annually', interval: 1, day: '15' })).toBeNull()
    expect(validateCycleSpec({ cycle: 'weekly', interval: 2, day: 'fri' })).toBeNull()
    expect(validateCycleSpec({ cycle: 'daily', interval: 30, day: null })).toBeNull()
    expect(validateCycleSpec({ cycle: 'monthly', interval: 1, day: 'mon' })?.path).toBe('billCycleDay')
    expect(validateCycleSpec({ cycle: 'weekly', interval: 1, day: '1' })?.path).toBe('billCycleDay')
    expect(validateCycleSpec({ cycle: 'daily', interval: 30, day: '1' })?.path).toBe('billCycleDay')
    expect(validateCycleSpec({ cycle: 'monthly', interval: 1, day: null })?.path).toBe('billCycleDay')
  })

  it('validates the interval range per unit', () => {
    expect(validateCycleSpec({ cycle: 'daily', interval: 366, day: null })).toBeNull()
    expect(validateCycleSpec({ cycle: 'monthly', interval: 25, day: '1' })?.path).toBe('billCycleInterval')
    expect(validateCycleSpec({ cycle: 'annually', interval: 6, day: '1' })?.path).toBe('billCycleInterval')
    expect(validateCycleSpec({ cycle: 'weekly', interval: 0, day: 'mon' })?.path).toBe('billCycleInterval')
    expect(validateCycleSpec({ cycle: 'monthly', interval: 1.5, day: '1' })?.path).toBe('billCycleInterval')
  })

  it('derives the default day from the first bill date or the unit', () => {
    expect(defaultCycleDay('monthly', d('2026-12-15'))).toBe('15')
    expect(defaultCycleDay('weekly', d('2026-11-16'))).toBe('mon')
    expect(defaultCycleDay('daily', d('2026-11-16'))).toBeNull()
    expect(defaultCycleDay('monthly', null)).toBe('1')
    expect(defaultCycleDay('weekly', null)).toBe('mon')
    expect(cycleDayOf(d('2026-11-21'), 'weekly')).toBe('sat')
  })

  it('a bare unit is "every 1, unpinned"', () => {
    expect(toCycleSpec('monthly')).toEqual({ cycle: 'monthly', interval: 1, day: null })
  })
})
