import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { IndexErrorAlert, submitOnModEnter } from '../dialogShared'
import { metadata as listMeta } from '../../page.meta'
import { metadata as detailMeta } from '../../[id]/page.meta'
import { metadata as pricingMeta } from '../../../pricing/page.meta'

const key = (init: Partial<React.KeyboardEvent> & { key: string }) => ({ preventDefault: jest.fn(), metaKey: false, ctrlKey: false, ...init }) as unknown as React.KeyboardEvent
const wrap = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider locale="en" dict={{}}>{node}</I18nProvider>)

describe('submitOnModEnter (dialog keyboard handling)', () => {
  it('submits on Ctrl+Enter and Cmd+Enter and swallows the event', () => {
    const submit = jest.fn()
    const handler = submitOnModEnter(submit)
    const ctrl = key({ key: 'Enter', ctrlKey: true })
    handler(ctrl)
    handler(key({ key: 'Enter', metaKey: true }))
    expect(submit).toHaveBeenCalledTimes(2)
    expect((ctrl.preventDefault as jest.Mock)).toHaveBeenCalled()
  })
  it('ignores a plain Enter (it must not submit a textarea) and other keys', () => {
    const submit = jest.fn()
    const handler = submitOnModEnter(submit)
    handler(key({ key: 'Enter' }))
    handler(key({ key: 'a', ctrlKey: true }))
    handler(key({ key: 'Escape' }))
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('IndexErrorAlert', () => {
  it('renders nothing without a failure or issues', () => {
    expect(wrap(<IndexErrorAlert failure={null} />)).toBe('')
  })
  it('lists the elements of an INDEX_IN_USE refusal inline', () => {
    const element = { id: 'e', code: 'c', name: 'Power', role: 'price_basis', productChargeId: 'p', chargeCode: 'transit', isActive: true }
    const html = wrap(<IndexErrorAlert failure={{ code: 'INDEX_IN_USE', elements: [element], toggleOff: false }} />)
    expect(html).toContain('Cost elements still use this index')
    expect(html).toContain('transit · Power')
  })
  it('shows the retry message for a concurrent write', () => {
    expect(wrap(<IndexErrorAlert failure={{ code: 'CONCURRENT_INDEX_WRITE', elements: [], toggleOff: false }} />)).toContain('Someone else just added a value')
  })
})

describe('cost index page metadata', () => {
  it('groups with the pricing pages and needs the read features (costs.view included)', () => {
    expect(listMeta.requireFeatures).toEqual(['cpq.pricing.view', 'cpq.costs.view'])
    expect(listMeta.pageGroup).toBe(pricingMeta.pageGroup)
    expect(listMeta.pageGroupKey).toBe(pricingMeta.pageGroupKey)
    expect(listMeta.pageOrder).toBe(22)
    expect(listMeta.pageTitleKey).toBe('cpq.costIndices.list.title')
    expect(detailMeta.requireFeatures).toEqual(listMeta.requireFeatures)
    expect(detailMeta.pageGroupKey).toBe(listMeta.pageGroupKey)
    expect(detailMeta.navHidden).toBe(true)
  })
})
