"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchAccountNames } from '../../../components/accountNames'

/**
 * Balance transactions admin list (SPEC-002). Read-only — the append-only
 * ledger is written by the command bus (real-time consume, top-up capture,
 * period close, manual adjustment). Each row links to its detail page so an
 * operator can trace a movement back to its source document.
 */

type TransactionRow = {
  id: string
  bill_account_id: string
  type: string
  amount: string
  currency_code: string
  balance_after: string
  description: string
  created_at: string
}

type ListResponse = { items: TransactionRow[]; total: number; totalPages: number }

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export function txnVariant(type: string): 'success' | 'info' | 'error' | 'neutral' | 'default' {
  if (type === 'topup' || type === 'adjustment') return 'success'
  if (type === 'usage') return 'info'
  if (type === 'reversal') return 'error'
  return 'neutral' // recurring / one_time
}

export default function BillingTransactionsListPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<TransactionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [accountNames, setAccountNames] = React.useState<Record<string, string>>({})

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'type',
        label: t('billing.transactions.filters.type', 'Type'),
        type: 'select',
        options: [
          { value: 'topup', label: t('billing.transactions.type.topup', 'Top-up') },
          { value: 'usage', label: t('billing.transactions.type.usage', 'Usage') },
          { value: 'recurring', label: t('billing.transactions.type.recurring', 'Recurring') },
          { value: 'one_time', label: t('billing.transactions.type.one_time', 'One-time') },
          { value: 'adjustment', label: t('billing.transactions.type.adjustment', 'Adjustment') },
          { value: 'reversal', label: t('billing.transactions.type.reversal', 'Reversal') },
        ],
      },
    ],
    [t],
  )

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortField: 'createdAt',
        sortDir: 'desc',
      })
      if (typeof filters.type === 'string' && filters.type) params.set('type', filters.type)
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/transactions?${params.toString()}`,
      )
      const items = result.items ?? []
      setRows(items)
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
      try {
        const names = await fetchAccountNames(items.map((r) => r.bill_account_id))
        setAccountNames((prev) => ({ ...prev, ...names }))
      } catch {
        // Name resolution is best-effort — fall back to the id in the cell.
      }
    } finally {
      setLoading(false)
    }
  }, [filters.type, page, pageSize])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('billing.transactions.columns.when', 'When'),
        cell: ({ row }) => formatDate(row.original.created_at),
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
        cell: ({ row }) => <span className="text-sm">{row.original.description}</span>,
      },
      {
        accessorKey: 'amount',
        header: t('billing.transactions.columns.amount', 'Amount'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {row.original.amount} {row.original.currency_code}
          </span>
        ),
      },
      {
        accessorKey: 'balance_after',
        header: t('billing.transactions.columns.balance_after', 'Balance'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.balance_after}</span>
        ),
      },
      {
        accessorKey: 'bill_account_id',
        header: t('billing.transactions.columns.account', 'Account'),
        cell: ({ row }) => {
          const name = accountNames[row.original.bill_account_id]
          return name ? (
            <span className="text-sm">{name}</span>
          ) : (
            <span className="font-mono text-xs">{row.original.bill_account_id}</span>
          )
        },
      },
    ],
    [t, accountNames],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.transactions.title', 'Transactions')}
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-transactions' }}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/billing/transactions/${row.id}`)}
          isLoading={loading}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={setFilters}
          onFiltersClear={() => setFilters({})}
        />
      </PageBody>
    </Page>
  )
}
