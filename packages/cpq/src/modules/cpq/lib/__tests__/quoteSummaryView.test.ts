import { arcRecurringDelta, chargeTypeDepths, formatChangePct } from '../quoteSummaryView'

describe('chargeTypeDepths', () => {
  it('computes list → offer depth per charge type', () => {
    const depths = chargeTypeDepths({ nrcTotal: 80, mrcTotal: 90, listNrcTotal: 100, listMrcTotal: 100 })
    expect(depths.nrc).toBeCloseTo(0.2)
    expect(depths.mrc).toBeCloseTo(0.1)
  })

  it('returns null for legacy snapshots and zero list', () => {
    expect(chargeTypeDepths({ nrcTotal: 80, mrcTotal: 90 })).toEqual({ nrc: null, mrc: null })
    expect(chargeTypeDepths({ nrcTotal: 0, mrcTotal: 0, listNrcTotal: 0, listMrcTotal: 0 })).toEqual({ nrc: null, mrc: null })
  })
})

describe('arcRecurringDelta', () => {
  it('compares mirrored items against surviving lines', () => {
    const result = arcRecurringDelta([
      { action: 'modify', mrcTotal: 120, arcSource: { mrcAmount: 100 } }, // re-rated
      { action: 'cancel', mrcTotal: 50, arcSource: { mrcAmount: 50 } }, // removed
      { action: 'add', mrcTotal: 30, arcSource: null }, // new
    ])
    expect(result).toEqual({ currentMrc: 150, newMrc: 150, delta: 0, deltaPct: 0 })
  })

  it('reports a signed change and percentage', () => {
    const result = arcRecurringDelta([
      { action: 'modify', mrcTotal: 100, arcSource: { mrcAmount: 100 } },
      { action: 'add', mrcTotal: 25, arcSource: null },
    ])
    expect(result.delta).toBe(25)
    expect(result.deltaPct).toBeCloseTo(0.25)
  })

  it('has no percentage when there is no current recurring value', () => {
    expect(arcRecurringDelta([{ action: 'add', mrcTotal: 10, arcSource: null }]).deltaPct).toBeNull()
  })

  it('replacing an item: the removed item counts as current, only the new one as new', () => {
    // Amend: existing $400 port removed (cancel line, zero totals) and a $1,130 port added.
    const result = arcRecurringDelta([
      { action: 'cancel', mrcTotal: 0, arcSource: { mrcAmount: 400 } },
      { action: 'add', mrcTotal: 1130, arcSource: null },
    ])
    expect(result).toEqual({ currentMrc: 400, newMrc: 1130, delta: 730, deltaPct: 1.825 })
  })
})

describe('formatChangePct', () => {
  it('formats signed changes and hides ~0', () => {
    expect(formatChangePct(0.25)).toBe('+25%')
    expect(formatChangePct(-0.125)).toBe('−12.5%')
    expect(formatChangePct(0)).toBeNull()
    expect(formatChangePct(null)).toBeNull()
  })
})
