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

describe('CostsPanel foreign-currency costs', () => {
  const usd: FullQuoteCost = {
    ...cost, currencyCode: 'USD', unitAmount: '300.0000', instanceAmount: '300.0000', fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB',
    fxRateDerivation: 'direct', convertedInstanceAmount: '276', quoteCurrencyCode: 'EUR',
  }
  it('shows the original amount and the converted line, with the frozen tooltip only while locked', () => {
    const open = wrap(panel({ costs: [usd] }))
    expect(text(open)).toContain('300.0000')
    expect(text(open)).toContain('≈ 276.00 EUR · 0.92 · ECB · 2026-11-11')
    expect(open).not.toContain('Rate frozen')
    const locked = wrap(panel({ costs: [usd], locked: true, status: 'in_approval' }))
    expect(locked).toContain('Rate frozen while the quote is locked')
  })
  it('a quote-currency cost has no converted line', () => {
    expect(wrap(panel())).not.toContain('cpq-cost-converted')
  })
  it('names the missing pair from errorDetail', () => {
    const noRate: FullQuoteCost = { ...usd, valueStatus: 'none', fxRate: null, fxRateDate: null, fxRateSource: null, convertedInstanceAmount: null, error: 'CURRENCY_NO_RATE',
      errorDetail: { code: 'CURRENCY_NO_RATE', from: 'USD', to: 'EUR', date: '2026-11-12' } }
    const content = text(wrap(panel({ costs: [noRate] })))
    expect(content).toContain('No USD→EUR rate for 2026-11-12')
    expect(content).not.toContain('≈')
  })
})

describe('CostStatusBadges missing rate', () => {
  it('non-holders see "Cost pending — currency rate missing" with no currency', () => {
    const content = text(wrap(<CostStatusBadges costs={[{ valueStatus: 'none', expired: false, error: 'CURRENCY_NO_RATE' }]} />))
    expect(content).toContain('Cost pending — currency rate missing')
    expect(content).not.toMatch(/USD|EUR/)
  })
  it('keeps the plain "Cost pending" when the pending line has another reason', () => {
    const content = text(wrap(<CostStatusBadges costs={[{ valueStatus: 'none', expired: false }]} />))
    expect(content).toContain('Cost pending')
    expect(content).not.toContain('rate missing')
  })
})

describe('CostsPanel index costs', () => {
  const indexed: FullQuoteCost = {
    ...cost, source: 'index', valueStatus: 'confirmed', expired: false, currencyCode: 'EUR', unitAmount: '41.2000', instanceAmount: '41.2000',
    indexSnapshot: { indexId: 'i1', currencyCode: 'EUR', effectiveDate: '2026-11-01', revision: 2, value: '82.4', factor: '0.5', offset: '0', asOfDate: '2026-11-16' },
  }
  const labels = { i1: { code: 'DEMO-DC-POWER', unit: 'MWh' } }

  it('shows the snapshot line next to the value, and the lock hint only while locked', () => {
    const open = wrap(panel({ costs: [indexed], indexLabels: labels }))
    expect(text(open)).toContain('DEMO-DC-POWER 82.40 EUR/MWh · 2026-11-01 r2 · × 0.5')
    expect(text(open)).toContain('Market index')
    expect(open).not.toContain('cpq-cost-index-frozen')
    const locked = wrap(panel({ costs: [indexed], indexLabels: labels, locked: true, status: 'in_approval' }))
    expect(locked).toContain('cpq-cost-index-frozen')
    expect(text(locked)).toContain('Frozen while the quote is locked')
  })

  it('names no index without a label and shows nothing for a line without a snapshot', () => {
    expect(text(wrap(panel({ costs: [indexed], indexLabels: {} })))).toContain('82.40 EUR · 2026-11-01 r2 · × 0.5')
    expect(wrap(panel({ costs: [{ ...indexed, indexSnapshot: null }], indexLabels: labels }))).not.toContain('cpq-cost-index-snapshot')
  })

  it('shows the No index value badge for a line without a value in force', () => {
    const none: FullQuoteCost = { ...indexed, valueStatus: 'none', unitAmount: null, instanceAmount: null, indexSnapshot: null, error: 'INDEX_NO_VALUE' }
    const html = wrap(panel({ costs: [none], indexLabels: labels }))
    expect(html).toContain('cpq-cost-index-no-value')
    expect(text(html)).toContain('No index value')
  })
})

describe('CostStatusBadges index costs', () => {
  it('shows No index value to everyone (status only: no index, no amount)', () => {
    const html = wrap(<CostStatusBadges costs={[{ valueStatus: 'none', expired: false, error: 'INDEX_NO_VALUE' }]} />)
    expect(html).toContain('cpq-cost-badge-indexNoValue')
    expect(text(html)).toContain('No index value')
    expect(text(html)).toContain('Cost pending')
  })
})
