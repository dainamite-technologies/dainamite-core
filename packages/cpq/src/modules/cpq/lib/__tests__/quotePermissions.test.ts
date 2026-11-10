import { canRecalculateQuote, TERMINAL_QUOTE_STATUSES } from '../quotePermissions'
import { TERMINAL_STATUSES } from '../../services/types'

describe('TERMINAL_QUOTE_STATUSES', () => {
  it('mirrors the service-layer TERMINAL_STATUSES', () => {
    expect([...TERMINAL_QUOTE_STATUSES].sort()).toEqual([...TERMINAL_STATUSES].sort())
  })
})

describe('canRecalculateQuote', () => {
  it('allows a user with cpq.quotes.manage on a non-terminal quote', () => {
    expect(canRecalculateQuote(['cpq.quotes.manage'], 'ready')).toBe(true)
  })

  it('honours wildcard grants', () => {
    expect(canRecalculateQuote(['cpq.*'], 'incomplete')).toBe(true)
  })

  it('denies a view-only user', () => {
    expect(canRecalculateQuote(['cpq.quotes.view'], 'ready')).toBe(false)
  })

  it('denies before the feature check has loaded (no granted features)', () => {
    expect(canRecalculateQuote([], 'ready')).toBe(false)
  })

  it.each(['accepted', 'rejected', 'cancelled'])('denies on a %s (terminal) quote', (status) => {
    expect(canRecalculateQuote(['cpq.quotes.manage'], status)).toBe(false)
  })
})
