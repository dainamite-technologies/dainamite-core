import type { BillingAccount } from '../data/entities'

/**
 * Parties printed on a billing document. Posting freezes them as snapshots
 * on the invoice (buyer from the account, seller from `billingSettings`), so
 * later account / settings edits never change an issued document; drafts
 * render from the live rows.
 */

/** Frozen "issued to" block — later account edits never change a posted document. */
export function buildBuyerSnapshot(account: BillingAccount): Record<string, unknown> {
  return {
    bill_account_id: account.id,
    name: account.name,
    customer_id: account.customerId,
    customer_kind: account.customerKind ?? 'company',
    tax_id: account.taxId ?? null,
    invoice_email: account.invoiceEmail,
    invoice_language: account.invoiceLanguage,
    invoice_address: account.invoiceAddress ?? null,
  }
}

