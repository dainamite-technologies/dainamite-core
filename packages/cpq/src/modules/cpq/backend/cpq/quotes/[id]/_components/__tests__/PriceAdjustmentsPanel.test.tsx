import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { PriceAdjustmentsPanel, PRICE_ADJUSTMENTS_SPOT_ID } from '../PriceAdjustmentsPanel'
import { AdjustPriceAction, PriceAdjustmentProvider, type PriceAdjustmentUi } from '../priceAdjustmentContext'
import { adjustmentAccess } from '../../../../../../lib/priceAdjustmentView'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: ({ spotId }: { spotId: string }) => <div data-spot={spotId} />,
}))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const line = { lineId: 'l1', offeringName: 'Fiber 1G', offeringId: 'o1', configuration: {}, charges: [{ chargeCode: 'fee', chargeName: 'Monthly fee' }] }
const item = {
  id: 'a1', level: 'charge' as const, quoteLineId: 'l1', chargeCode: 'fee', adjustmentType: 'price_override' as const, value: 80,
  currencyCode: 'USD', reasonCode: 'competitive_match', reasonNote: 'Beat rival', createdByUserId: '77777777-7777-4777-8777-777777777777', createdAt: '2026-11-10T10:00:00.000Z',
  createdByName: 'Ann Rep', createdByEmail: 'ann@example.com',
}

function ui(patch: Partial<Parameters<typeof adjustmentAccess>[0]> = {}, extra: Partial<PriceAdjustmentUi> = {}): PriceAdjustmentUi {
  const input = { enabled: true, canAdjust: true, cpqStatus: 'ready', convertedOrderId: null, ...patch }
  return {
    access: adjustmentAccess(input), quoteType: 'new', cpqStatus: input.cpqStatus, reasonLabels: { competitive_match: 'Competitive match' },
    invalidIds: new Set(), canDeleteInvalid: false, openPrice: jest.fn(), edit: jest.fn(), remove: jest.fn(), ...extra,
  }
}
const render = (value: PriceAdjustmentUi, node: React.ReactNode) =>
  renderToStaticMarkup(<I18nProvider locale="en" dict={{}}><PriceAdjustmentProvider value={value}>{node}</PriceAdjustmentProvider></I18nProvider>)
const panel = (errors = new Map<string, string>()) => <PriceAdjustmentsPanel quoteId="q1" items={[item]} total={1} lines={[line]} currency="USD" errorsById={errors} />

it('lists one row per target with its price, reason label, note, author name and edit/delete, plus the injection spot', () => {
  const html = render(ui(), panel())
  const content = text(html)
  expect(content).toContain('Fiber 1G · Charge · Monthly fee')
  expect(content).toContain('Set price 80.00')
  expect(content).toContain('Competitive match Beat rival')
  expect(content).toContain('Ann Rep')
  expect(html).toContain('title="77777777-7777-4777-8777-777777777777"')
  expect(content).not.toContain('77777777')
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

it('stays visible but read-only when the toggle is off and adjustments exist', () => {
  const html = render(ui({ enabled: false }), panel())
  expect(text(html)).toContain('Manual price adjustments are turned off')
  expect(text(html)).toContain('Competitive match')
  expect(html).not.toContain('Edit adjustment')
  expect(html).not.toContain('Delete adjustment')
})

it('renders nothing when the toggle is off and nothing is stored', () => {
  expect(render(ui({ enabled: false }), <PriceAdjustmentsPanel quoteId="q1" items={[]} total={0} lines={[line]} currency="USD" errorsById={new Map()} />)).toBe('')
})

it('groups phases of one target into one row: "2 phases: Free trial (month 1) → 50% off (months 2–4), then regular"', () => {
  const phase = (id: string, patch: object) => ({ ...item, id, level: 'line' as const, chargeCode: null, chargeTypeFilter: 'mrc' as const, ...patch })
  const items = [phase('p2', { adjustmentType: 'discount_percent', value: 50, fromMonth: 2, toMonth: 4, phaseName: '50% off', createdByName: null, createdByEmail: 'bob@example.com', updatedAt: '2026-11-12T10:00:00.000Z' }),
    phase('p1', { value: 0, fromMonth: 1, toMonth: 1, phaseName: 'Free trial' })]
  const html = render(ui(), <PriceAdjustmentsPanel quoteId="q1" items={items} total={2} lines={[line]} errorsById={new Map()} />)
  expect(html.match(/data-testid="cpq-price-adjustment-row"/g)).toHaveLength(1)
  expect(text(html)).toContain('2 phases: Free trial (month 1) → 50% off (months 2–4), then regular')
  // The set shows the author of its latest change; no name falls back to the email.
  expect(text(html)).toContain('bob@example.com')
})

it('hides the % action without permission and disables it with a tooltip on ARC mirror lines', () => {
  const charge = { chargeCode: 'fee', chargeName: 'Monthly fee', chargeType: 'mrc' as const, unitPrice: 100, totalPrice: 100 }
  expect(render(ui({ canAdjust: false }), <><AdjustPriceAction line={line} /><AdjustPriceAction line={line} charge={charge} /></>)).toBe('')
  const mirror = { ...line, configuration: { _arcMirroredFromItemId: 'item' } }
  const html = render(ui({}, { quoteType: 'amend' }), <AdjustPriceAction line={mirror} charge={charge} />)
  expect(html).toContain('disabled')
  expect(html).toContain('Price changes on existing subscription items arrive with a later release')
  expect(render(ui(), <AdjustPriceAction line={line} charge={{ ...charge, chargeType: 'usage' }} />)).toBe('')
})

it('shows one icon-only Adjust price button on the line and on a charge', () => {
  const charge = { chargeCode: 'fee', chargeName: 'Monthly fee', chargeType: 'mrc' as const, unitPrice: 100, totalPrice: 100 }
  const html = render(ui(), <><AdjustPriceAction line={line} /><AdjustPriceAction line={line} charge={charge} /></>)
  expect(html).toContain('data-testid="cpq-adjust-price-line"')
  expect(html).toContain('data-testid="cpq-adjust-price-charge"')
  expect(html.match(/aria-label="Adjust price"/g)).toHaveLength(2)
  expect(text(html)).not.toContain('Adjust price')
  const mirror = render(ui({}, { quoteType: 'amend' }), <AdjustPriceAction line={{ ...line, configuration: { _arcMirroredFromItemId: 'item' } }} />)
  expect(mirror).toContain('disabled')
})
