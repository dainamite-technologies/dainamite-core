import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { PriceAdjustmentsPanel, PRICE_ADJUSTMENTS_SPOT_ID } from '../PriceAdjustmentsPanel'
import { AdjustChargeAction, DiscountLineAction, PriceAdjustmentProvider, type PriceAdjustmentUi } from '../priceAdjustmentContext'
import { adjustmentAccess } from '../../../../../../lib/priceAdjustmentView'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: ({ spotId }: { spotId: string }) => <div data-spot={spotId} />,
}))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const line = { lineId: 'l1', offeringName: 'Fiber 1G', offeringId: 'o1', configuration: {}, charges: [{ chargeCode: 'fee', chargeName: 'Monthly fee' }] }
const item = {
  id: 'a1', level: 'charge' as const, quoteLineId: 'l1', chargeCode: 'fee', adjustmentType: 'price_override' as const, value: 80,
  currencyCode: 'USD', reasonCode: 'competitive_match', reasonNote: 'Beat rival', createdByUserId: '77777777-7777-4777-8777-777777777777', createdAt: '2026-11-10T10:00:00.000Z',
}

function ui(patch: Partial<Parameters<typeof adjustmentAccess>[0]> = {}, extra: Partial<PriceAdjustmentUi> = {}): PriceAdjustmentUi {
  const input = { enabled: true, canAdjust: true, cpqStatus: 'ready', convertedOrderId: null, ...patch }
  return {
    access: adjustmentAccess(input), quoteType: 'new', cpqStatus: input.cpqStatus, reasonLabels: { competitive_match: 'Competitive match' },
    invalidIds: new Set(), canDeleteInvalid: false, openCharge: jest.fn(), openLine: jest.fn(), edit: jest.fn(), remove: jest.fn(), ...extra,
  }
}
const render = (value: PriceAdjustmentUi, node: React.ReactNode) =>
  renderToStaticMarkup(<I18nProvider locale="en" dict={{}}><PriceAdjustmentProvider value={value}>{node}</PriceAdjustmentProvider></I18nProvider>)
const panel = (errors = new Map<string, string>()) => <PriceAdjustmentsPanel quoteId="q1" items={[item]} total={1} lines={[line]} currency="USD" errorsById={errors} />

it('lists the adjustment with target, value, reason label, note and edit/delete, plus the injection spot', () => {
  const html = render(ui(), panel())
  const content = text(html)
  expect(content).toContain('Fiber 1G · Monthly fee')
  expect(content).toContain('Price override')
  expect(content).toContain('$80.00')
  expect(content).toContain('Competitive match Beat rival')
  expect(html).toContain('aria-label="Edit adjustment"')
  expect(html).toContain('aria-label="Delete adjustment"')
  expect(html).toContain(`data-spot="${PRICE_ADJUSTMENTS_SPOT_ID}"`)
})

it('when locked, explains why and offers no edit or delete for valid rows', () => {
  const html = render(ui({ cpqStatus: 'in_approval' }), panel())
  expect(text(html)).toContain('Adjustments are locked in status in_approval')
  expect(html).not.toContain('Edit adjustment')
  expect(html).not.toContain('Delete adjustment')
})

it('keeps Delete for an invalid row while locked and names the error in text', () => {
  const html = render(ui({ cpqStatus: 'in_approval' }, { invalidIds: new Set(['a1']), canDeleteInvalid: true }), panel(new Map([['a1', 'ABOVE_STANDARD']])))
  expect(text(html)).toContain('Invalid: The price is above the standard price')
  expect(html).toContain('Delete adjustment')
  expect(html).not.toContain('Edit adjustment')
})

it('renders nothing when the feature toggle is off', () => {
  expect(render(ui({ enabled: false }), panel())).toBe('')
})

it('hides actions without permission and disables them with a tooltip on ARC mirror lines', () => {
  const charge = { chargeCode: 'fee', chargeName: 'Monthly fee', chargeType: 'mrc' as const, unitPrice: 100, totalPrice: 100 }
  expect(render(ui({ canAdjust: false }), <><DiscountLineAction line={line} /><AdjustChargeAction line={line} charge={charge} /></>)).toBe('')
  const mirror = { ...line, configuration: { _arcMirroredFromItemId: 'item' } }
  const html = render(ui({}, { quoteType: 'amend' }), <AdjustChargeAction line={mirror} charge={charge} />)
  expect(html).toContain('disabled')
  expect(html).toContain('Price changes on existing subscription items arrive with a later release')
  expect(render(ui(), <AdjustChargeAction line={line} charge={{ ...charge, chargeType: 'usage' }} />)).toBe('')
})
