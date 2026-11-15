import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { CostsPanel } from '../CostsPanel'
import { CostStatusBadges } from '../CostStatusBadges'
import { CostRowActions } from '../CostActionButtons'
import { QuoteCostsProvider, type QuoteCostsUi, type SourcingUi } from '../quoteCostsContext'
import { sourcingPermissions } from '../../../../../../lib/costSourcingView'
import type { FullQuoteCost } from '../../../../../../lib/quoteCostView'

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: ({ spotId }: { spotId: string }) => <div data-spot={spotId} />,
}))

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const cost = (patch: Partial<FullQuoteCost> = {}): FullQuoteCost => ({
  id: 'c1', costKey: 'transport', name: 'Transport', role: 'price_basis', valueStatus: 'none', expired: false,
  quoteLineId: 'l1', chargeCode: 'mrc-fee', origin: 'catalog', costType: 'mrc', source: 'on_request', costModel: 'flat',
  unitAmount: null, instanceAmount: null, currencyCode: null, supplierName: null, supplierQuoteRef: null,
  validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null,
  sourcingStatus: 'requested', requestSeq: 1, requestedAt: '2026-11-10T09:00:00.000Z', hasAnswerPending: false, overdue: false, costRequestId: 'req-1',
  ...patch,
})

const ui = (granted: string[], closed = false): QuoteCostsUi => {
  const noop = jest.fn()
  const sourcing: SourcingUi = {
    permissions: sourcingPermissions(granted), closed,
    handlers: { request: noop, cancel: noop, answer: noop, decline: noop, apply: noop },
  }
  return { quoteId: 'q1', cpqStatus: 'ready', locked: false, canView: true, canManage: false, data: null, costsFor: () => [], reload: async () => {}, sourcing }
}
const actions = (granted: string[], row: FullQuoteCost, closed = false) => wrap(
  <QuoteCostsProvider value={ui(granted, closed)}><CostRowActions cost={row} line={{ lineId: 'l1', lineName: 'Fiber' }} /></QuoteCostsProvider>,
)

const REP = ['cpq.quotes.view', 'cpq.costs.view', 'cpq.quotes.manage']
const PROCUREMENT = ['cpq.costs.view', 'cpq.costs.manage']
const MANAGER = ['cpq.quotes.view', 'cpq.costs.view', 'cpq.quotes.manage', 'cpq.costs.manage']

describe('sourcing badges on the quote line', () => {
  it('renders requested, overdue, declined and answer-pending as text, for redacted rows too', () => {
    const content = text(wrap(<CostStatusBadges costs={[
      { valueStatus: 'none', expired: false, sourcingStatus: 'requested', overdue: true },
      { valueStatus: 'confirmed', expired: false, sourcingStatus: 'declined' },
      { valueStatus: 'confirmed', expired: false, sourcingStatus: 'answered', hasAnswerPending: true },
    ]} />))
    expect(content).toContain('Cost requested')
    expect(content).toContain('Overdue')
    expect(content).toContain('Declined — no supplier')
    expect(content).toContain('Supplier answered with a different cost')
    expect(content).toContain('Cost pending')
  })
  it('renders nothing for confirmed, unrequested costs', () => {
    expect(wrap(<CostStatusBadges costs={[{ valueStatus: 'confirmed', expired: false, sourcingStatus: 'not_requested' }]} />)).toBe('')
  })
})

describe('CostsPanel sourcing rendering', () => {
  const panel = (rows: FullQuoteCost[]) => wrap(<CostsPanel quoteId="q1" lineId="l1" lineName="Fiber" costs={rows} locked={false} status="ready" canManage={false} />)
  it('shows the request status with its sequence and a details toggle only for requested lines', () => {
    const html = panel([cost()])
    expect(text(html)).toContain('Requested #1')
    expect(html).toContain('cpq-cost-request-toggle')
    const plain = panel([cost({ sourcingStatus: 'not_requested', requestSeq: null })])
    expect(plain).not.toContain('cpq-cost-request-toggle')
    expect(plain).not.toContain('cpq-cost-sourcing-status')
  })
})

describe('sourcing row actions by permission', () => {
  it('a rep (view + quotes.manage) can re-request and cancel but not answer, decline or apply', () => {
    const html = actions(REP, cost({ hasAnswerPending: true }))
    expect(html).toContain('cpq-cost-rerequest')
    expect(html).toContain('cpq-cost-cancel')
    for (const hidden of ['cpq-cost-answer', 'cpq-cost-decline', 'cpq-cost-apply']) expect(html).not.toContain(hidden)
  })
  it('a rep can request a line that has none yet', () => {
    expect(actions(REP, cost({ sourcingStatus: 'not_requested' }))).toContain('cpq-cost-request"')
  })
  it('procurement (view + costs.manage) can answer and decline but not request, cancel or apply', () => {
    const html = actions(PROCUREMENT, cost({ hasAnswerPending: true }))
    expect(html).toContain('cpq-cost-answer')
    expect(html).toContain('cpq-cost-decline')
    for (const hidden of ['cpq-cost-request', 'cpq-cost-rerequest', 'cpq-cost-cancel', 'cpq-cost-apply']) expect(html).not.toContain(`data-testid="${hidden}"`)
  })
  it('apply needs a pending answer plus quote and cost management', () => {
    expect(actions(MANAGER, cost({ sourcingStatus: 'answered', hasAnswerPending: true }))).toContain('cpq-cost-apply')
    expect(actions(MANAGER, cost({ sourcingStatus: 'answered', hasAnswerPending: false }))).not.toContain('cpq-cost-apply')
    expect(actions(PROCUREMENT, cost({ sourcingStatus: 'answered', hasAnswerPending: true }))).not.toContain('cpq-cost-apply')
  })
  it('renders nothing on a closed quote or an ineligible line', () => {
    expect(actions(MANAGER, cost(), true)).toBe('')
    expect(actions(MANAGER, cost({ requestEligible: false }))).toBe('')
  })
  it('renders nothing without any sourcing permission', () => {
    expect(actions(['cpq.costs.view'], cost())).toBe('')
  })
})
