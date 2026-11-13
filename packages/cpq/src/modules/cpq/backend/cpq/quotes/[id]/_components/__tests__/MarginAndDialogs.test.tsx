import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { MarginCard } from '../MarginCard'
import { CostFormBody } from '../CostFormBody'
import { MarkupFormBody } from '../MarkupOverrideDialog'
import { StaleRevisionBanner } from '../StaleRevisionBanner'
import { CostHeaderActions, CostRowActions } from '../CostActionButtons'
import { QuoteCostsProvider, type QuoteCostsUi } from '../quoteCostsContext'
import { emptyCostForm, costFormFromCost, type FullQuoteCost, type MarginFigures, type QuoteMargin } from '../../../../../../lib/quoteCostView'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

const figures = (patch: Partial<MarginFigures> = {}): MarginFigures => ({
  nrcCost: 0, mrcCost: 0, nrcOffer: 0, mrcOffer: 0, nrcMargin: 100, mrcMargin: 50, contractCost: 0, contractOffer: 0, contractMargin: 700,
  marginPercent: 41.2, markupPercent: null, costCoverage: 80, hasPendingCosts: false, hasEstimatedCosts: false, hasExpiredCosts: false, ...patch,
})
const margin = (patch: Partial<MarginFigures> = {}): QuoteMargin => ({
  ...figures(patch), marginHash: 'h',
  lines: [{ lineId: 'b', own: figures(), rollup: figures({ contractMargin: 900, marginPercent: 30 }), charges: [] }],
})
const card = (props: Partial<React.ComponentProps<typeof MarginCard>> = {}) => (
  <MarginCard margin={margin()} hasCosts currency="EUR" bundleParents={[{ lineId: 'b', name: 'Fiber bundle' }]} {...props} />
)

describe('MarginCard', () => {
  it('shows contract, percent, NRC / MRC margin, coverage and the bundle roll-up row', () => {
    const html = wrap(card())
    const content = text(html)
    expect(content).toContain('Contract margin')
    expect(content).toContain('€700.00')
    expect(content).toContain('41.2%')
    expect(content).toContain('€100.00')
    expect(content).toContain('€50.00')
    expect(content).toContain('Based on 80% coverage')
    expect(content).toContain('Fiber bundle')
    expect(content).toContain('€900.00')
    expect(html).toContain('cpq-margin-rollup-row')
    expect(html).not.toContain('cpq-margin-flags')
  })

  it('renders null percentages as a dash', () => {
    const html = wrap(card({ margin: margin({ marginPercent: null }) }))
    expect(text(html.match(/data-testid="cpq-margin-percent"[^>]*>[^<]*/)?.[0] ?? '')).toContain('—')
  })

  it('flags pending, estimated and expired costs as text badges', () => {
    const content = text(wrap(card({ margin: margin({ hasPendingCosts: true, hasEstimatedCosts: true, hasExpiredCosts: true }) })))
    expect(content).toContain('Cost pending')
    expect(content).toContain('Estimated')
    expect(content).toContain('Expired cost')
  })

  it('omits the roll-up without bundle parents', () => {
    expect(wrap(card({ bundleParents: [] }))).not.toContain('cpq-margin-rollup')
  })

  it('shows the empty state when the quote has no costs', () => {
    const html = wrap(card({ hasCosts: false }))
    expect(html).toContain('cpq-margin-empty')
    expect(text(html)).toContain('No costs on this quote yet')
    expect(wrap(card({ margin: undefined }))).toContain('cpq-margin-empty')
  })
})

const catalogCost: FullQuoteCost = {
  id: 'c1', costKey: 'transport', name: 'Transport', role: 'price_basis', valueStatus: 'estimated', expired: false,
  quoteLineId: 'l1', chargeCode: 'fee', origin: 'catalog', costType: 'mrc', source: 'fixed', costModel: 'flat',
  unitAmount: '100.0000', instanceAmount: '100.0000', currencyCode: 'EUR', supplierName: null, supplierQuoteRef: null,
  validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: 'Catalog default',
}
const body = (props: Partial<React.ComponentProps<typeof CostFormBody>> = {}) => (
  <CostFormBody form={emptyCostForm('EUR')} onChange={() => undefined} mode="add" existing={null} charges={[]} issues={[]} errorCode={null} onReload={() => undefined} {...props} />
)

describe('CostFormBody', () => {
  it('shows the catalog hint and the current note when editing a catalog cost', () => {
    const content = text(wrap(body({ mode: 'edit', existing: catalogCost, form: costFormFromCost(catalogCost, 'EUR', false) })))
    expect(content).toContain('This value comes from the catalog')
    expect(content).toContain('Current note: Catalog default')
  })

  it('marks the note required and explains the missing note', () => {
    const html = wrap(body({ issues: ['NOTE_REQUIRED'] }))
    expect(text(html)).toContain('Note *')
    expect(text(html)).toContain('Add a note explaining why the catalog value is overwritten')
  })

  it.each([
    ['COST_LOCKED', 'locked'],
    ['VALIDITY_EVIDENCE_REQUIRED', 'new supplier quote reference or a note'],
    ['PRICE_BASIS_REQUIRES_COST_PLUS', 'cost-plus charge'],
    ['CATALOG_COST_NOT_DELETABLE', 'cannot be deleted'],
  ])('maps %s to its meaning', (code, fragment) => {
    expect(text(wrap(body({ errorCode: code })))).toContain(fragment)
  })

  it('offers a reload on a stale revision', () => {
    const html = wrap(body({ errorCode: 'STALE_REVISION' }))
    expect(text(html)).toContain('Prices changed since you opened the quote')
    expect(text(html)).toContain('Reload')
    expect(wrap(body({ errorCode: 'COST_LOCKED' }))).not.toContain('Reload')
  })
})

describe('MarkupFormBody', () => {
  const form = { chargeCode: 'fee', markupRule: 'markup_percent' as const, markupValue: '', note: '' }
  const markup = (props: Partial<React.ComponentProps<typeof MarkupFormBody>> = {}) => (
    <MarkupFormBody form={form} onChange={() => undefined} charges={[{ chargeCode: 'fee', chargeName: 'Monthly fee', chargeType: 'mrc', pricingMethod: 'cost_plus' }]}
      overrides={[]} issues={[]} errorCode={null} onClear={() => undefined} onReload={() => undefined} {...props} />
  )

  it('requires a note and maps CHARGE_NOT_COST_PLUS', () => {
    const content = text(wrap(markup({ issues: ['NOTE_REQUIRED'], errorCode: 'CHARGE_NOT_COST_PLUS' })))
    expect(content).toContain('A note is required')
    expect(content).toContain('only be overridden on a cost-plus charge')
  })

  it('shows the current override with a clear action', () => {
    const html = wrap(markup({ overrides: [{ id: 'o1', quoteLineId: 'l1', chargeCode: 'fee', markupRule: 'markup_percent', markupValue: '25.0000', note: 'deal' }] }))
    expect(html).toContain('cpq-markup-current')
    expect(text(html)).toContain('Clear override')
  })
})

describe('StaleRevisionBanner', () => {
  it('says prices changed and offers a reload', () => {
    const content = text(wrap(<StaleRevisionBanner onReload={() => undefined} />))
    expect(content).toContain('Prices changed since you opened the quote — reload')
    expect(content).toContain('Reload')
  })
})

describe('cost actions', () => {
  const base: QuoteCostsUi = {
    quoteId: 'q1', cpqStatus: 'ready', locked: false, canView: true, canManage: true, data: null, costsFor: () => [], reload: async () => undefined,
    chargesFor: () => [{ chargeCode: 'fee', chargeName: 'Fee', chargeType: 'mrc', pricingMethod: 'cost_plus' }],
  }
  const actions = { add: jest.fn(), edit: jest.fn(), confirm: jest.fn(), remove: jest.fn(), overrideMarkup: jest.fn() }
  const line = { lineId: 'l1', lineName: 'Fiber' }
  const render = (ui: QuoteCostsUi, node: React.ReactNode) => wrap(<QuoteCostsProvider value={ui}>{node}</QuoteCostsProvider>)

  it('renders nothing without manage rights (read-only)', () => {
    expect(render(base, <><CostRowActions cost={catalogCost} line={line} /><CostHeaderActions line={line} /></>)).toBe('')
  })

  it('offers Add cost and Override markup (cost-plus lines only) in the header', () => {
    const html = render({ ...base, actions }, <CostHeaderActions line={line} />)
    expect(text(html)).toContain('Add cost')
    expect(text(html)).toContain('Override markup')
    expect(text(render({ ...base, actions, chargesFor: () => [] }, <CostHeaderActions line={line} />))).not.toContain('Override markup')
  })

  it('offers Confirm and Edit on a catalog cost, Delete only on a manual one', () => {
    const catalog = render({ ...base, actions }, <CostRowActions cost={catalogCost} line={line} />)
    expect(catalog).toContain('cpq-cost-confirm')
    expect(catalog).toContain('cpq-cost-edit')
    expect(catalog).not.toContain('cpq-cost-delete')
    const manual = render({ ...base, actions }, <CostRowActions cost={{ ...catalogCost, origin: 'manual', valueStatus: 'confirmed' }} line={line} />)
    expect(manual).toContain('cpq-cost-delete')
    expect(manual).not.toContain('cpq-cost-confirm')
  })
})
