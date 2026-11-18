import { billCyclePayload, parseCycleInterval } from '../../lib/billCyclePayload'

const base = {
  billCycle: 'monthly' as const,
  billCycleInterval: '1',
  billCycleDay: '15',
  nextBillDateOverride: false,
  nextBillDate: '2026-12-20',
}

describe('billCyclePayload', () => {
  it('omits nextBillDate unless the operator set it by hand', () => {
    expect(billCyclePayload(base)).toEqual({ billCycle: 'monthly', billCycleInterval: 1, billCycleDay: '15' })
    expect(billCyclePayload({ ...base, nextBillDateOverride: true })).toMatchObject({ nextBillDate: '2026-12-20' })
    expect(billCyclePayload({ ...base, nextBillDateOverride: true, nextBillDate: '' })).not.toHaveProperty('nextBillDate')
  })

  it('sends no day for daily cycles', () => {
    expect(billCyclePayload({ ...base, billCycle: 'daily', billCycleInterval: '30' })).toEqual({
      billCycle: 'daily',
      billCycleInterval: 30,
      billCycleDay: null,
    })
  })

  it('parses the interval strictly', () => {
    expect(parseCycleInterval(' 30 ')).toBe(30)
    expect(parseCycleInterval('0')).toBeNull()
    expect(parseCycleInterval('1.5')).toBeNull()
    expect(parseCycleInterval('')).toBeNull()
  })
})
