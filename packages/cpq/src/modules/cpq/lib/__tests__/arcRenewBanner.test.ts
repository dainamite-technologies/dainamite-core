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
