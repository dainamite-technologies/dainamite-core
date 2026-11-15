"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { DetailCard, DetailField } from '../DetailFields'
import { CustomerLabel } from '../CustomerLabel'
import { fetchCustomerNames } from '../customerNames'
import { SUPPORTED_INVOICE_LANGUAGES } from '../../lib/invoiceLanguages'
import { formatDate, type AccountRow } from './accountRow'

/** Read-only account fields (workspace Overview tab). */
export function AccountView({ row }: { row: AccountRow }) {
  const t = useT()
  const customerKind = row.customer_kind ?? 'company'
  const [customerName, setCustomerName] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void fetchCustomerNames([{ customerId: row.customer_id, customerKind }]).then((names) => {
      if (!cancelled) setCustomerName(names[row.customer_id]?.name ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [row.customer_id, customerKind])
  const languageLabel =
    SUPPORTED_INVOICE_LANGUAGES.find((language) => language.code === row.invoice_language)?.label ??
    row.invoice_language
  const addr = row.invoice_address
  const addressText = addr
    ? [
        addr.line1,
        addr.line2,
        [addr.postal_code, addr.city].filter(Boolean).join(' '),
        addr.country,
      ]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(', ')
    : ''
  return (
    <DetailCard>
      <DetailField label={t('billing.accounts.columns.customer', 'Customer')}>
        <CustomerLabel
          customerId={row.customer_id}
          customerKind={customerKind}
          name={customerName}
          linkToCustomer
        />
      </DetailField>
      <DetailField label={t('billing.accounts.columns.currency', 'Currency')}>
        {row.currency_code}
      </DetailField>
      <DetailField label={t('billing.accounts.columns.mode', 'Mode')}>
        {row.billing_mode === 'prepaid' ? (
          <Tag variant="brand">{t('billing.mode.prepaid', 'Prepaid')}</Tag>
        ) : (
          <Tag variant="neutral">{t('billing.mode.postpaid', 'Postpaid')}</Tag>
        )}
      </DetailField>
      <DetailField label={t('billing.accounts.columns.credit_limit', 'Credit limit')}>
        <span className="font-mono tabular-nums">{row.credit_limit}</span>
      </DetailField>
      <DetailField label={t('billing.accounts.form.payment_terms', 'Payment terms (days)')}>
        {row.payment_terms_days != null
          ? String(row.payment_terms_days)
          : t('billing.accounts.form.payment_terms.default', 'Organization default')}
      </DetailField>
      <DetailField label={t('billing.accounts.form.auto_send', 'Email invoices automatically')}>
        {row.auto_send_invoice ? t('billing.common.yes', 'Yes') : t('billing.common.no', 'No')}
      </DetailField>
      <DetailField label={t('billing.common.id', 'ID')}>
        <span className="font-mono text-xs">{row.id}</span>
      </DetailField>
      <DetailField label={t('billing.accounts.columns.cycle', 'Cycle')}>
        {row.bill_cycle}
        <span className="text-muted-foreground"> · {row.bill_cycle_anchor}</span>
      </DetailField>
      <DetailField label={t('billing.accounts.columns.next_bill', 'Next bill')}>
        {formatDate(row.next_bill_date)}
      </DetailField>
      <DetailField label={t('billing.accounts.columns.last_bill', 'Last bill')}>
        {formatDate(row.last_bill_date)}
      </DetailField>
      <DetailField label={t('billing.accounts.form.invoice_email', 'Invoice email')}>
        {row.invoice_email}
      </DetailField>
      <DetailField label={t('billing.accounts.form.invoice_language', 'Invoice language')}>
        {languageLabel}
      </DetailField>
      <DetailField label={t('billing.accounts.form.tax_id', 'Tax ID')}>
        {row.tax_id || '—'}
      </DetailField>
      <DetailField
        label={t('billing.accounts.form.address.title', 'Invoice address')}
        fullWidth
      >
        {addressText || '—'}
      </DetailField>
    </DetailCard>
  )
}
