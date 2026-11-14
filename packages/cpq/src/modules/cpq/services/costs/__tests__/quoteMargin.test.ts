import { computeQuoteMargin, priceBasisCostFlags, type MarginCost, type MarginLine } from '../quoteMargin'

const TODAY = '2026-11-13'
const line = (lineId: string, over: Partial<MarginLine> = {}, mrc = 100, nrc = 0): MarginLine => ({
  lineId, quantity: 1, termMonths: 12, parentLineId: null,
  charges: [
    { chargeCode: 'mrc', chargeType: 'mrc', totalPrice: mrc },
    ...(nrc ? [{ chargeCode: 'nrc', chargeType: 'nrc', totalPrice: nrc }] : []),
  ], ...over,
})
const cost = (quoteLineId: string, over: Partial<MarginCost> = {}): MarginCost => ({
  quoteLineId, chargeCode: 'mrc', costKey: `k-${quoteLineId}`, role: 'price_basis', costType: 'mrc',
  valueStatus: 'confirmed', instanceAmount: '60', currencyCode: 'EUR', ...over,
})
const margin = (lines: MarginLine[], costs: MarginCost[]) => computeQuoteMargin({ currencyCode: 'EUR', lines, costs, today: TODAY })

describe('computeQuoteMargin', () => {
  it('computes per charge, line and quote figures over the contract horizon', () => {
    const result = margin([line('l1', { quantity: 2 }, 100, 500)], [cost('l1', { instanceAmount: '60' }), cost('l1', { chargeCode: 'nrc', costKey: 'n', costType: 'nrc', instanceAmount: '200' })])
    const mrc = result.lines[0].charges.find((charge) => charge.chargeCode === 'mrc')!
    expect(mrc).toMatchObject({ mrcCost: 120, mrcOffer: 200, mrcMargin: 80, contractCost: 1440, contractOffer: 2400, contractMargin: 960, marginPercent: 40, markupPercent: 66.6667, costCoverage: 100 })
    expect(result).toMatchObject({ nrcCost: 400, nrcOffer: 1000, nrcMargin: 600, mrcCost: 120, mrcOffer: 200 })
    // contract: NRC once + MRC x 12
    expect(result).toMatchObject({ contractOffer: 1000 + 2400, contractCost: 400 + 1440, contractMargin: 1560 })
  })

  it('uses the line term as the MRC horizon and excludes non-deal lines from contract figures', () => {
    const result = margin([line('l1', { termMonths: 36 }), line('mirror', { includeInDeal: false })], [cost('l1'), cost('mirror')])
    expect(result.contractOffer).toBe(3600)
    expect(result.contractCost).toBe(2160)
    expect(result.mrcOffer).toBe(200)
  })

  it('is null-safe: no offer and no cost give null percentages', () => {
    const result = margin([line('l1', {}, 0)], [])
    expect(result).toMatchObject({ marginPercent: null, markupPercent: null, costCoverage: 0 })
  })

  it('coverage is weighted by offer value: two equal lines, one with costs, give 50% and the other counts as cost 0', () => {
    const result = margin([line('l1'), line('l2')], [cost('l1')])
    expect(result.costCoverage).toBe(50)
    expect(result.contractCost).toBe(720)
    expect(result.contractMargin).toBe(2400 - 720)
    expect(result.lines.map((entry) => entry.own.costCoverage)).toEqual([100, 0])
  })

  it('a charge with an unknown cost is not covered and flags pending; the unknown cost counts as 0', () => {
    const result = margin([line('l1')], [cost('l1'), cost('l1', { costKey: 'k2', valueStatus: 'none', instanceAmount: null })])
    expect(result).toMatchObject({ costCoverage: 0, hasPendingCosts: true, mrcCost: 60 })
  })

  it('flags estimated and expired costs (valid_until before today)', () => {
    expect(margin([line('l1')], [cost('l1', { valueStatus: 'estimated' })])).toMatchObject({ hasEstimatedCosts: true, hasExpiredCosts: false, hasPendingCosts: false })
    expect(margin([line('l1')], [cost('l1', { validUntil: '2026-11-12' })])).toMatchObject({ hasExpiredCosts: true })
    expect(margin([line('l1')], [cost('l1', { validUntil: TODAY })])).toMatchObject({ hasExpiredCosts: false })
  })

  it('counts line-level margin_only costs on the line, not on a charge', () => {
    const result = margin([line('l1')], [cost('l1'), cost('l1', { chargeCode: null, costKey: 'build', role: 'margin_only', costType: 'nrc', instanceAmount: '1500' })])
    expect(result.lines[0].own).toMatchObject({ nrcCost: 1500, mrcCost: 60 })
    expect(result.lines[0].charges.find((charge) => charge.chargeCode === 'mrc')).toMatchObject({ nrcCost: 0, mrcCost: 60 })
    expect(result.nrcCost).toBe(1500)
  })

  it('rolls bundle descendants up into the parent (own + children + grandchildren)', () => {
    const lines = [line('parent', {}, 0), line('child', { parentLineId: 'parent' }, 100), line('grand', { parentLineId: 'child' }, 50), line('other', {}, 10)]
    const result = margin(lines, [cost('child'), cost('grand', { instanceAmount: '20' })])
    const byId = Object.fromEntries(result.lines.map((entry) => [entry.lineId, entry]))
    expect(byId.parent.own).toMatchObject({ mrcOffer: 0, mrcCost: 0 })
    expect(byId.parent.rollup).toMatchObject({ mrcOffer: 150, mrcCost: 80, mrcMargin: 70 })
    expect(byId.child.rollup).toMatchObject({ mrcOffer: 150, mrcCost: 80 })
    expect(byId.grand.rollup).toMatchObject({ mrcOffer: 50, mrcCost: 20 })
    expect(byId.other.rollup.mrcOffer).toBe(10)
    expect(result.mrcOffer).toBe(160)
  })

  it('survives a parent cycle', () => {
    const result = margin([line('a', { parentLineId: 'b' }), line('b', { parentLineId: 'a' })], [])
    expect(result.lines[0].rollup.mrcOffer).toBe(200)
  })

  it('excludes usage charges from offers', () => {
    const result = margin([{ lineId: 'l1', quantity: 1, charges: [{ chargeCode: 'u', chargeType: 'usage', totalPrice: null }, { chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 10 }] }], [])
    expect(result.mrcOffer).toBe(10)
  })
})

describe('marginHash', () => {
  const base = () => margin([line('l1')], [cost('l1'), cost('l1', { costKey: 'k2', instanceAmount: '5', valueStatus: 'estimated' })])

  it('is stable across a status-only change (estimated to confirmed, same value)', () => {
    const changed = margin([line('l1')], [cost('l1'), cost('l1', { costKey: 'k2', instanceAmount: '5.0000', valueStatus: 'confirmed' })])
    expect(changed.marginHash).toBe(base().marginHash)
  })

  it('is independent of input order', () => {
    const reversed = margin([line('l1')], [cost('l1', { costKey: 'k2', instanceAmount: '5', valueStatus: 'estimated' }), cost('l1')])
    expect(reversed.marginHash).toBe(base().marginHash)
  })

  it('changes when a cost value changes', () => {
    expect(margin([line('l1')], [cost('l1', { instanceAmount: '61' }), cost('l1', { costKey: 'k2', instanceAmount: '5' })]).marginHash).not.toBe(base().marginHash)
  })

  it('changes when an offer changes', () => {
    expect(margin([line('l1', {}, 101)], [cost('l1'), cost('l1', { costKey: 'k2', instanceAmount: '5' })]).marginHash).not.toBe(base().marginHash)
  })

  it('changes when a markup override is added or changed', () => {
    const lines = [line('l1')]
    const costs = [cost('l1')]
    const hash = (value: number | null) => computeQuoteMargin({ currencyCode: 'EUR', lines, costs, today: TODAY,
      markups: value === null ? [] : [{ quoteLineId: 'l1', chargeCode: 'mrc', markupRule: 'markup_percent', markupValue: value }] }).marginHash
    expect(hash(25)).not.toBe(hash(null))
    expect(hash(25)).not.toBe(hash(30))
    expect(hash(25)).toBe(hash(25))
  })

  it('changes when a line term changes (contract margin depends on it); an unset term hashes as its 12-month horizon', () => {
    const costs = [cost('l1'), cost('l1', { costKey: 'k2', instanceAmount: '5', valueStatus: 'estimated' })]
    const term = (termMonths: number | null) => margin([line('l1', { termMonths })], costs)
    expect(term(36).marginHash).not.toBe(term(12).marginHash)
    expect(term(36).contractMargin).not.toBe(term(12).contractMargin)
    expect(term(null).marginHash).toBe(term(12).marginHash)
  })
})

describe('priceBasisCostFlags (status_changed, indicative semantics)', () => {
  it('ignores margin-only costs: a margin-only estimate leaves the price final', () => {
    const marginOnly = [cost('l1'), cost('l1', { costKey: 'noc', chargeCode: null, role: 'margin_only', valueStatus: 'estimated' }),
      cost('l1', { costKey: 'x', chargeCode: null, role: 'margin_only', valueStatus: 'none', instanceAmount: null })]
    expect(priceBasisCostFlags(marginOnly)).toEqual({ hasPendingCosts: false, hasEstimatedCosts: false })
    // ...while the margin flags still report them
    expect(margin([line('l1')], marginOnly)).toMatchObject({ hasPendingCosts: true, hasEstimatedCosts: true })
  })

  it('flags an estimated or pending price-basis cost', () => {
    expect(priceBasisCostFlags([cost('l1', { valueStatus: 'estimated' })])).toEqual({ hasPendingCosts: false, hasEstimatedCosts: true })
    expect(priceBasisCostFlags([cost('l1', { valueStatus: 'none', instanceAmount: null })])).toEqual({ hasPendingCosts: true, hasEstimatedCosts: false })
    expect(priceBasisCostFlags([])).toEqual({ hasPendingCosts: false, hasEstimatedCosts: false })
  })
})
