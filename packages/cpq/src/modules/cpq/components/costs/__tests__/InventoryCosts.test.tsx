import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { SubscriptionCostsSection, SubscriptionItemCosts, SubscriptionItemCostChips } from '../SubscriptionCosts'
import { AssetCostsSectionView, ASSET_COSTS_SPOT_ID } from '../AssetCostsPanel'
import type { AssetCostsResponse, FullCostRow, SubscriptionCostsResponse } from '../../../lib/orderInventoryCostView'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: ({ spotId }: { spotId: string }) => <div data-spot={spotId} />,
}))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const cost = (patch: Partial<FullCostRow> = {}): FullCostRow => ({
  id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', status: 'active', chargeCode: null, source: 'fixed', costModel: 'flat',
  unitAmount: '270', instanceAmount: '270', totalAmount: '270', currencyCode: 'EUR', supplierName: 'Carrier X', validUntil: '2999-12-31', supplierTermEnd: '2027-06-30', supplierMinTermMonths: null, ...patch,
})
const itemMargin = { mrcOffer: 400, mrcCost: 270, mrcMargin: 130, mrcMarginPercent: 32.5, nrcOffer: 0, nrcCost: 0, nrcMargin: 0, coverage: 100 }
const holder: SubscriptionCostsResponse = {
  subscriptionId: 's', currencyCode: 'EUR', margin: { ...itemMargin, mrcMargin: 99 },
  items: [{ subscriptionItemId: 'i1', itemStatus: 'active', costs: [cost(), cost({ id: 'c2', name: 'Old tail', status: 'ended' })], margin: itemMargin }],
  assets: [{ assetId: 'a1', assetStatus: 'active', costs: [cost({ id: 'c3', name: 'Licence' })], margin: { nrcOffer: 500, nrcCost: 300, nrcMargin: 200, mrcCost: 12 } }],
}
const statusOnly: SubscriptionCostsResponse = {
  subscriptionId: 's',
  items: [{ subscriptionItemId: 'i1', itemStatus: 'active', costs: [{ id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'none', status: 'active' }] }],
  assets: [],
}

describe('subscription costs', () => {
  it('shows an item its costs, ended tag and item margin for holders', () => {
    const html = wrap(<SubscriptionItemCosts response={holder} itemId="i1" currency="EUR" />)
    const content = text(html)
    expect(content).toContain('Tail')
    expect(content).toContain('€270.00')
    expect(content).toContain('/ month')
    expect(content).toContain('Carrier X')
    expect(content).toContain('Supplier term end')
    expect(content).toContain('2027-06-30')
    expect(html).toContain('cpq-cost-ended')
    expect(content).toContain('Item margin')
    expect(content).toContain('€130.00')
    expect(content).toContain('32.5%')
  })

  it('says "No cost recorded" for an uncosted item', () => {
    const html = wrap(<SubscriptionItemCosts response={holder} itemId="other" currency="EUR" />)
    expect(text(html)).toContain('No cost recorded')
    expect(html).not.toContain('cpq-item-margin')
  })

  it('status-only users get names and chips but no amount, supplier or margin', () => {
    const html = wrap(<><SubscriptionItemCostChips response={statusOnly} itemId="i1" /><SubscriptionItemCosts response={statusOnly} itemId="i1" currency="EUR" /></>)
    const content = text(html)
    expect(content).toContain('Cost pending')
    expect(content).toContain('Tail')
    expect(content).not.toContain('270')
    expect(content).not.toContain('Carrier')
    expect(html).not.toContain('cpq-item-margin')
  })

  it('the section shows the roll-up, asset costs and margin, the recurring-cost note and the ended toggle state', () => {
    const html = wrap(<SubscriptionCostsSection response={holder} includeEnded onToggleEnded={() => {}} assets={[{ id: 'a1', name: 'Server' }]} currency="EUR" />)
    const content = text(html)
    expect(content).toContain('Subscription margin')
    expect(content).toContain('€99.00')
    expect(content).toContain('Server')
    expect(content).toContain('Licence')
    expect(content).toContain('Asset margin')
    expect(content).toContain('€200.00')
    expect(content).toContain('No recurring revenue on this asset')
    expect(html).toContain('aria-pressed="true"')
    expect(content).toContain('Ended costs')
  })

  it('the section for a status-only user has no margin and says when no asset carries costs', () => {
    const html = wrap(<SubscriptionCostsSection response={statusOnly} includeEnded={false} onToggleEnded={() => {}} assets={[]} currency="EUR" />)
    expect(html).not.toContain('cpq-subscription-margin')
    expect(html).toContain('cpq-subscription-no-asset-costs')
    expect(html).toContain('aria-pressed="false"')
  })
})

describe('AssetCostsSectionView', () => {
  const asset: AssetCostsResponse = { assetId: 'a1', assetStatus: 'active', ownerItemId: null, currencyCode: 'EUR', costs: [cost({ id: 'c3', name: 'Licence', costType: 'nrc' })], margin: { nrcOffer: 500, nrcCost: 270, nrcMargin: 230, mrcCost: 0 } }
  const view = (response: AssetCostsResponse) => wrap(<AssetCostsSectionView response={response} currency="EUR" today="2026-11-14" includeEnded={false} onToggleEnded={() => {}} subscriptionId="s" ownerItemName="Cloud server" />)

  it('lists the asset costs, its margin and exposes the injection spot', () => {
    const html = view(asset)
    const content = text(html)
    expect(content).toContain('Licence')
    expect(content).toContain('one-off')
    expect(content).toContain('€230.00')
    expect(html).toContain(`data-spot="${ASSET_COSTS_SPOT_ID}"`)
    expect(ASSET_COSTS_SPOT_ID).toBe('data-table:cpq.inventory_asset_costs')
  })

  it('links to the owning item instead of listing costs when the item owns them', () => {
    const html = view({ ...asset, ownerItemId: 'i1', costs: [], margin: null })
    expect(text(html)).toContain('Costs are recorded on item Cloud server')
    expect(html).toContain('href="/backend/cpq/inventory/subscriptions/s"')
    expect(html).not.toContain('cpq-cost-rows')
    expect(html).toContain(`data-spot="${ASSET_COSTS_SPOT_ID}"`)
  })

  it('status-only: chips and names, no amounts or margin; empty asset says "No cost recorded"', () => {
    const plain = view({ assetId: 'a1', assetStatus: 'active', ownerItemId: null, costs: [{ id: 'c1', costKey: 'k', name: 'Licence', role: 'margin_only', costType: 'nrc', valueStatus: 'estimated', status: 'active' }] })
    expect(text(plain)).toContain('Estimated')
    expect(text(plain)).not.toContain('270')
    expect(plain).not.toContain('cpq-asset-margin')
    expect(text(view({ assetId: 'a1', assetStatus: 'active', ownerItemId: null, costs: [] }))).toContain('No cost recorded')
  })
})
