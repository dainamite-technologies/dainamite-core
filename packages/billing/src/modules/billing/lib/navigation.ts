/**
 * Where an item page returns to (Spec E, D23).
 *
 * Billing items always belong to an account, so the account is the natural
 * parent: back / after-save / after-delete land there. The only exception is
 * an item opened from the global Items list (`?from=items`), which returns
 * to that list so the operator keeps their place.
 */

export const ITEMS_LIST_HREF = '/backend/billing/items'

/** Query value the global Items list appends when opening an item. */
export const FROM_ITEMS_LIST = 'items'

export function accountHref(billAccountId: string): string {
  return `/backend/billing/accounts/${encodeURIComponent(billAccountId)}`
}

export function resolveItemReturnTarget(params: {
  from?: string | null
  billAccountId?: string | null
}): string {
  if (params.from === FROM_ITEMS_LIST) return ITEMS_LIST_HREF
  const accountId = (params.billAccountId ?? '').trim()
  return accountId ? accountHref(accountId) : ITEMS_LIST_HREF
}

export function itemDetailHref(itemId: string, opts: { fromItemsList?: boolean } = {}): string {
  const base = `${ITEMS_LIST_HREF}/${encodeURIComponent(itemId)}`
  return opts.fromItemsList ? `${base}?from=${FROM_ITEMS_LIST}` : base
}

/**
 * Where an invoice detail page returns to (Spec B): the account it was
 * opened from (`?from=account`), otherwise the global Invoices list.
 */
export const INVOICES_LIST_HREF = '/backend/billing/invoices'
export const FROM_ACCOUNT = 'account'

export function invoiceDetailHref(invoiceId: string, opts: { fromAccountId?: string | null } = {}): string {
  const base = `${INVOICES_LIST_HREF}/${encodeURIComponent(invoiceId)}`
  const accountId = (opts.fromAccountId ?? '').trim()
  return accountId ? `${base}?from=${FROM_ACCOUNT}&accountId=${encodeURIComponent(accountId)}` : base
}

export function resolveInvoiceReturnTarget(params: { from?: string | null; accountId?: string | null }): string {
  const accountId = (params.accountId ?? '').trim()
  return params.from === FROM_ACCOUNT && accountId ? accountHref(accountId) : INVOICES_LIST_HREF
}

/** PDF of a billing document — frozen when posted, a watermarked preview otherwise. */
export function invoicePdfHref(invoiceId: string): string {
  return `/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`
}
