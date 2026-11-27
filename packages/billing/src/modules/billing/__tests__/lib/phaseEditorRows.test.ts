import {
  canAddPhase,
  movePhaseRow,
  newPhaseRow,
  phaseRowRanges,
  phaseRowsFromApi,
  phaseRowsToPayload,
  samePhasePayload,
  validatePhaseRows,
} from '../../lib/phaseEditorRows'
import type { PhaseRow } from '../../lib/itemStatusLabel'

describe('phaseRowsToPayload', () => {
  it('sends duration or until date and drops the value of free phases', () => {
    const rows = [
      newPhaseRow({ name: ' Free trial ', durationCount: '1', durationUnit: 'month', priceType: 'free', value: '9' }),
      newPhaseRow({ mode: 'until', untilDate: '2027-06-30', priceType: 'percent_off', value: '50' }),
    ]
    expect(phaseRowsToPayload(rows)).toEqual([
      { name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free', value: null },
      { name: null, endDate: '2027-06-30', priceType: 'percent_off', value: 50 },
    ])
  })
})

describe('phaseRowsFromApi', () => {
  it('round-trips read rows ordered by sequence', () => {
    const api: PhaseRow[] = [
      { id: 'b', sequence: 1, name: null, durationUnit: null, durationCount: null, untilDate: '2027-06-30', startDate: '2026-12-14', endDate: '2027-06-30', priceType: 'fixed', value: 10 },
      { id: 'a', sequence: 0, name: 'Trial', durationUnit: 'month', durationCount: 1, untilDate: null, startDate: '2026-11-14', endDate: '2026-12-13', priceType: 'free', value: null },
    ]
    const rows = phaseRowsFromApi(api)
    expect(rows.map((r) => [r.name, r.mode, r.durationCount, r.untilDate, r.priceType, r.value])).toEqual([
      ['Trial', 'duration', '1', '2026-12-13', 'free', ''],
      ['', 'until', '1', '2027-06-30', 'fixed', '10'],
    ])
    expect(phaseRowsFromApi(null)).toEqual([])
  })
})

describe('validatePhaseRows', () => {
  it('requires at least one phase', () => {
    expect(validatePhaseRows('2026-11-14', [])?.path).toBe('phases')
  })

  it('requires an until date in until mode', () => {
    expect(validatePhaseRows('2026-11-14', [newPhaseRow({ mode: 'until', untilDate: '' })])).toMatchObject({ index: 0, path: 'endDate' })
  })

  it('applies the server rules (value ranges, back-to-back dates)', () => {
    expect(validatePhaseRows('2026-11-14', [newPhaseRow({ priceType: 'percent_off', value: '120' })])).toMatchObject({ path: 'value' })
    expect(validatePhaseRows('2026-11-14', [newPhaseRow({ priceType: 'fixed', value: '' })])).toMatchObject({ path: 'value' })
    expect(validatePhaseRows('2026-11-14', [newPhaseRow({ durationCount: '0' })])).toMatchObject({ path: 'durationCount' })
    expect(
      validatePhaseRows('2026-11-14', [newPhaseRow({}), newPhaseRow({ mode: 'until', untilDate: '2026-12-01' })]),
    ).toMatchObject({ index: 1, path: 'endDate' })
    expect(validatePhaseRows('2026-11-14', [newPhaseRow({}), newPhaseRow({ priceType: 'fixed', value: '5' })])).toBeNull()
  })
})

describe('phaseRowRanges', () => {
  it('computes back-to-back ranges from the bill start (month ends clamp)', () => {
    const rows = [newPhaseRow({}), newPhaseRow({ durationCount: '2', durationUnit: 'week' })]
    expect(phaseRowRanges('2026-11-14', rows)).toEqual([
      { start: '2026-11-14', end: '2026-12-13' },
      { start: '2026-12-14', end: '2026-12-27' },
    ])
    expect(phaseRowRanges('2026-01-31', [newPhaseRow({})])).toEqual([{ start: '2026-01-31', end: '2026-02-27' }])
  })

  it('stops the chain at an unresolvable row', () => {
    const rows = [newPhaseRow({}), newPhaseRow({ durationCount: '' }), newPhaseRow({})]
    expect(phaseRowRanges('2026-11-14', rows)).toEqual([{ start: '2026-11-14', end: '2026-12-13' }, null, null])
    expect(phaseRowRanges('', rows)).toEqual([null, null, null])
  })
})

describe('row helpers', () => {
  it('moves rows and ignores out-of-range moves', () => {
    expect(movePhaseRow(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(movePhaseRow(['a', 'b', 'c'], 2, 3)).toEqual(['a', 'b', 'c'])
  })

  it('caps the schedule at 12 phases', () => {
    expect(canAddPhase(new Array(11).fill(0))).toBe(true)
    expect(canAddPhase(new Array(12).fill(0))).toBe(false)
  })

  it('compares schedules by payload, not by row keys', () => {
    expect(samePhasePayload([newPhaseRow({})], [newPhaseRow({})])).toBe(true)
    expect(samePhasePayload([newPhaseRow({})], [newPhaseRow({ name: 'x' })])).toBe(false)
  })
})
