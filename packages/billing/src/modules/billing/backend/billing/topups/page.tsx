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

/**
 * Registered top-ups admin list (SPEC-002 P2). Read-only — top-ups are
 * initiated from a prepaid account's detail page and progress through the
 * gateway capture lifecycle.
 */

type TopupRow = {
  id: string
  bill_account_id: string
  status: string
  amount: string
  currency_code: string
  provider_key: string
  receipt_invoice_id: string | null
  created_at: string
}

type ListResponse = { items: TopupRow[]; total: number; totalPages: number }

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export function statusVariant(status: string): 'success' | 'info' | 'error' | 'default' {
  if (status === 'captured') return 'success'
  if (status === 'pending') return 'info'
  if (status === 'failed') return 'error'
  return 'default' // cancelled / expired
}

export default function BillingTopupsListPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<TopupRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('billing.topups.filters.status', 'Status'),
        type: 'select',
        options: [
          { value: 'pending', label: t('billing.topups.status.pending', 'Pending') },
          { value: 'captured', label: t('billing.topups.status.captured', 'Captured') },
          { value: 'failed', label: t('billing.topups.status.failed', 'Failed') },
          { value: 'cancelled', label: t('billing.topups.status.cancelled', 'Cancelled') },
          { value: 'expired', label: t('billing.topups.status.expired', 'Expired') },
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
      if (search.trim()) params.set('search', search.trim())
      if (typeof filters.status === 'string' && filters.status) params.set('status', filters.status)
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/topups?${params.toString()}`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [filters.status, page, pageSize, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<TopupRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('billing.topups.columns.created', 'Created'),
        cell: ({ row }) => formatDate(row.original.created_at),
      },
      {
        accessorKey: 'amount',
        header: t('billing.topups.columns.amount', 'Amount'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {row.original.amount} {row.original.currency_code}
          </span>
        ),
      },
      {
        accessorKey: 'provider_key',
        header: t('billing.topups.columns.provider', 'Provider'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.provider_key}</span>,
      },
      {
        accessorKey: 'status',
        header: t('billing.topups.columns.status', 'Status'),
        cell: ({ row }) => (
          <Tag variant={statusVariant(row.original.status)}>
            {t(`billing.topups.status.${row.original.status}`, row.original.status)}
          </Tag>
        ),
      },
      {
        accessorKey: 'bill_account_id',
        header: t('billing.topups.columns.account', 'Account'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.bill_account_id}</span>,
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.topups.title', 'Top-ups')}
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-topups' }}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/billing/topups/${row.id}`)}
          isLoading={loading}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={setFilters}
          onFiltersClear={() => setFilters({})}
          searchValue={search}
          onSearchChange={setSearch}
        />
      </PageBody>
    </Page>
  )
}
