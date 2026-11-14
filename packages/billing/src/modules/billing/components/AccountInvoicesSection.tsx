"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Stat, StatCard } from './DetailFields'
import { InvoicesTable, formatMoney } from './InvoicesTable'

/**
 * Account Invoices section (Spec B): receivables summary cards + the
 * account's billing documents. Self-contained so Spec E's account workspace
 * can drop it into its Invoices tab unchanged.
 */

type AccountSummary = {
  currency_code: string
  open_amount: string
  overdue_amount: string
  overdue_count: number
  credit_amount: string
}

export function AccountInvoicesSection({ accountId }: { accountId: string }) {
  const t = useT()
  const [summary, setSummary] = React.useState<AccountSummary | null>(null)

  React.useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<AccountSummary>(`/api/billing/accounts/${encodeURIComponent(accountId)}/summary`)
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch(() => {
        // Summary is informational; the invoices table reports its own errors.
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  return (
    <div className="mt-6 space-y-3">
      {summary ? (
        <StatCard>
          <Stat
            label={t('billing.accounts.summary.open', 'Open receivables')}
            value={formatMoney(summary.open_amount, summary.currency_code)}
          />
          <Stat
            label={t('billing.accounts.summary.overdue', 'Overdue')}
            value={`${formatMoney(summary.overdue_amount, summary.currency_code)} (${summary.overdue_count})`}
          />
          <Stat
            label={t('billing.accounts.summary.credit', 'Unapplied credit')}
            value={formatMoney(summary.credit_amount, summary.currency_code)}
          />
        </StatCard>
      ) : null}
      <InvoicesTable
        title={t('billing.accounts.detail.invoices', 'Invoices')}
        billAccountId={accountId}
        tableId="billing-account-invoices"
        pageSize={10}
      />
    </div>
  )
}
