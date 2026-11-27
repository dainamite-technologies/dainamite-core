import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { OrderPriceAdjustmentsPanel, ORDER_PRICE_ADJUSTMENTS_SPOT_ID } from '../OrderPriceAdjustmentsPanel'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: ({ spotId }: { spotId: string }) => <div data-spot={spotId} />,
}))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)
const lines = [{ lineId: 'order-line', sourceQuoteLineId: 'quote-line', offeringName: 'Fiber 1G', charges: [{ chargeCode: 'setup', chargeName: 'Setup fee' }] }]
const adjustment = {
  id: 'a1', level: 'charge' as const, quoteLineId: 'quote-line', chargeCode: 'setup', adjustmentType: 'discount_percent' as const, value: 20,
  reasonCode: 'loyalty', reasonLabel: 'Loyalty', reasonNote: 'Long-time customer', createdByUserId: '77777777-7777-4777-8777-777777777777',
  createdByName: 'Ann Rep', createdByEmail: 'ann@example.com', createdAt: '2026-11-10T10:00:00.000Z',
}

it('shows the source quote adjustments read-only, matched to order lines, with reason label and author', () => {
  const html = render(<OrderPriceAdjustmentsPanel orderId="o1" adjustments={[adjustment]} lines={lines} />)
  const content = text(html)
  expect(content).toContain('Fiber 1G · Charge · Setup fee')
  expect(content).toContain('20% off')
  expect(content).toContain('Loyalty Long-time customer')
  expect(content).toContain('Ann Rep')
  expect(html).toContain(`data-spot="${ORDER_PRICE_ADJUSTMENTS_SPOT_ID}"`)
  expect(html).not.toContain('Edit adjustment')
  expect(html).not.toContain('Delete adjustment')
})

it('is hidden when the order has no adjustments', () => {
  expect(render(<OrderPriceAdjustmentsPanel orderId="o1" adjustments={[]} lines={lines} />)).toBe('')
})
