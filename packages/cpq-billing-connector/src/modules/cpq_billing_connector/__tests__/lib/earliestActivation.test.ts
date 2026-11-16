import {
  activationHintDate,
  computeEarliestActivation,
  isActivationBlocked,
  isActivationConstrained,
} from '../../lib/earliestActivation'

const item = (overrides: Record<string, unknown> = {}) => ({
  subscriptionId: 'sub-1',
  description: 'Fiber 300',
  billStartDate: '2026-10-01',
  billEndDate: null,
  isActive: true,
  ...overrides,
})

describe('computeEarliestActivation', () => {
  it('returns the latest bill start among active items for amend and cancel', () => {
    const items = [
      item(),
      item({ subscriptionId: 'sub-2', description: 'Static IP', billStartDate: '2026-11-20' }),
      item({ description: 'Router', billStartDate: new Date('2026-11-05T00:00:00Z') }),
    ]
    const expected = { date: '2026-11-20', subscriptionId: 'sub-2', itemDescription: 'Static IP' }
    expect(computeEarliestActivation('amend', items)).toEqual(expected)
    expect(computeEarliestActivation('cancel', items)).toEqual(expected)
  })

  it('returns null for renewals and new business', () => {
    const items = [item({ billStartDate: '2027-01-01' })]
    expect(computeEarliestActivation('renew', items)).toBeNull()
    expect(computeEarliestActivation('new', items)).toBeNull()
    expect(isActivationConstrained('renew')).toBe(false)
  })

  it('ignores inactive items and items ended before they start', () => {
    const items = [
      item(),
      item({ description: 'Inactive', billStartDate: '2026-12-01', isActive: false }),
      item({ description: 'Cancelled before start', billStartDate: '2026-12-01', billEndDate: '2026-11-30' }),
    ]
    expect(computeEarliestActivation('amend', items)?.date).toBe('2026-10-01')
  })

  it('keeps an item that ends after it starts', () => {
    const items = [item({ billStartDate: '2026-12-01', billEndDate: '2027-11-30' })]
    expect(computeEarliestActivation('cancel', items)?.date).toBe('2026-12-01')
  })

  it('returns null when there are no usable items', () => {
    expect(computeEarliestActivation('amend', [])).toBeNull()
    expect(computeEarliestActivation('amend', [item({ subscriptionId: null })])).toBeNull()
  })
})

describe('isActivationBlocked', () => {
  const earliest = { date: '2026-11-20', subscriptionId: 'sub-1', itemDescription: 'Fiber' }

  it('blocks before the date and allows on or after it', () => {
    expect(isActivationBlocked(earliest, '2026-11-19')).toBe(true)
    expect(isActivationBlocked(earliest, '2026-11-20')).toBe(false)
    expect(isActivationBlocked(earliest, '2026-11-21')).toBe(false)
  })

  it('never blocks without a constraint', () => {
    expect(isActivationBlocked(null, '2026-01-01')).toBe(false)
  })
})

describe('activationHintDate', () => {
  it('shows the date only while it is in the future and the order can be activated', () => {
    const view = { orderStatus: 'pending_activation', earliestActivationDate: '2026-11-20' }
    expect(activationHintDate(view, '2026-11-16')).toBe('2026-11-20')
    expect(activationHintDate(view, '2026-11-20')).toBeNull()
    expect(activationHintDate({ ...view, orderStatus: 'active' }, '2026-11-16')).toBeNull()
    expect(activationHintDate({ ...view, earliestActivationDate: null }, '2026-11-16')).toBeNull()
  })
})
