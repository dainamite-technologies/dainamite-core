import { spreadAmount } from '../priceAdjustments/spreadAmount'

const cents = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) * 100)

describe('spreadAmount', () => {
  it('spreads in proportion to the weights', () => {
    expect(spreadAmount(50, [60, 30, 10])).toEqual([30, 15, 5])
  })
  it('gives the rounding remainder to the largest weight and always adds up to the amount', () => {
    expect(spreadAmount(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33])
    expect(spreadAmount(10, [1, 2, 1])).toEqual([2.5, 5, 2.5])
    const shares = spreadAmount(99.99, [7, 13, 29, 51])
    expect(cents(shares)).toBe(9999)
    expect(shares[3]).toBeGreaterThanOrEqual((99.99 * 51) / 100 - 0.01)
  })
  it('puts everything on the first charge when every weight is zero', () => {
    expect(spreadAmount(40, [0, 0, 0])).toEqual([40, 0, 0])
    expect(spreadAmount(40, [0, -5, Number.NaN])).toEqual([40, 0, 0])
  })
  it('never goes below zero and handles empty input', () => {
    expect(spreadAmount(-10, [1, 1])).toEqual([0, 0])
    expect(spreadAmount(Number.NaN, [1])).toEqual([0])
    expect(spreadAmount(10, [])).toEqual([])
  })
  it('rounds the amount itself to the cent', () => {
    expect(cents(spreadAmount(10.005, [1, 3]))).toBe(1001)
  })
  it('ignores zero weights when others are positive', () => {
    expect(spreadAmount(30, [0, 10, 20])).toEqual([0, 10, 20])
  })
})
