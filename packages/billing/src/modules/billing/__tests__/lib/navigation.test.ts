import {
  ITEMS_LIST_HREF,
  accountHref,
  itemDetailHref,
  resolveItemReturnTarget,
} from '../../lib/navigation'

describe('resolveItemReturnTarget', () => {
  it('returns to the owning account by default', () => {
    expect(resolveItemReturnTarget({ billAccountId: 'acc-1' })).toBe('/backend/billing/accounts/acc-1')
  })

  it('returns to the items list when opened from it', () => {
    expect(resolveItemReturnTarget({ from: 'items', billAccountId: 'acc-1' })).toBe(ITEMS_LIST_HREF)
  })

  it('ignores unknown `from` values', () => {
    expect(resolveItemReturnTarget({ from: 'elsewhere', billAccountId: 'acc-1' })).toBe(accountHref('acc-1'))
  })

  it('falls back to the items list without an account', () => {
    expect(resolveItemReturnTarget({})).toBe(ITEMS_LIST_HREF)
    expect(resolveItemReturnTarget({ billAccountId: '  ' })).toBe(ITEMS_LIST_HREF)
    expect(resolveItemReturnTarget({ from: null, billAccountId: null })).toBe(ITEMS_LIST_HREF)
  })
})

describe('itemDetailHref', () => {
  it('tags links from the items list', () => {
    expect(itemDetailHref('it-1')).toBe('/backend/billing/items/it-1')
    expect(itemDetailHref('it-1', { fromItemsList: true })).toBe('/backend/billing/items/it-1?from=items')
  })
})
