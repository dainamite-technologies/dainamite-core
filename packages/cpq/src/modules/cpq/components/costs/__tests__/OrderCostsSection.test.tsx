import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { OrderCostsSection } from '../OrderCostsSection'
import { OrderCostsSummaryView } from '../OrderCostsSummary'
import type { FullCostRow, OrderCostsResponse } from '../../../lib/orderInventoryCostView'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const cost: FullCostRow = {
  id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'estimated', chargeCode: null, source: 'fixed', costModel: 'flat',
  unitAmount: '270', instanceAmount: '270', totalAmount: '270', currencyCode: 'EUR', supplierName: 'Carrier X', validUntil: '2026-12-31',
  supplierTermEnd: '2027-06-30', supplierMinTermMonths: null, inventoryCostId: 'ic1',
}
const figures = { nrcCost: 0, mrcCost: 270, nrcOffer: 0, mrcOffer: 400, nrcMargin: 0, mrcMargin: 130, contractCost: 270, contractOffer: 400, contractMargin: 130, marginPercent: 32.5, markupPercent: null, costCoverage: 100, hasPendingCosts: false, hasEstimatedCosts: true, hasExpiredCosts: false }
const lines = [{ lineId: 'l1', name: 'Fiber' }, { lineId: 'l2', name: 'Router' }]
const holder: OrderCostsResponse = { orderId: 'o', currencyCode: 'EUR', lines: [{ orderLineId: 'l1', costs: [cost] }], margin: { ...figures, marginHash: 'h', lines: [] } }
const statusOnly: OrderCostsResponse = { orderId: 'o', lines: [{ orderLineId: 'l1', costs: [{ id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'estimated' }] }] }

describe('OrderCostsSection', () => {
  it('holders see costs, "No costs" per uncosted line, the Order margin card and the asset link', () => {
    const html = wrap(<OrderCostsSection response={holder} lines={lines} currency="EUR" assetLinks={new Map([['l1', 'a1']])} today="2026-11-14" />)
    const content = text(html)
    expect(content).toContain('Order margin')
    expect(content).toContain('€130.00')
    expect(content).toContain('Tail')
    expect(content).toContain('€270.00')
    expect(content).toContain('Carrier X')
    expect(content).toContain('2027-06-30')
    expect(content).toContain('Estimated')
    expect(html).toContain('cpq-order-line-no-costs')
    expect(html).toContain('href="/backend/cpq/inventory/assets/a1"')
  })

  it('status-only users see chips and names but no amount, supplier, margin or uncosted lines', () => {
    const html = wrap(<OrderCostsSection response={statusOnly} lines={lines} currency="EUR" today="2026-11-14" />)
    const content = text(html)
    expect(content).toContain('Estimated')
    expect(content).toContain('Tail')
    expect(content).not.toContain('270')
    expect(content).not.toContain('Carrier')
    expect(html).not.toContain('cpq-margin-card')
    expect(html).not.toContain('cpq-order-line-no-costs')
    expect(content).not.toContain('Router')
  })

  it('holders with no costs see the empty margin state', () => {
    const html = wrap(<OrderCostsSection response={{ orderId: 'o', currencyCode: 'EUR', lines: [] }} lines={lines} currency="EUR" today="2026-11-14" />)
    expect(html).toContain('cpq-margin-empty')
    expect(text(html)).toContain('No costs on this order')
  })
})

describe('OrderCostsSummaryView', () => {
  it('shows chips and margin for holders, chips only for others', () => {
    expect(text(wrap(<OrderCostsSummaryView response={holder} currency="EUR" today="2026-11-14" />))).toContain('€130.00')
    const plain = wrap(<OrderCostsSummaryView response={statusOnly} currency="EUR" today="2026-11-14" />)
    expect(text(plain)).toContain('Estimated')
    expect(plain).not.toContain('cpq-order-summary-margin')
  })
  it('renders nothing for a status-only order without costs', () => {
    expect(wrap(<OrderCostsSummaryView response={{ orderId: 'o', lines: [] }} currency="EUR" today="2026-11-14" />)).toBe('')
  })
})
