"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, SlidersHorizontal } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDateTime } from '../lib/displayDate'
import { BillingDataTable as DataTable } from './BillingDataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { TransactionDescription } from './TransactionDescription'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { StatCard, Stat } from './DetailFields'

/**
 * Prepaid panel (SPEC-002 P4) injected into the Billing Account detail page
 * for `billing_mode='prepaid'` accounts: balance + status, credit status,
 * a top-up launcher, and the recent balance transactions.
 */

type BalanceSnapshot = {
  balance: string
  balanceStatus: 'ok' | 'low' | 'exhausted'
  lowBalanceThreshold: string
  lastMovementAt: string | null
}

type CreditSnapshot = {
  mode: string
  creditLimit: string
  creditUsed: string
  availableCredit: string
  creditStatus: 'within_limit' | 'near_limit' | 'over_limit'
}

type TransactionRow = {
  id: string
  type: string
  amount: string
  balance_after: string
  description: string
  metadata: Record<string, unknown> | null
  created_at: string
}

function balanceVariant(status: string): 'success' | 'warning' | 'error' {
  if (status === 'low') return 'warning'
  if (status === 'exhausted') return 'error'
  return 'success'
}

function creditVariant(status: string): 'success' | 'warning' | 'error' {
  if (status === 'near_limit') return 'warning'
  if (status === 'over_limit') return 'error'
  return 'success'
}

function txnVariant(type: string): 'success' | 'info' | 'neutral' {
  if (type === 'topup' || type === 'adjustment') return 'success'
  if (type === 'usage') return 'info'
  return 'neutral'
}

export function PrepaidPanel({
  accountId,
  currencyCode,
}: {
  accountId: string
  currencyCode: string
}) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [balance, setBalance] = React.useState<BalanceSnapshot | null>(null)
  const [credit, setCredit] = React.useState<CreditSnapshot | null>(null)
  const [rows, setRows] = React.useState<TransactionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [topupOpen, setTopupOpen] = React.useState(false)
  const [amount, setAmount] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [adjAmount, setAdjAmount] = React.useState('')
  const [adjReason, setAdjReason] = React.useState('')
  const [adjSubmitting, setAdjSubmitting] = React.useState(false)
  // Spec 0 (E-D1): online top-ups need the optional payment gateways module.
  const [gatewayTopups, setGatewayTopups] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ capabilities?: { gatewayTopups?: boolean } }>('/api/billing/settings').then((call) => {
      if (!cancelled) setGatewayTopups(call.ok && call.result?.capabilities?.gatewayTopups === true)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const pageSize = 10

  const loadStatus = React.useCallback(async () => {
    const [bal, cred] = await Promise.all([
      readApiResultOrThrow<BalanceSnapshot>(`/api/billing/accounts/${accountId}/balance`),
      readApiResultOrThrow<CreditSnapshot>(`/api/billing/accounts/${accountId}/credit-status`),
    ])
    setBalance(bal)
    setCredit(cred)
  }, [accountId])

  const loadTransactions = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<{
        items: TransactionRow[]
        total: number
        totalPages: number
      }>(
        `/api/billing/transactions?billAccountId=${accountId}&page=${page}` +
          `&pageSize=${pageSize}&sortField=createdAt&sortDir=desc`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [accountId, page])

  React.useEffect(() => {
    void loadStatus().catch(() => undefined)
  }, [loadStatus])
  React.useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  const handleTopup = React.useCallback(async () => {
    const value = Number.parseFloat(amount)
    if (!Number.isFinite(value) || value <= 0) {
      flash(t('billing.prepaid.topup.invalid', 'Enter a positive amount'), 'error')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiCallOrThrow<{ redirectUrl?: string | null }>(
        `/api/billing/accounts/${accountId}/topups`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: value,
            successUrl: typeof window !== 'undefined' ? window.location.href : undefined,
            cancelUrl: typeof window !== 'undefined' ? window.location.href : undefined,
          }),
        },
      )
      const redirectUrl = res.result?.redirectUrl
      if (redirectUrl && typeof window !== 'undefined') {
        window.location.href = redirectUrl
        return
      }
      flash(t('billing.prepaid.topup.created', 'Top-up session created'), 'success')
      setTopupOpen(false)
      setAmount('')
      void loadStatus().catch(() => undefined)
      void loadTransactions()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.prepaid.topup.error', 'Top-up failed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [accountId, amount, loadStatus, loadTransactions, t])

  const handleAdjust = React.useCallback(async () => {
    const value = Number.parseFloat(adjAmount)
    if (!Number.isFinite(value) || value === 0) {
      flash(t('billing.prepaid.adjust.invalid_amount', 'Enter a non-zero amount'), 'error')
      return
    }
    if (!adjReason.trim()) {
      flash(t('billing.prepaid.adjust.invalid_description', 'Enter a reason'), 'error')
      return
    }
    setAdjSubmitting(true)
    try {
      await apiCallOrThrow('/api/billing/transactions/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billAccountId: accountId,
          amount: value,
          description: adjReason.trim(),
        }),
      })
      flash(t('billing.prepaid.adjust.success', 'Balance adjusted'), 'success')
      setAdjustOpen(false)
      setAdjAmount('')
      setAdjReason('')
      void loadStatus().catch(() => undefined)
      void loadTransactions()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.prepaid.adjust.error', 'Adjustment failed'), 'error')
    } finally {
      setAdjSubmitting(false)
    }
  }, [accountId, adjAmount, adjReason, loadStatus, loadTransactions, t])

  const columns = React.useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('billing.transactions.columns.when', 'When'),
        cell: ({ row }) => formatBillingDateTime(row.original.created_at, locale),
      },
      {
        accessorKey: 'type',
        header: t('billing.transactions.columns.type', 'Type'),
        cell: ({ row }) => (
          <Tag variant={txnVariant(row.original.type)}>
            {t(`billing.transactions.type.${row.original.type}`, row.original.type)}
          </Tag>
        ),
      },
      {
        accessorKey: 'description',
        header: t('billing.transactions.columns.description', 'Description'),
        cell: ({ row }) => (
          <TransactionDescription description={row.original.description} metadata={row.original.metadata} />
        ),
      },
      {
        accessorKey: 'amount',
        header: t('billing.transactions.columns.amount', 'Amount'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.amount}</span>
        ),
      },
      {
        accessorKey: 'balance_after',
        header: t('billing.transactions.columns.balance_after', 'Balance'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.balance_after}</span>
        ),
      },
    ],
    [t, locale],
  )

  return (
    <div className="mt-6 space-y-4">
      <StatCard title={t('billing.prepaid.panel.title', 'Prepaid balance')}>
        <Stat
          label={t('billing.prepaid.panel.balance', 'Balance')}
          value={
            <span className="flex items-center gap-2">
              <span className="font-mono tabular-nums">
                {balance?.balance ?? '—'} {currencyCode}
              </span>
              {balance ? (
                <Tag variant={balanceVariant(balance.balanceStatus)}>
                  {t(`billing.prepaid.status.${balance.balanceStatus}`, balance.balanceStatus)}
                </Tag>
              ) : null}
            </span>
          }
        />
        <Stat
          label={t('billing.prepaid.panel.threshold', 'Low threshold')}
          value={
            <span className="font-mono tabular-nums">{balance?.lowBalanceThreshold ?? '—'}</span>
          }
        />
        {credit ? (
          <Stat
            label={t('billing.prepaid.panel.credit', 'Credit')}
            value={
              <span className="flex items-center gap-2">
                <span className="font-mono tabular-nums">
                  {credit.creditUsed} / {credit.creditLimit}
                </span>
                <Tag variant={creditVariant(credit.creditStatus)}>
                  {t(`billing.prepaid.credit.${credit.creditStatus}`, credit.creditStatus)}
                </Tag>
              </span>
            }
          />
        ) : null}
        <Stat
          label={t('billing.prepaid.panel.last_movement', 'Last movement')}
          value={formatBillingDateTime(balance?.lastMovementAt, locale)}
        />
      </StatCard>

      <div className="flex flex-wrap items-center gap-2">
        {!topupOpen && !adjustOpen ? (
          <>
            {gatewayTopups ? (
              <Button type="button" onClick={() => setTopupOpen(true)}>
                <Plus size={16} />
                {t('billing.prepaid.topup.action', 'Top up')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setAdjustOpen(true)}>
              <SlidersHorizontal size={16} />
              {t('billing.prepaid.adjust.action', 'Adjust')}
            </Button>
          </>
        ) : null}

        {topupOpen ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleTopup()
                if (e.key === 'Escape') setTopupOpen(false)
              }}
              placeholder={t('billing.prepaid.topup.amount', 'Amount')}
              className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm"
            />
            <Button type="button" onClick={handleTopup} disabled={submitting}>
              {submitting
                ? t('billing.prepaid.topup.submitting', 'Starting…')
                : t('billing.prepaid.topup.confirm', 'Start checkout')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setTopupOpen(false)}>
              {t('billing.common.cancel', 'Cancel')}
            </Button>
          </div>
        ) : null}

        {adjustOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              step="0.01"
              autoFocus
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdjust()
                if (e.key === 'Escape') setAdjustOpen(false)
              }}
              placeholder={t('billing.prepaid.adjust.amount', 'Amount (+credit / −debit)')}
              className="h-9 w-48 rounded-md border border-border bg-background px-3 text-sm"
            />
            <input
              type="text"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdjust()
                if (e.key === 'Escape') setAdjustOpen(false)
              }}
              placeholder={t('billing.prepaid.adjust.description', 'Reason')}
              className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm"
            />
            <Button type="button" onClick={handleAdjust} disabled={adjSubmitting}>
              {adjSubmitting
                ? t('billing.prepaid.adjust.submitting', 'Applying…')
                : t('billing.prepaid.adjust.confirm', 'Apply adjustment')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)}>
              {t('billing.common.cancel', 'Cancel')}
            </Button>
          </div>
        ) : null}
      </div>

      <DataTable
        title={t('billing.prepaid.panel.transactions', 'Balance transactions')}
        columns={columns}
        data={rows}
        isLoading={loading}
        onRowClick={(row) => router.push(`/backend/billing/transactions/${row.id}`)}
        pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        emptyState={
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t('billing.prepaid.panel.no_transactions', 'No balance movements yet.')}
          </div>
        }
      />
    </div>
  )
}

export default PrepaidPanel
