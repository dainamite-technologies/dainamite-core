"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BillingDataTable as DataTable } from '../BillingDataTable'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatMoney } from '../InvoicesTable'

/**
 * Statements tab of a prepaid account workspace (Spec E §4 / Spec F, F8):
 * the account's consumption statements, newest period first
 * (`GET /api/billing/statements?billAccountId=`, server-paginated).
 */

type StatementRow = {
  id: string
  period_start: string
  period_end: string
  currency_code: string
  opening_balance: string
  total_topups: string
  total_usage: string
  total_recurring: string
  /** Signed: manual adjustments + reversals in the window. */
  total_adjustments: string
  closing_balance: string
}

type ListResponse = { items: StatementRow[]; total: number; totalPages: number }

const PAGE_SIZE = 20

function day(value: string): string {
  return value ? value.slice(0, 10) : '—'
}

export function AccountStatementsTab({ accountId, refreshKey = 0 }: { accountId: string; refreshKey?: number }) {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<StatementRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        billAccountId: accountId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortField: 'periodEnd',
        sortDir: 'desc',
      })
      const result = await readApiResultOrThrow<ListResponse>(`/api/billing/statements?${params.toString()}`)
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } catch {
      setError(t('billing.accounts.statements.error', 'Failed to load statements'))
    } finally {
      setLoading(false)
    }
  }, [accountId, page, t])

  React.useEffect(() => {
    void load()
  }, [load, refreshKey])

  const columns = React.useMemo<ColumnDef<StatementRow>[]>(
    () => [
      {
        accessorKey: 'period_start',
        header: t('billing.statements.columns.period', 'Period'),
        cell: ({ row }) => `${day(row.original.period_start)} – ${day(row.original.period_end)}`,
      },
      {
        accessorKey: 'opening_balance',
        header: t('billing.statements.columns.opening', 'Opening'),
        cell: ({ row }) => formatMoney(row.original.opening_balance, row.original.currency_code),
      },
      {
        accessorKey: 'total_topups',
        header: t('billing.statements.columns.topups', 'Top-ups'),
        cell: ({ row }) => formatMoney(row.original.total_topups, row.original.currency_code),
      },
      {
        accessorKey: 'total_usage',
        header: t('billing.statements.columns.usage', 'Usage'),
        cell: ({ row }) => formatMoney(row.original.total_usage, row.original.currency_code),
      },
      {
        accessorKey: 'total_adjustments',
        header: t('billing.statements.columns.adjustments', 'Adjustments'),
        cell: ({ row }) => formatMoney(row.original.total_adjustments, row.original.currency_code),
      },
      {
        // Charges are taken AT the bill date — in-advance ones cover the next period (#138).
        accessorKey: 'total_recurring',
        header: t('billing.statements.columns.charges_on_bill_date', 'Charges (taken on bill date)'),
        cell: ({ row }) => formatMoney(row.original.total_recurring, row.original.currency_code),
      },
      {
        accessorKey: 'closing_balance',
        header: t('billing.statements.columns.closing', 'Closing'),
        cell: ({ row }) => formatMoney(row.original.closing_balance, row.original.currency_code),
      },
    ],
    [t],
  )

  return (
    <DataTable
      title={t('billing.accounts.tabs.statements', 'Statements')}
      columns={columns}
      data={rows}
      isLoading={loading}
      error={error}
      onRowClick={(row) => router.push(`/backend/billing/statements/${row.id}`)}
      pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
      emptyState={t('billing.accounts.statements.empty', 'No statements yet — they are written when a period closes.')}
    />
  )
}
