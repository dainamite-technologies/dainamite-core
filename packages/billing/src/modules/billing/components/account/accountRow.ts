import type { AccountFormValues } from '../AccountForm'

/**
 * Billing Account row as returned by `GET /api/billing/accounts` (snake_case
 * `fields`), shared by the account workspace page and its tabs.
 */
export type AccountRow = {
  id: string
  customer_id: string
  customer_kind: 'company' | 'person'
  name: string
  currency_code: string
  bill_cycle: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  bill_cycle_anchor: string
  invoice_email: string
  invoice_language: string
  tax_id: string | null
  invoice_address: {
    line1?: string
    line2?: string
    city?: string
    postal_code?: string
    country?: string
  } | null
  next_bill_date: string
  last_bill_date: string | null
  billing_mode: 'postpaid' | 'prepaid'
  credit_limit: string
  payment_terms_days: number | null
  auto_send_invoice: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

export function toFormValues(row: AccountRow): AccountFormValues {
  return {
    customerId: row.customer_id,
    customerKind: row.customer_kind ?? 'company',
    name: row.name,
    currencyCode: row.currency_code,
    billCycle: row.bill_cycle,
    billCycleAnchor: row.bill_cycle_anchor,
    invoiceEmail: row.invoice_email,
    invoiceLanguage: row.invoice_language,
    taxId: row.tax_id ?? '',
    invoiceAddress: {
      line1: row.invoice_address?.line1 ?? '',
      line2: row.invoice_address?.line2 ?? '',
      city: row.invoice_address?.city ?? '',
      postal_code: row.invoice_address?.postal_code ?? '',
      country: row.invoice_address?.country ?? '',
    },
    nextBillDate: row.next_bill_date?.slice(0, 10) ?? '',
    isActive: row.is_active,
    billingMode: row.billing_mode,
    creditLimit: row.credit_limit ?? '0',
    paymentTermsDays: row.payment_terms_days != null ? String(row.payment_terms_days) : '',
    autoSendInvoice: row.auto_send_invoice ?? false,
    // The threshold lives on the balance row, not the account row — blank
    // means "leave unchanged" on save.
    lowBalanceThreshold: '',
  }
}
