"use client"
import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Stat, StatCard } from '../DetailFields'
import { formatMoney } from '../InvoicesTable'

/**
 * Billing Account workspace header (Spec E §4 / Spec F, F8): what the
 * operator needs at a glance, from ONE call to
 * `GET /api/billing/accounts/{id}/summary`. Postpaid shows receivables;
 * prepaid shows the balance. Informational — a failed load hides the cards.
 */

export type AccountWorkspaceSummary = {
  currency_code: string
  open_amount: string
  overdue_amount: string
  overdue_count: number
  credit_amount: string
  billing_mode: 'postpaid' | 'prepaid'
  bill_cycle: string
  next_bill_date: string | null
  last_invoice: { id: string; number: string; issue_date: string | null; total_gross: string } | null
  prepaid: {
    balance: string
    balance_status: 'ok' | 'low' | 'exhausted'
    credit_limit: string
    last_statement: { id: string; period_start: string; period_end: string; closing_balance: string } | null
  } | null
}

function balanceVariant(status: 'ok' | 'low' | 'exhausted'): 'success' | 'warning' | 'error' {
  if (status === 'exhausted') return 'error'
  if (status === 'low') return 'warning'
  return 'success'
}

export function AccountSummaryCards({ accountId, refreshKey = 0 }: { accountId: string; refreshKey?: number }) {
  const t = useT()
  const [summary, setSummary] = React.useState<AccountWorkspaceSummary | null>(null)

  React.useEffect(() => {
    let cancelled = false
    readApiResultOrThrow<AccountWorkspaceSummary>(`/api/billing/accounts/${encodeURIComponent(accountId)}/summary`)
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, refreshKey])

  if (!summary) return null
  const currency = summary.currency_code
  const statusLabel = (status: 'ok' | 'low' | 'exhausted') =>
    status === 'exhausted'
      ? t('billing.prepaid.status.exhausted', 'Exhausted')
      : status === 'low'
        ? t('billing.prepaid.status.low', 'Low')
        : t('billing.prepaid.status.ok', 'OK')

  return (
    <StatCard>
      {summary.prepaid ? (
        <>
          <Stat
            label={t('billing.accounts.summary.balance', 'Balance')}
            value={
              <span className="inline-flex items-center gap-2">
                {formatMoney(summary.prepaid.balance, currency)}
                <Tag variant={balanceVariant(summary.prepaid.balance_status)}>
                  {statusLabel(summary.prepaid.balance_status)}
                </Tag>
              </span>
            }
          />
          <Stat
            label={t('billing.accounts.columns.credit_limit', 'Credit limit')}
            value={formatMoney(summary.prepaid.credit_limit, currency)}
          />
        </>
      ) : (
        <>
          <Stat
            label={t('billing.accounts.summary.balance_due', 'Balance due')}
            value={formatMoney(summary.open_amount, currency)}
          />
          <Stat
            label={t('billing.accounts.summary.overdue', 'Overdue')}
            value={
              <span className={Number(summary.overdue_amount) > 0 ? 'text-status-error-text' : undefined}>
                {formatMoney(summary.overdue_amount, currency)} ({summary.overdue_count})
              </span>
            }
          />
          <Stat
            label={t('billing.accounts.summary.credit', 'Unapplied credit')}
            value={formatMoney(summary.credit_amount, currency)}
          />
        </>
      )}
      <Stat
        label={t('billing.accounts.columns.next_bill', 'Next bill')}
        value={
          summary.next_bill_date ? (
            <span>
              {summary.next_bill_date}
              <span className="ml-1 text-xs font-normal text-muted-foreground">· {summary.bill_cycle}</span>
            </span>
          ) : (
            '—'
          )
        }
      />
      {summary.prepaid ? (
        <Stat
          label={t('billing.accounts.summary.last_statement', 'Last statement')}
          value={
            summary.prepaid.last_statement ? (
              <Link
                href={`/backend/billing/statements/${summary.prepaid.last_statement.id}`}
                className="text-primary hover:underline"
              >
                {summary.prepaid.last_statement.period_start} – {summary.prepaid.last_statement.period_end}
              </Link>
            ) : (
              '—'
            )
          }
        />
      ) : (
        <Stat
          label={t('billing.accounts.summary.last_invoice', 'Last invoice')}
          value={
            summary.last_invoice ? (
              <Link href={`/backend/billing/invoices/${summary.last_invoice.id}`} className="text-primary hover:underline">
                {summary.last_invoice.number} · {formatMoney(summary.last_invoice.total_gross, currency)}
              </Link>
            ) : (
              '—'
            )
          }
        />
      )}
    </StatCard>
  )
}
