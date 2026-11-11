import { summarizeOrderPricing } from '../orderPricingSummary'

const charge = (chargeType: 'nrc' | 'mrc', list: number, offer: number, standard = offer) => ({
  chargeCode: `${chargeType}-fee`,
  chargeName: `${chargeType} fee`,
  chargeType,
  pricingMethod: 'flat',
  unitPrice: offer,
  quantity: 1,
  totalPrice: offer,
  listUnitPrice: list,
  listTotalPrice: list,
  standardUnitPrice: standard,
  standardTotalPrice: standard,
  currencyCode: 'USD',
})

describe('summarizeOrderPricing', () => {
  it('reproduces the quote figures: list totals, deal value over the term and total depth', () => {
    const summary = summarizeOrderPricing([
      { lineId: 'l1', quantity: 1, termMonths: 12, configuration: {}, charges: [charge('nrc', 890, 0), charge('mrc', 1200, 1050)] },
    ], 'new', 'USD')

    expect(summary.listNrcTotal).toBe(890)
    expect(summary.listMrcTotal).toBe(1200)
    expect(summary.dealValue).toEqual({ list: 890 + 1200 * 12, standard: 1050 * 12, offer: 1050 * 12 })
    expect(summary.discountDepth.total).toBeCloseTo(1 - 12600 / 15290)
    expect(summary).not.toHaveProperty('snapshotHash')
    expect(summary).not.toHaveProperty('hasTimeBasedAdjustments')
  })

  it('leaves ARC mirror lines out of deal value, as on the quote', () => {
    const summary = summarizeOrderPricing([
      { lineId: 'kept', quantity: 1, termMonths: 12, configuration: { _arcMirroredFromItemId: 'item-1' }, charges: [charge('mrc', 400, 400)] },
      { lineId: 'new', quantity: 1, termMonths: 12, configuration: {}, charges: [charge('mrc', 1200, 1050)] },
    ], 'amend', 'USD')

    expect(summary.dealValue.offer).toBe(1050 * 12)
    expect(summary.listMrcTotal).toBe(1600)
  })

  it('tolerates legacy stored charges without code, type or waterfall fields', () => {
    const summary = summarizeOrderPricing([
      { lineId: 'l1', quantity: 2, termMonths: null, configuration: null, charges: [{ unitPrice: 50, totalPrice: 50 }] },
    ], 'new', 'USD')

    expect(summary.listMrcTotal).toBe(100)
    expect(summary.dealValue.offer).toBe(50 * 2 * 12)
  })
})
