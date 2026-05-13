"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type OrderConfig = {
  id: string
  orderId: string
  orderNumber: string | null
  customerId: string
  cpqStatus: string
  currencyCode: string
  pricingSummary: {
    nrcTotal?: number
    mrcTotal?: number
  } | null
  createdAt: string
  activatedAt: string | null
}

type OrdersResponse = {
  items?: OrderConfig[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-800',
  pending_activation: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  fulfilled: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number | undefined, currency: string): string {
  if (amount == null || amount === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export default function CpqOrdersListPage() {
  const router = useRouter()
  const t = useT()

  const [rows, setRows] = React.useState<OrderConfig[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const statusOptions = React.useMemo(
    () => [
      { value: 'draft', label: 'Draft' },
      { value: 'pending_activation', label: 'Pending Activation' },
      { value: 'active', label: 'Active' },
      { value: 'fulfilled', label: 'Fulfilled' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    [],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'cpqStatus',
        label: t('cpq.orders.filters.status', 'Status'),
        type: 'select',
        options: statusOptions,
      },
      {
        id: 'currencyCode',
        label: t('cpq.orders.filters.currency', 'Currency'),
        type: 'text',
      },
    ],
    [statusOptions, t],
  )

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort?.id) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    if (typeof filterValues.cpqStatus === 'string' && filterValues.cpqStatus) {
      params.set('cpqStatus', filterValues.cpqStatus)
    }
    if (typeof filterValues.currencyCode === 'string' && filterValues.currencyCode.trim()) {
      params.set('currencyCode', filterValues.currencyCode.trim().toUpperCase())
    }
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: OrdersResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<OrdersResponse>(
          `/api/cpq/orders?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.orders.list.error.load', 'Failed to load orders'), 'error')
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [queryString, reloadToken, t])

  const columns = React.useMemo<ColumnDef<OrderConfig>[]>(
    () => [
      {
        id: 'orderNumber',
        header: t('cpq.orders.table.order', 'Order'),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-primary">
            {row.original.orderNumber ?? `${row.original.orderId?.slice(0, 8)}…`}
          </span>
        ),
      },
      {
        accessorKey: 'cpqStatus',
        header: t('cpq.orders.table.status', 'Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_COLORS[row.original.cpqStatus] ?? 'bg-gray-100 text-gray-800'
            }`}
          >
            {row.original.cpqStatus.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        accessorKey: 'currencyCode',
        header: t('cpq.orders.table.currency', 'Currency'),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.currencyCode}</span>,
      },
      {
        id: 'nrcTotal',
        header: t('cpq.orders.table.nrcTotal', 'NRC Total'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmt(row.original.pricingSummary?.nrcTotal, row.original.currencyCode)}
          </span>
        ),
      },
      {
        id: 'mrcTotal',
        header: t('cpq.orders.table.mrcTotal', 'MRC Total'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmt(row.original.pricingSummary?.mrcTotal, row.original.currencyCode)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('cpq.orders.table.createdAt', 'Created'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
      {
        accessorKey: 'activatedAt',
        header: t('cpq.orders.table.activatedAt', 'Activated'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.activatedAt ? new Date(row.original.activatedAt).toLocaleDateString() : '—'}
          </span>
        ),
      },
    ],
    [t],
  )

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return (
    <Page>
      <PageBody className="space-y-6">
        <DataTable<OrderConfig>
          title={t('cpq.orders.list.title', 'CPQ Orders')}
          refreshButton={{
            label: t('cpq.orders.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('cpq.orders.search.placeholder', 'Search by order / customer id...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          onRowClick={(row) => router.push(`/backend/cpq/orders/${row.id}`)}
          perspective={{ tableId: 'cpq.orders.list' }}
          columnChooser={{ auto: true }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          isLoading={isLoading}
          emptyState={
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              {t(
                'cpq.orders.empty',
                'No CPQ orders found. Convert an accepted quote to create an order.',
              )}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}
