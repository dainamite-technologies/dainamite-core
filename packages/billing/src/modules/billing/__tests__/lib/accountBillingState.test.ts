import { accountBillingState, accountBillingTone } from '../../lib/accountBillingState'

const TODAY = '2026-11-16'
const account = (overrides: Record<string, unknown> = {}) => ({
  is_active: true,
  next_bill_date: '2026-12-15',
  last_bill_date: '2026-11-14',
  ...overrides,
})

describe('accountBillingState', () => {
  it('inactive short-circuits everything', () => {
    expect(accountBillingState(account({ is_active: false, next_bill_date: '2026-01-01' }), TODAY)).toEqual({
      status: 'inactive',
      date: null,
    })
  })

  it('billed through the last bill date while the next bill is ahead', () => {
    const state = accountBillingState(account(), TODAY)
    expect(state).toEqual({ status: 'current', date: '2026-11-14' })
    expect(accountBillingTone(state)).toBe('success')
  })

  it('due from the next bill date once it is today or past', () => {
    expect(accountBillingState(account({ next_bill_date: TODAY }), TODAY)).toEqual({ status: 'due', date: TODAY })
    const late = accountBillingState(account({ next_bill_date: '2026-11-01' }), TODAY)
    expect(late).toEqual({ status: 'due', date: '2026-11-01' })
    expect(accountBillingTone(late)).toBe('warning')
  })

  it('a never-billed account is "not billed" until its first bill date passes', () => {
    expect(accountBillingState(account({ last_bill_date: null }), TODAY)).toEqual({ status: 'not_billed', date: null })
    expect(accountBillingState(account({ last_bill_date: null, next_bill_date: '2026-11-10' }), TODAY).status).toBe('due')
  })

  it('accepts timestamp-shaped dates', () => {
    expect(accountBillingState(account({ last_bill_date: '2026-11-14T00:00:00.000Z' }), TODAY).date).toBe('2026-11-14')
  })
})
