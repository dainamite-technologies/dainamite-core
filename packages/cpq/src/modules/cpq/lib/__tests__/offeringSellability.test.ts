import { nonSellableTopLevelMessage, violatesSellability } from '../offeringSellability'

describe('violatesSellability (#133)', () => {
  const componentOnly = { isSellable: false }

  it('flags a new top-level line for a component-only offering', () => {
    expect(violatesSellability(componentOnly, {})).toBe(true)
    expect(violatesSellability(componentOnly, { action: 'add', parentLineId: null })).toBe(true)
  })

  it('allows sellable offerings and lines without an offering', () => {
    expect(violatesSellability({ isSellable: true }, {})).toBe(false)
    expect(violatesSellability(null, {})).toBe(false)
  })

  it('allows a child line under a bundle', () => {
    expect(violatesSellability(componentOnly, { parentLineId: 'bundle-line' })).toBe(false)
  })

  it('allows lines acting on an existing subscription item', () => {
    expect(violatesSellability(componentOnly, { action: 'modify' })).toBe(false)
    expect(violatesSellability(componentOnly, { action: 'cancel' })).toBe(false)
    expect(violatesSellability(componentOnly, { action: 'add', sourceSubscriptionItemId: 'item-1' })).toBe(false)
  })

  it('builds the V-QLINE-1 message', () => {
    expect(nonSellableTopLevelMessage('ONT')).toBe('V-QLINE-1: Offering ONT can only be sold as part of a bundle')
  })
})
