import { itemBillingState } from '../../lib/itemBillingState'

const TODAY = '2026-11-15'
const recurring = (overrides: Record<string, unknown> = {}) => ({
  type: 'recurring' as const,
  is_active: true,
  bill_start_date: '2026-11-01',
  bill_end_date: null,
  billed_to_date: null,
  ...overrides,
})

describe('itemBillingState', () => {
  it('inactive and usage items short-circuit', () => {
    expect(itemBillingState(recurring({ is_active: false }), TODAY).status).toBe('inactive')
    expect(itemBillingState(recurring({ type: 'usage' }), TODAY).status).toBe('metered')
  })

  it('not billed yet: scheduled when it starts later, awaiting a run once started', () => {
    expect(itemBillingState(recurring({ bill_start_date: '2026-12-01' }), TODAY)).toEqual({ status: 'scheduled', date: '2026-12-01' })
    expect(itemBillingState(recurring(), TODAY)).toEqual({ status: 'awaiting_run', date: null })
  })

  it('recurring charged ahead is current; charged through a past day is due from the next day', () => {
    expect(itemBillingState(recurring({ billed_to_date: '2026-12-14' }), TODAY)).toEqual({ status: 'current', date: '2026-12-14' })
    expect(itemBillingState(recurring({ billed_to_date: '2026-11-15' }), TODAY).status).toBe('current')
    expect(itemBillingState(recurring({ billed_to_date: '2026-10-31' }), TODAY)).toEqual({ status: 'due', date: '2026-11-01' })
  })

  it('recurring charged through its end date is fully billed', () => {
    expect(
      itemBillingState(recurring({ bill_end_date: '2026-11-30', billed_to_date: '2026-11-30T00:00:00.000Z' }), TODAY),
    ).toEqual({ status: 'fully_billed', date: '2026-11-30' })
  })

  it('one-time: billed once a run charged it', () => {
    const fee = { ...recurring(), type: 'one_time' as const }
    expect(itemBillingState({ ...fee, billed_to_date: '2026-11-30' }, TODAY).status).toBe('billed')
    expect(itemBillingState(fee, TODAY).status).toBe('awaiting_run')
    expect(itemBillingState({ ...fee, bill_start_date: '2027-01-01' }, TODAY).status).toBe('scheduled')
  })
})
