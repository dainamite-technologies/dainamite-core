import {
  ITEMS_LIST_HREF,
  accountHref,
  itemDetailHref,
  resolveItemReturnTarget,
  INVOICES_LIST_HREF,
  invoiceDetailHref,
  invoicePdfHref,
  resolveInvoiceReturnTarget,
  isAccountTab,
} from '../../lib/navigation'

describe('resolveItemReturnTarget', () => {
  it('returns to the owning account by default', () => {
    expect(resolveItemReturnTarget({ billAccountId: 'acc-1' })).toBe('/backend/billing/accounts/acc-1?tab=items')
  })

  it('returns to the items list when opened from it', () => {
    expect(resolveItemReturnTarget({ from: 'items', billAccountId: 'acc-1' })).toBe(ITEMS_LIST_HREF)
  })

  it('ignores unknown `from` values', () => {
    expect(resolveItemReturnTarget({ from: 'elsewhere', billAccountId: 'acc-1' })).toBe(accountHref('acc-1', 'items'))
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

describe('invoice navigation (Spec B)', () => {
  it('links to the invoice with a return-to-account marker when opened from an account', () => {
    expect(invoiceDetailHref('inv-1')).toBe('/backend/billing/invoices/inv-1')
    expect(invoiceDetailHref('inv-1', { fromAccountId: 'acc 1' })).toBe(
      '/backend/billing/invoices/inv-1?from=account&accountId=acc%201',
    )
  })

  it('returns to the account only when opened from it', () => {
    expect(resolveInvoiceReturnTarget({ from: 'account', accountId: 'acc-1' })).toBe(accountHref('acc-1', 'invoices'))
    expect(resolveInvoiceReturnTarget({ from: 'account', accountId: ' ' })).toBe(INVOICES_LIST_HREF)
    expect(resolveInvoiceReturnTarget({ from: null, accountId: 'acc-1' })).toBe(INVOICES_LIST_HREF)
  })

  it('builds the PDF endpoint', () => {
    expect(invoicePdfHref('inv-1')).toBe('/api/billing/invoices/inv-1/pdf')
  })
})

describe('account workspace tabs (Spec F, F8)', () => {
  it('deep-links a tab and leaves the default overview out of the URL', () => {
    expect(accountHref('acc-1')).toBe('/backend/billing/accounts/acc-1')
    expect(accountHref('acc-1', 'overview')).toBe('/backend/billing/accounts/acc-1')
    expect(accountHref('acc-1', 'runs')).toBe('/backend/billing/accounts/acc-1?tab=runs')
  })

  it('recognises valid tab ids only', () => {
    expect(isAccountTab('invoices')).toBe(true)
    expect(isAccountTab('nope')).toBe(false)
    expect(isAccountTab(null)).toBe(false)
  })
})
