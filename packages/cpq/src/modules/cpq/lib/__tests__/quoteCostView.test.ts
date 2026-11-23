import {
  formatPercent,
  isCostLocked,
  isQuoteIndicative,
  isUnpricedCostPlus,
  lineCostBadges,
  unpricedChargeLabel,
} from '../quoteCostView'

const cost = (patch: Partial<{ role: string; valueStatus: string; expired: boolean }> = {}) => ({ role: 'price_basis', valueStatus: 'confirmed', expired: false, ...patch })

describe('lineCostBadges', () => {
  it('is empty for confirmed, current costs', () => {
    expect(lineCostBadges([cost()])).toEqual([])
    expect(lineCostBadges([])).toEqual([])
  })
  it('derives pending, estimated and expired in a stable order', () => {
    expect(lineCostBadges([cost({ valueStatus: 'none' })])).toEqual(['pending'])
    expect(lineCostBadges([cost({ valueStatus: 'estimated' })])).toEqual(['estimated'])
    expect(lineCostBadges([cost({ expired: true }), cost({ valueStatus: 'estimated' }), cost({ valueStatus: 'none' })])).toEqual(['pending', 'estimated', 'expired'])
  })
})

describe('isQuoteIndicative', () => {
  it('is true only when a price-basis cost is estimated', () => {
    expect(isQuoteIndicative([{ costs: [cost({ valueStatus: 'estimated' })] }])).toBe(true)
    expect(isQuoteIndicative([{ costs: [cost({ valueStatus: 'estimated', role: 'margin_only' })] }])).toBe(false)
    expect(isQuoteIndicative([{ costs: [cost({ valueStatus: 'none' })] }])).toBe(false)
    expect(isQuoteIndicative([])).toBe(false)
  })
})

describe('isCostLocked', () => {
  it('locks outside new / incomplete / ready and once converted', () => {
    for (const status of ['new', 'incomplete', 'ready']) expect(isCostLocked(status)).toBe(false)
    for (const status of ['in_approval', 'approved', 'with_customer', 'accepted', 'cancelled']) expect(isCostLocked(status)).toBe(true)
    expect(isCostLocked('ready', 'order-1')).toBe(true)
  })
})

describe('unpriced cost-plus charges', () => {
  it('recognises them by method and a null price', () => {
    expect(isUnpricedCostPlus({ pricingMethod: 'cost_plus', unitPrice: null })).toBe(true)
    expect(isUnpricedCostPlus({ pricingMethod: 'cost_plus', unitPrice: 0 })).toBe(false)
    expect(isUnpricedCostPlus({ pricingMethod: 'flat', unitPrice: null })).toBe(false)
  })
  it('shows the fallback as approximate, else "on request"', () => {
    expect(unpricedChargeLabel({ fallbackPrice: 120 })).toEqual({ kind: 'approx', amount: 120 })
    expect(unpricedChargeLabel({ fallbackPrice: null })).toEqual({ kind: 'on_request' })
    expect(unpricedChargeLabel({})).toEqual({ kind: 'on_request' })
  })
})

describe('formatPercent', () => {
  it('formats percent numbers and dashes out null', () => {
    expect(formatPercent(42.5)).toBe('42.5%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(null)).toBe('—')
  })
})
