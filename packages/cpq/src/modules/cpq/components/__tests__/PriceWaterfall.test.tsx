import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DepthBadge, PriceWaterfall } from '../PriceWaterfall'

const withI18n = (node: React.ReactNode) => <I18nProvider locale="en" dict={{}}>{node}</I18nProvider>

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

it('renders list, rule, standard, negotiated and offer steps with the reason label', () => {
  const html = renderToStaticMarkup(withI18n(
    <PriceWaterfall
      currency="USD"
      reasonLabels={{ competitive_match: 'Competitive match' }}
      charge={{
        chargeType: 'mrc', unitPrice: 80, totalPrice: 80, listUnitPrice: 100, standardUnitPrice: 90,
        adjustments: [
          { origin: 'rule', ruleCode: 'VOL', ruleName: 'Volume', ruleType: 'discount_percent', value: 10, unitPriceBefore: 100, unitPriceAfter: 90, delta: -10 },
          { origin: 'manual', adjustmentId: 'a1', ruleCode: 'a1', ruleName: 'competitive_match', ruleType: 'price_override', value: 80, unitPriceBefore: 90, unitPriceAfter: 80, delta: -10, reasonCode: 'competitive_match' },
        ],
      }}
      renderManualActions={(id) => <button>edit {id}</button>}
    />,
  ))
  const content = text(html)
  expect(content).toMatch(/List price \$100\.00/)
  expect(content).toMatch(/Price rule: Volume 10%/)
  expect(content).toMatch(/Standard price \$90\.00/)
  expect(content).toMatch(/Negotiated: Competitive match \$80\.00/)
  expect(content).toMatch(/Offer price \$80\.00/)
  expect(content).toContain('edit a1')
  expect(content.match(/edit/g)).toHaveLength(1)
})

it('renders a signed depth badge only when prices differ', () => {
  expect(text(renderToStaticMarkup(<DepthBadge before={100} after={80} />))).toBe('−20%')
  expect(renderToStaticMarkup(<DepthBadge before={100} after={100} />)).toBe('')
})
