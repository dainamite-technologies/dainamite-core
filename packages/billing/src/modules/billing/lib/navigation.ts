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

/** Tabs of the Billing Account workspace (Spec E / Spec F, F8), deep-linkable via `?tab=`. */
export const ACCOUNT_TABS = ['overview', 'items', 'usage', 'invoices', 'payments', 'balance', 'statements', 'runs'] as const
export type AccountTab = (typeof ACCOUNT_TABS)[number]

export function isAccountTab(value: unknown): value is AccountTab {
  return typeof value === 'string' && (ACCOUNT_TABS as readonly string[]).includes(value)
}

/** The account workspace, optionally on one tab (`overview` is the default and is left out). */
export function accountHref(billAccountId: string, tab?: AccountTab): string {
  const base = `/backend/billing/accounts/${encodeURIComponent(billAccountId)}`
  return tab && tab !== 'overview' ? `${base}?tab=${tab}` : base
}

export function resolveItemReturnTarget(params: {
  from?: string | null
  billAccountId?: string | null
}): string {
  if (params.from === FROM_ITEMS_LIST) return ITEMS_LIST_HREF
  const accountId = (params.billAccountId ?? '').trim()
  return accountId ? accountHref(accountId, 'items') : ITEMS_LIST_HREF
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
  return params.from === FROM_ACCOUNT && accountId ? accountHref(accountId, 'invoices') : INVOICES_LIST_HREF
}

/** PDF of a billing document — frozen when posted, a watermarked preview otherwise. */
export function invoicePdfHref(invoiceId: string): string {
  return `/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`
}
