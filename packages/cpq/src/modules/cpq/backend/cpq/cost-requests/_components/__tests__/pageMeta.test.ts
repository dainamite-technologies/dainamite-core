import { metadata } from '../../page.meta'
import { metadata as quotesMeta } from '../../../quotes/page.meta'

describe('cost requests page metadata', () => {
  it('needs the cost view and manage features (Q13) and groups with the other CPQ pages', () => {
    expect(metadata.requireFeatures).toEqual(['cpq.costs.view', 'cpq.costs.manage'])
    expect(metadata.pageGroup).toBe(quotesMeta.pageGroup)
    expect(metadata.pageGroupKey).toBe(quotesMeta.pageGroupKey)
    expect(metadata.pageOrder).toBe(4)
    expect(metadata.pageTitleKey).toBe('cpq.costRequests.title')
  })
})
