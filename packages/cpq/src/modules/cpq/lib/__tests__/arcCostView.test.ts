import { arcCostsOfLine, arcDiffCostRows, costLineEntry, orderArcCostsOfLine } from '../arcCostView'

const costs = { before: { mrcCost: 270, nrcCost: 10 }, after: { mrcCost: 240, nrcCost: 10 } }

describe('arcDiffCostRows', () => {
  it('returns null (rows hidden) without costs', () => {
    expect(arcDiffCostRows(undefined, { beforeMrc: 500, afterMrc: 400 })).toBeNull()
    expect(arcDiffCostRows(null, { beforeMrc: 500, afterMrc: 400 })).toBeNull()
  })
  it('derives the MRC margin from the line price and the MRC cost', () => {
    expect(arcDiffCostRows(costs, { beforeMrc: 500, afterMrc: 400 })).toEqual([
      { key: 'mrcCost', before: 270, after: 240 },
      { key: 'mrcMargin', before: 230, after: 160 },
      { key: 'nrcCost', before: 10, after: 10 },
    ])
  })
  it('rounds the margin to four decimals', () => {
    const rows = arcDiffCostRows({ before: { mrcCost: 0.1, nrcCost: 0 }, after: { mrcCost: 0.2, nrcCost: 0 } }, { beforeMrc: 0.3, afterMrc: 0.3 })
    expect(rows?.[1]).toEqual({ key: 'mrcMargin', before: 0.2, after: 0.1 })
  })
})

describe('line lookups', () => {
  const data = { pricingRevision: 1, lines: [{ quoteLineId: 'l1', costs: [], arcCosts: costs }, { quoteLineId: 'l2', costs: [] }] }
  it('finds arcCosts on a quote line and is undefined for a line without them (or without a read)', () => {
    expect(arcCostsOfLine(data, 'l1')).toBe(costs)
    expect(arcCostsOfLine(data, 'l2')).toBeUndefined()
    expect(arcCostsOfLine(null, 'l1')).toBeUndefined()
    expect(costLineEntry(data, 'l2')?.quoteLineId).toBe('l2')
  })
  it('finds arcCosts on an order line', () => {
    expect(orderArcCostsOfLine({ orderId: 'o', lines: [{ orderLineId: 'ol', costs: [], arcCosts: costs }] }, 'ol')).toBe(costs)
    expect(orderArcCostsOfLine({ orderId: 'o', lines: [] }, 'ol')).toBeUndefined()
  })
})
