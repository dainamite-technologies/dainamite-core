import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { CostsPanel } from '../CostsPanel'
import { CostStatusBadges } from '../CostStatusBadges'
import { CostRowActions } from '../CostActionButtons'
import { ArcCostActionsProvider, type ArcCostActionsUi } from '../arcCostActions'
import { KeepCurrentCostDialog } from '../KeepCurrentCostDialog'
import { QuoteCostsProvider, type QuoteCostsUi } from '../quoteCostsContext'
import { ExposurePanel } from '../../../../../../components/costs/ExposurePanel'
import { CostSourceChangedBanner } from '../../../../../../components/costs/CostSourceChangedBanner'
import type { FullQuoteCost } from '../../../../../../lib/quoteCostView'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({ InjectionSpot: () => <div /> }))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const cost: FullQuoteCost = {
  id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', valueStatus: 'estimated', expired: false, quoteLineId: 'l1', chargeCode: null,
  origin: 'carried', carried: true, renegotiationDue: true, costType: 'mrc', source: 'fixed', costModel: 'flat', unitAmount: '240', instanceAmount: '240',
  currencyCode: 'EUR', supplierName: 'Carrier X', supplierQuoteRef: null, validUntil: null, supplierTermEnd: '2027-06-30', supplierMinTermMonths: null, note: null,
  previous: { unitAmount: '270', currencyCode: 'EUR', supplierName: 'Carrier X', validUntil: null, supplierTermEnd: '2028-11-30' },
}

describe('carried costs in the Costs panel', () => {
  const panel = (props: Partial<React.ComponentProps<typeof CostsPanel>> = {}) =>
    wrap(<CostsPanel quoteId="q" lineId="l1" lineName="Fiber" costs={[cost]} locked={false} status="ready" canManage={false} {...props} />)
  it('shows Carried, Renegotiation due and the Was diff', () => {
    const content = text(panel())
    expect(content).toContain('Carried')
    expect(content).toContain('Renegotiation due')
    expect(content).toContain('Was 270.00 EUR · Carrier X · term to 2028-11-30')
  })
  it('shows the frozen hint and the dropped group only when given', () => {
    expect(text(panel())).not.toContain('Price locked')
    expect(text(panel())).not.toContain('Dropped at renewal')
    const content = text(panel({ frozen: true, dropped: [{ inventoryCostId: 'x', name: 'Legacy licence' }] }))
    expect(content).toContain('Price locked — cost changes move margin only')
    expect(content).toContain('Dropped at renewal')
    expect(content).toContain('Legacy licence')
  })
  it('hides the Was diff for an unchanged carried cost', () => {
    expect(text(panel({ costs: [{ ...cost, unitAmount: '270', supplierTermEnd: '2028-11-30' }] }))).not.toContain('Was ')
  })
})

describe('line badges', () => {
  it('render Carried and Renegotiation due as text for redacted rows', () => {
    const content = text(wrap(<CostStatusBadges costs={[{ valueStatus: 'confirmed', expired: false, carried: true, renegotiationDue: true }]} />))
    expect(content).toContain('Carried')
    expect(content).toContain('Renegotiation due')
  })
})

describe('Keep current cost action', () => {
  const ui = (visible: boolean): ArcCostActionsUi => ({ quoteType: 'renew', keepCurrentVisible: () => visible, keepCurrent: jest.fn(), refreshVisible: () => false, refresh: async () => false })
  const costsUi: QuoteCostsUi = {
    quoteId: 'q', cpqStatus: 'ready', locked: false, canView: true, canManage: true, data: null, costsFor: () => [], reload: async () => {},
    actions: { add: jest.fn(), edit: jest.fn(), confirm: jest.fn(), remove: jest.fn(), overrideMarkup: jest.fn() },
  }
  const row = (visible: boolean) => wrap(
    <QuoteCostsProvider value={costsUi}><ArcCostActionsProvider value={ui(visible)}><CostRowActions cost={cost} line={{ lineId: 'l1', lineName: 'Fiber' }} /></ArcCostActionsProvider></QuoteCostsProvider>,
  )
  it('renders only when the helper says so', () => {
    expect(row(true)).toContain('cpq-cost-keep-current')
    expect(row(false)).not.toContain('cpq-cost-keep-current')
  })
})

describe('KeepCurrentCostDialog', () => {
  it('is a Radix dialog: nothing in static markup (keyboard handling lives in onKeyDown, same as CostDialog)', () => {
    const html = renderToStaticMarkup(<I18nProvider locale="en" dict={{}}><KeepCurrentCostDialog cost={cost} lineName="Fiber" newTermEnd={null} revision={1} onSubmit={async () => null} onClose={() => {}} onReload={() => {}} /></I18nProvider>)
    expect(html).toBe('') // Radix dialog portals do not render in static markup
  })
})

describe('ExposurePanel', () => {
  const exposure = { referenceDate: '2026-11-15', items: [
    { inventoryCostId: 'a', costKey: 'k', name: 'tail', supplierName: 'Carrier X', supplierTermEnd: '2028-11-30', exposureMonths: 12, termUnknown: false },
    { inventoryCostId: 'b', costKey: 'k2', name: 'Line', supplierName: null, supplierTermEnd: null, exposureMonths: null, termUnknown: true },
  ] }
  it('renders rows, "as of today" and unknown terms', () => {
    const content = text(wrap(<ExposurePanel exposure={exposure} today="2026-11-15" />))
    expect(content).toContain('Supplier exposure')
    expect(content).toContain('as of today')
    expect(content).toContain('Carrier X tail — term ends 2028-11-30 (exposure 12 months)')
    expect(content).toContain('Line — supplier term unknown')
  })
  it('names the effective date after activation and renders nothing when empty or absent', () => {
    expect(text(wrap(<ExposurePanel exposure={exposure} today="2026-12-01" />))).toContain('as of 2026-11-15')
    expect(wrap(<ExposurePanel exposure={{ referenceDate: '2026-11-15', items: [] }} today="x" />)).toBe('')
    expect(wrap(<ExposurePanel exposure={undefined} today="x" />)).toBe('')
  })
})

describe('CostSourceChangedBanner', () => {
  const lines = [{ quoteLineId: 'l1', name: 'Fiber', costKeys: ['tail'], refreshable: true }]
  it('offers Refresh before conversion', () => {
    const html = wrap(<CostSourceChangedBanner view={{ phase: 'quote', lines }} onRefresh={() => {}} />)
    expect(text(html)).toContain("The subscription&#x27;s costs changed since this quote was created")
    expect(text(html)).toContain('Fiber')
    expect(html).toContain('cpq-cost-source-changed-refresh')
  })
  it('tells the operator to cancel the order and create a new Amend after conversion', () => {
    const html = wrap(<CostSourceChangedBanner view={{ phase: 'order', lines: [{ ...lines[0], refreshable: false }] }} />)
    expect(text(html)).toContain('Cancel this order and create a new Amend')
    expect(html).not.toContain('cpq-cost-source-changed-refresh')
  })
})
