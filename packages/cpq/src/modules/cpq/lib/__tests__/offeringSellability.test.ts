import { nonSellableTopLevelMessage, violatesSellability } from '../offeringSellability'

describe('violatesSellability (#133)', () => {
  const componentOnly = { isSellable: false }

  it('flags a top-level line for a component-only offering', () => {
    expect(violatesSellability(componentOnly, {})).toBe(true)
    expect(violatesSellability(componentOnly, { parentLineId: null, configuration: {} })).toBe(true)
  })

  it('allows sellable offerings and lines without an offering', () => {
    expect(violatesSellability({ isSellable: true }, {})).toBe(false)
    expect(violatesSellability(null, {})).toBe(false)
  })

  it('allows a child line under a bundle', () => {
    expect(violatesSellability(componentOnly, { parentLineId: 'bundle-line' })).toBe(false)
  })

  it('allows lines bound to a subscription item or mirrored by the server', () => {
    expect(violatesSellability(componentOnly, { sourceSubscriptionItemId: 'item-1' })).toBe(false)
    expect(violatesSellability(componentOnly, { configuration: { _arcMirroredFromItemId: 'item-1' } })).toBe(false)
    expect(violatesSellability(componentOnly, { configuration: { _arcMirroredFromAssetId: 'asset-1' } })).toBe(false)
  })

  it('does not trust caller-set fields: a modify or cancel action alone does not exempt a line', () => {
    const callerLine = { action: 'modify', configuration: { bandwidth: '1G' } }
    expect(violatesSellability(componentOnly, callerLine)).toBe(true)
  })

  it('builds the V-QLINE-1 message', () => {
    expect(nonSellableTopLevelMessage('ONT')).toBe('V-QLINE-1: Offering ONT can only be sold as part of a bundle')
  })
})
