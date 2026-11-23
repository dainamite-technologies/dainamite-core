import { isFrozenCostPlusRenewLine, shouldShowRenewCostBanner } from '../arcRenewBanner'

const frozen = { configuration: { _arcPriceFrozen: true, _arcCostPlusFrozen: true } }

describe('Renew cost banner', () => {
  it('shows on a Renew quote with a frozen cost-plus line', () => {
    expect(shouldShowRenewCostBanner('renew', [{ configuration: {} }, frozen])).toBe(true)
  })
  it('hides on other quote types', () => {
    expect(shouldShowRenewCostBanner('amend', [frozen])).toBe(false)
    expect(shouldShowRenewCostBanner(null, [frozen])).toBe(false)
  })
  it('hides once the line is un-frozen (reconfigured) or is a plain frozen line', () => {
    expect(shouldShowRenewCostBanner('renew', [{ configuration: { _arcCostPlusFrozen: true, _arcReconfigured: true } }])).toBe(false)
    expect(shouldShowRenewCostBanner('renew', [{ configuration: { _arcPriceFrozen: true } }])).toBe(false)
  })
  it('ignores cancel lines', () => {
    expect(isFrozenCostPlusRenewLine({ action: 'cancel', ...frozen })).toBe(false)
  })
})

describe('Renew cost banner: Phase 1 lines only (ARC costs Q6)', () => {
  it('keeps the banner for a Phase 1 standalone line and drops it for a merge line', () => {
    expect(shouldShowRenewCostBanner('renew', [{ ...frozen, targetSubscriptionId: 'sub-1' }])).toBe(true)
    expect(shouldShowRenewCostBanner('renew', [{ ...frozen, targetSubscriptionId: null }])).toBe(false)
  })
  it('shows nothing for a new standalone Renew (carried, not frozen)', () => {
    expect(shouldShowRenewCostBanner('renew', [{ targetSubscriptionId: 'sub-1', configuration: { _arcMirroredFromItemId: 'i', _arcCostsCarried: true } }])).toBe(false)
  })
})
