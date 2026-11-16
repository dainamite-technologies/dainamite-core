import { assertItemDates, endsBeforeStart } from '../../lib/itemDates'

describe('item dates', () => {
  it('allows open-ended, one-day and cancelled-before-start (end = start − 1) items', () => {
    expect(endsBeforeStart('2026-11-20', null)).toBe(false)
    expect(endsBeforeStart('2026-11-20', '2026-11-20')).toBe(false)
    expect(endsBeforeStart('2026-11-20', '2026-11-19')).toBe(false)
  })

  it('rejects an end more than one day before the start', () => {
    expect(endsBeforeStart('2026-11-20', '2026-11-14')).toBe(true)
    expect(() => assertItemDates('2026-11-20', '2026-11-18')).toThrow(
      expect.objectContaining({ status: 422, body: expect.objectContaining({ code: 'billing.item.end_before_start' }) }),
    )
  })
})
