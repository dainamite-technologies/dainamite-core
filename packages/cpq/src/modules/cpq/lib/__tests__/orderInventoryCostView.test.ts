import {
  assetLinksByOrderLine, assetMarginView, badgeInputs, costChips, costValueView, hasCostAccess, includeEndedQuery,
  isCostExpired, itemMarginView, noCostRecorded, type FullCostRow, type CostRow, type OrderCostsResponse, type SubscriptionCostsResponse,
} from '../orderInventoryCostView'

const redacted = (patch: Partial<CostRow> = {}): CostRow => ({ id: 'c1', costKey: 'k', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', ...patch })
const full = (patch: Partial<FullCostRow> = {}): FullCostRow => ({
  ...redacted(), chargeCode: null, source: 'fixed', costModel: 'flat', unitAmount: '270.0000', instanceAmount: '270.0000', totalAmount: '270.0000',
  currencyCode: 'EUR', supplierName: 'Carrier X', validUntil: '2026-12-31', supplierTermEnd: null, supplierMinTermMonths: null, ...patch,
})

describe('orderInventoryCostView', () => {
  it('treats the response as a holder projection only when it carries a currency', () => {
    expect(hasCostAccess({ currencyCode: 'EUR' })).toBe(true)
    expect(hasCostAccess({})).toBe(false)
    expect(hasCostAccess(null)).toBe(false)
  })

  it('raises chips from open costs only and never expires a status-only row', () => {
    expect(costChips([redacted({ valueStatus: 'none' }), redacted({ id: 'c2', valueStatus: 'estimated' })], '2026-11-14')).toEqual(['pending', 'estimated'])
    expect(costChips([redacted({ valueStatus: 'none', status: 'ended' })], '2026-11-14')).toEqual([])
    expect(isCostExpired(redacted(), '2027-01-01')).toBe(false)
    expect(costChips([full({ validUntil: '2026-01-01' })], '2026-11-14')).toEqual(['expired'])
    expect(badgeInputs([full({ status: 'ended', validUntil: '2026-01-01' })], '2026-11-14')).toEqual([])
  })

  it('formats a cost value per month or one-off, and a dash without an amount', () => {
    expect(costValueView(full(), 'USD')).toEqual({ amount: '€270.00', period: 'month' })
    expect(costValueView(full({ costType: 'nrc', currencyCode: null }), 'USD')).toEqual({ amount: '$270.00', period: 'one_off' })
    expect(costValueView(full({ totalAmount: null, instanceAmount: null, unitAmount: null }), 'EUR')).toEqual({ amount: '—', period: null })
  })

  it('decides "No cost recorded" from the listed costs', () => {
    expect(noCostRecorded(undefined)).toBe(true)
    expect(noCostRecorded([])).toBe(true)
    expect(noCostRecorded([redacted()])).toBe(false)
  })

  it('links an order line to the asset that owns its seeded inventory cost', () => {
    const order: OrderCostsResponse = {
      orderId: 'o', currencyCode: 'EUR',
      lines: [
        { orderLineId: 'l1', costs: [full({ id: 'oc1', inventoryCostId: 'ic1' })] },
        { orderLineId: 'l2', costs: [full({ id: 'oc2', inventoryCostId: 'ic-item' })] },
        { orderLineId: 'l3', costs: [full({ id: 'oc3', inventoryCostId: null })] },
      ],
    }
    const subscription: SubscriptionCostsResponse = { subscriptionId: 's', items: [], assets: [{ assetId: 'a1', assetStatus: 'active', costs: [full({ id: 'ic1' })] }] }
    expect([...assetLinksByOrderLine(order, [subscription])]).toEqual([['l1', 'a1']])
    expect(assetLinksByOrderLine(null, [subscription]).size).toBe(0)
  })

  it('formats item and asset margins; a recurring asset cost is a cost, not a margin', () => {
    expect(itemMarginView({ mrcOffer: 100, mrcCost: 40, mrcMargin: 60, mrcMarginPercent: 60, nrcOffer: 0, nrcCost: 0, nrcMargin: 0, coverage: 100 }, 'EUR'))
      .toEqual({ mrcMargin: '€60.00', mrcMarginPercent: '60%', nrcMargin: '€0.00', coverage: '100%' })
    expect(itemMarginView({ mrcOffer: 0, mrcCost: 0, mrcMargin: 0, mrcMarginPercent: null, nrcOffer: 0, nrcCost: 0, nrcMargin: 0, coverage: 0 }, 'EUR').mrcMarginPercent).toBe('—')
    expect(assetMarginView({ nrcOffer: 500, nrcCost: 300, nrcMargin: 200, mrcCost: 12 }, 'EUR')).toEqual({ nrcMargin: '€200.00', recurringCost: '€12.00', hasRecurringCost: true })
    expect(assetMarginView({ nrcOffer: 0, nrcCost: 0, nrcMargin: 0, mrcCost: 0 }, 'EUR').hasRecurringCost).toBe(false)
  })

  it('builds the includeEnded query', () => {
    expect(includeEndedQuery(true)).toBe('?includeEnded=true')
    expect(includeEndedQuery(false)).toBe('')
  })
})
