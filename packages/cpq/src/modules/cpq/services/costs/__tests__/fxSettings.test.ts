import { clampMaxDaysBack, normalizeSourcePriority, readFxSettings } from '../fxSettings'

const ok = (value: unknown) => ({ ok: true, value })
const fail = (code: string) => ({ ok: false, error: { code } })
function toggles(days: unknown, priority: unknown) {
  return {
    getNumberConfig: jest.fn(async () => days as never),
    getJsonConfig: jest.fn(async () => priority as never),
  }
}

describe('readFxSettings', () => {
  it('reads both toggles for the tenant', async () => {
    const t = toggles(ok(3), ok(['ecb', 'manual']))
    expect(await readFxSettings(t as never, 'tenant')).toEqual({ maxDaysBack: 3, sourcePriority: ['ecb', 'manual'] })
    expect(t.getNumberConfig).toHaveBeenCalledWith('cpq.cost_plus.fx_max_days_back', 'tenant')
    expect(t.getJsonConfig).toHaveBeenCalledWith('cpq.cost_plus.fx_source_priority', 'tenant')
  })

  it.each([
    ['missing toggle', fail('MISSING_TOGGLE')],
    ['type mismatch', fail('TYPE_MISMATCH')],
  ])('%s falls back to 7 days and no priority', async (_name, failure) => {
    expect(await readFxSettings(toggles(failure, failure) as never, 'tenant')).toEqual({ maxDaysBack: 7, sourcePriority: [] })
  })

  it('a throwing toggle service falls back to the defaults', async () => {
    const t = { getNumberConfig: jest.fn().mockRejectedValue(new Error('db')), getJsonConfig: jest.fn().mockRejectedValue(new Error('db')) }
    expect(await readFxSettings(t as never, 'tenant')).toEqual({ maxDaysBack: 7, sourcePriority: [] })
  })

  it('no toggle service gives the defaults', async () => {
    expect(await readFxSettings(undefined, 'tenant')).toEqual({ maxDaysBack: 7, sourcePriority: [] })
  })
})

describe('clampMaxDaysBack', () => {
  it.each([
    [7, 7], [0, 0], [30, 30], [31, 30], [1000, 30], [-1, 0], [-0.5, 0], [2.9, 2],
    [NaN, 7], [Infinity, 7], ['5', 7], [null, 7], [undefined, 7],
  ])('%p -> %p', (input, expected) => {
    expect(clampMaxDaysBack(input)).toBe(expected)
  })
})

describe('normalizeSourcePriority', () => {
  it('keeps trimmed unique non-empty strings in order', () => {
    expect(normalizeSourcePriority([' ecb ', 'manual', 'ecb', '', '  ', 5, null, 'nbp'])).toEqual(['ecb', 'manual', 'nbp'])
  })
  it.each([[null], [undefined], ['ecb'], [{ 0: 'ecb' }], [7]])('non-array %p -> []', (input) => {
    expect(normalizeSourcePriority(input)).toEqual([])
  })
})
