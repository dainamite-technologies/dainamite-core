import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { CostsPanel, QUOTE_LINE_COSTS_SPOT_ID } from '../CostsPanel'
import { CostStatusBadges } from '../CostStatusBadges'
import { ChargeBreakdownTable } from '../../../../../../components/ChargeBreakdownTable'
import type { FullQuoteCost } from '../../../../../../lib/quoteCostView'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: ({ spotId }: { spotId: string }) => <div data-spot={spotId} />,
}))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const cost: FullQuoteCost = {
  id: 'c1', costKey: 'transport', name: 'Transport', role: 'price_basis', valueStatus: 'estimated', expired: true,
  quoteLineId: 'l1', chargeCode: 'mrc-fee', origin: 'catalog', costType: 'mrc', source: 'on_request', costModel: 'flat',
  unitAmount: '120.5000', instanceAmount: '120.5000', currencyCode: 'EUR', supplierName: 'Acme Carrier', supplierQuoteRef: null,
  validUntil: '2026-12-31', supplierTermEnd: null, supplierMinTermMonths: null, note: null,
}
const panel = (patch: Partial<React.ComponentProps<typeof CostsPanel>> = {}) => (
  <CostsPanel quoteId="q1" lineId="l1" lineName="Fiber" costs={[cost]} locked={false} status="ready" canManage {...patch} />
)

describe('CostsPanel', () => {
  it('lists the cost with name, role, source, status, value, currency, supplier and validity, plus the injection spot', () => {
    const html = wrap(panel())
    const content = text(html)
    expect(content).toContain('Transport')
    expect(content).toContain('Price basis')
    expect(content).toContain('On request')
    expect(content).toContain('Estimated')
    expect(content).toContain('Expired cost')
    expect(content).toContain('120.5000')
    expect(content).toContain('EUR')
    expect(content).toContain('Acme Carrier')
    expect(content).toContain('2026-12-31')
    expect(html).toContain(`data-spot="${QUOTE_LINE_COSTS_SPOT_ID}"`)
  })

  it('shows the empty state', () => {
    expect(text(wrap(panel({ costs: [] })))).toContain('No costs on this line. Margin is not tracked for it.')
  })

  it('marks the panel read-only without cost management', () => {
    expect(wrap(panel({ canManage: false }))).toContain('cpq-costs-readonly')
    expect(wrap(panel())).not.toContain('cpq-costs-readonly')
  })

  it('explains the lock in text and in the accessible name', () => {
    const html = wrap(panel({ locked: true, status: 'in_approval' }))
    expect(text(html)).toContain('Locked in in_approval')
    expect(html).toContain('Costs that change the price are locked in status in_approval — margin-only costs and confirmations remain possible.')
    expect(wrap(panel())).not.toContain('cpq-costs-locked')
  })

  it('ignores redacted rows (no values to show)', () => {
    const redacted = { id: 'c2', costKey: 'k', name: 'Hidden', role: 'price_basis', valueStatus: 'none', expired: false }
    expect(text(wrap(panel({ costs: [redacted] })))).toContain('No costs on this line')
  })
})

describe('CostStatusBadges', () => {
  it('renders every badge as text', () => {
    const content = text(wrap(<CostStatusBadges costs={[{ valueStatus: 'none', expired: false }, { valueStatus: 'estimated', expired: true }]} />))
    expect(content).toContain('Cost pending')
    expect(content).toContain('Estimated')
    expect(content).toContain('Expired cost')
  })
  it('renders nothing when all costs are fine', () => {
    expect(wrap(<CostStatusBadges costs={[{ valueStatus: 'confirmed', expired: false }]} />)).toBe('')
  })
})

describe('ChargeBreakdownTable with an unpriced cost-plus charge', () => {
  const charge = (extra: Record<string, unknown> = {}) => ({
    chargeCode: 'fee', chargeName: 'Monthly fee', chargeType: 'mrc' as const, pricingMethod: 'cost_plus', unitPrice: null, totalPrice: null, quantity: 1, ...extra,
  })
  const render = (c: ReturnType<typeof charge>) => wrap(<ChargeBreakdownTable charges={[c]} currency="USD" openDetailIndex={null} onToggleDetail={() => {}} />)

  it('shows "Price on request" without a fallback', () => {
    expect(text(render(charge()))).toContain('Price on request')
  })
  it('shows the fallback as approximate', () => {
    expect(text(render(charge({ fallbackPrice: 99 })))).toContain('≈ $99.00')
  })
})
