import {
  computeBalanceStatus,
  detectBalanceCrossing,
  resolveLowBalanceThreshold,
} from '../../lib/balanceStatus'

describe('balanceStatus — classification', () => {
  it('classifies ok / low / exhausted', () => {
    expect(computeBalanceStatus('100.0000', '10.0000')).toBe('ok')
    expect(computeBalanceStatus('10.0000', '10.0000')).toBe('low') // boundary is low
    expect(computeBalanceStatus('5.0000', '10.0000')).toBe('low')
    expect(computeBalanceStatus('0.0000', '10.0000')).toBe('exhausted')
    expect(computeBalanceStatus('-3.0000', '10.0000')).toBe('exhausted')
  })

  it('threshold 0 disables the low band (only ok / exhausted)', () => {
    expect(computeBalanceStatus('0.0001', '0')).toBe('ok')
    expect(computeBalanceStatus('0', '0')).toBe('exhausted')
  })

  it('resolves threshold: account row → config default → 0', () => {
    expect(resolveLowBalanceThreshold('25.0000', '10')).toBe('25.0000')
    expect(resolveLowBalanceThreshold(null, '10')).toBe('10')
    expect(resolveLowBalanceThreshold(null, null)).toBe('0')
    expect(resolveLowBalanceThreshold(undefined, undefined)).toBe('0')
  })
})

describe('balanceStatus — downward crossings (events fire once)', () => {
  it('fires exhausted only when crossing from > 0 to <= 0', () => {
    expect(detectBalanceCrossing('5.0000', '-3.0000', '10.0000')).toEqual({
      lowCrossedDown: false,
      exhaustedCrossedDown: true,
    })
    // Already negative — pushing further does NOT re-fire (no spam).
    expect(detectBalanceCrossing('-3.0000', '-8.0000', '10.0000')).toEqual({
      lowCrossedDown: false,
      exhaustedCrossedDown: false,
    })
  })

  it('fires low only when landing in the (0, threshold] band', () => {
    expect(detectBalanceCrossing('100.0000', '8.0000', '10.0000')).toEqual({
      lowCrossedDown: true,
      exhaustedCrossedDown: false,
    })
    // Jumped past low straight to exhausted → only exhausted fires.
    expect(detectBalanceCrossing('100.0000', '-1.0000', '10.0000')).toEqual({
      lowCrossedDown: false,
      exhaustedCrossedDown: true,
    })
    // Already low, dropping further within the band → no re-fire.
    expect(detectBalanceCrossing('8.0000', '4.0000', '10.0000')).toEqual({
      lowCrossedDown: false,
      exhaustedCrossedDown: false,
    })
  })

  it('does not fire low when threshold is 0', () => {
    expect(detectBalanceCrossing('100.0000', '1.0000', '0')).toEqual({
      lowCrossedDown: false,
      exhaustedCrossedDown: false,
    })
  })
})
