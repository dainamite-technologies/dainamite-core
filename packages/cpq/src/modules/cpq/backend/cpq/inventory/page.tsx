"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

// ─── Types ───────────────────────────────────────────────────────

type Subscription = {
  id: string
  code: string
  name: string
  status: string
  mrcAmount: number
  nrcAmount: number
  billingCycle: string
  currencyCode: string
  startDate: string
  currentTermEnd: string | null
}

type Asset = {
  id: string
  code: string
  name: string
  status: string
  assetType: string
  purchasePrice: number
  currencyCode: string
  createdAt: string
}

type PaginatedResponse<T> = {
  items?: T[]
  total?: number
  totalPages?: number
}

type TabKey = 'subscriptions' | 'assets'

const PAGE_SIZE = 50

// ─── Helpers ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-blue-100 text-blue-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  terminated: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
  delivered: 'bg-teal-100 text-teal-800',
  returned: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {status}
    </span>
  )
}

// ─── Subscriptions table ─────────────────────────────────────────

function SubscriptionsTable() {
  const t = useT()
  const router = useRouter()

  const [rows, setRows] = React.useState<Subscription[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const subStatusOptions = React.useMemo(
    () => [
      { value: 'pending', label: 'Pending' },
      { value: 'active', label: 'Active' },
      { value: 'suspended', label: 'Suspended' },
      { value: 'terminated', label: 'Terminated' },
      { value: 'expired', label: 'Expired' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    [],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('cpq.inventory.filters.status', 'Status'),
        type: 'select',
        options: subStatusOptions,
      },
      {
        id: 'billingCycle',
        label: t('cpq.inventory.filters.billingCycle', 'Billing Cycle'),
        type: 'text',
      },
    ],
    [subStatusOptions, t],
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
    if (typeof filterValues.status === 'string' && filterValues.status) {
      params.set('status', filterValues.status)
    }
    if (typeof filterValues.billingCycle === 'string' && filterValues.billingCycle.trim()) {
      params.set('billingCycle', filterValues.billingCycle.trim())
    }
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: PaginatedResponse<Subscription> = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PaginatedResponse<Subscription>>(
          `/api/cpq/inventory/subscriptions?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.inventory.subscriptions.error.load', 'Failed to load subscriptions'), 'error')
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

  const columns = React.useMemo<ColumnDef<Subscription>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('cpq.inventory.subscriptions.table.code', 'Code'),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: 'name',
        header: t('cpq.inventory.subscriptions.table.name', 'Name'),
        cell: ({ row }) => <span className="font-medium text-primary">{row.original.name}</span>,
      },
      {
        accessorKey: 'status',
        header: t('cpq.inventory.subscriptions.table.status', 'Status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'mrc',
        header: t('cpq.inventory.subscriptions.table.mrc', 'MRC'),
        cell: ({ row }) => (
          <span className="font-mono">
            {fmt(row.original.mrcAmount, row.original.currencyCode || 'USD')}
          </span>
        ),
      },
      {
        accessorKey: 'billingCycle',
        header: t('cpq.inventory.subscriptions.table.billing', 'Billing'),
      },
      {
        accessorKey: 'startDate',
        header: t('cpq.inventory.subscriptions.table.startDate', 'Start Date'),
        cell: ({ row }) => (
          <span>
            {row.original.startDate ? new Date(row.original.startDate).toLocaleDateString() : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'currentTermEnd',
        header: t('cpq.inventory.subscriptions.table.termEnd', 'Term End'),
        cell: ({ row }) => (
          <span>
            {row.original.currentTermEnd
              ? new Date(row.original.currentTermEnd).toLocaleDateString()
              : '—'}
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <DataTable<Subscription>
      title={t('cpq.inventory.subscriptions', 'Subscriptions')}
      refreshButton={{
        label: t('cpq.inventory.actions.refresh', 'Refresh'),
        onRefresh: () => setReloadToken((token) => token + 1),
        isRefreshing: isLoading,
      }}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('cpq.inventory.subscriptions.search.placeholder', 'Search subscriptions...')}
      filters={filters}
      filterValues={filterValues}
      onFiltersApply={(values) => {
        setFilterValues(values)
        setPage(1)
      }}
      onFiltersClear={() => {
        setFilterValues({})
        setPage(1)
      }}
      sorting={sorting}
      onSortingChange={setSorting}
      onRowClick={(row) => router.push(`/backend/cpq/inventory/subscriptions/${row.id}`)}
      perspective={{ tableId: 'cpq.inventory.subscriptions.list' }}
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
          {t('cpq.inventory.subscriptions.empty', 'No subscriptions found.')}
        </div>
      }
    />
  )
}

// ─── Assets table ────────────────────────────────────────────────

function AssetsTable() {
  const t = useT()
  const router = useRouter()

  const [rows, setRows] = React.useState<Asset[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const assetStatusOptions = React.useMemo(
    () => [
      { value: 'pending', label: 'Pending' },
      { value: 'delivered', label: 'Delivered' },
      { value: 'active', label: 'Active' },
      { value: 'returned', label: 'Returned' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    [],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('cpq.inventory.filters.status', 'Status'),
        type: 'select',
        options: assetStatusOptions,
      },
      {
        id: 'assetType',
        label: t('cpq.inventory.filters.assetType', 'Asset Type'),
        type: 'text',
      },
    ],
    [assetStatusOptions, t],
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
    if (typeof filterValues.status === 'string' && filterValues.status) {
      params.set('status', filterValues.status)
    }
    if (typeof filterValues.assetType === 'string' && filterValues.assetType.trim()) {
      params.set('assetType', filterValues.assetType.trim())
    }
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: PaginatedResponse<Asset> = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PaginatedResponse<Asset>>(
          `/api/cpq/inventory/assets?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.inventory.assets.error.load', 'Failed to load assets'), 'error')
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

  const columns = React.useMemo<ColumnDef<Asset>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('cpq.inventory.assets.table.code', 'Code'),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: 'name',
        header: t('cpq.inventory.assets.table.name', 'Name'),
        cell: ({ row }) => <span className="font-medium text-primary">{row.original.name}</span>,
      },
      {
        accessorKey: 'assetType',
        header: t('cpq.inventory.assets.table.type', 'Type'),
      },
      {
        accessorKey: 'status',
        header: t('cpq.inventory.assets.table.status', 'Status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'purchasePrice',
        header: t('cpq.inventory.assets.table.price', 'Price'),
        cell: ({ row }) => (
          <span className="font-mono">
            {fmt(row.original.purchasePrice, row.original.currencyCode || 'USD')}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('cpq.inventory.assets.table.created', 'Created'),
        cell: ({ row }) => (
          <span>
            {row.original.createdAt ? new Date(row.original.createdAt).toLocaleDateString() : '—'}
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <DataTable<Asset>
      title={t('cpq.inventory.assets', 'Assets')}
      refreshButton={{
        label: t('cpq.inventory.actions.refresh', 'Refresh'),
        onRefresh: () => setReloadToken((token) => token + 1),
        isRefreshing: isLoading,
      }}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('cpq.inventory.assets.search.placeholder', 'Search assets...')}
      filters={filters}
      filterValues={filterValues}
      onFiltersApply={(values) => {
        setFilterValues(values)
        setPage(1)
      }}
      onFiltersClear={() => {
        setFilterValues({})
        setPage(1)
      }}
      sorting={sorting}
      onSortingChange={setSorting}
      onRowClick={(row) => router.push(`/backend/cpq/inventory/assets/${row.id}`)}
      perspective={{ tableId: 'cpq.inventory.assets.list' }}
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
          {t('cpq.inventory.assets.empty', 'No assets found.')}
        </div>
      }
    />
  )
}

// ─── Page ────────────────────────────────────────────────────────

export default function InventoryPage() {
  const t = useT()
  const [activeTab, setActiveTab] = React.useState<TabKey>('subscriptions')

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'subscriptions', label: t('cpq.inventory.subscriptions', 'Subscriptions') },
    { key: 'assets', label: t('cpq.inventory.assets', 'Assets') },
  ]

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('cpq.inventory.title', 'Customer Inventory')}</h1>
        </div>

        <div className="flex gap-1 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'subscriptions' ? <SubscriptionsTable /> : <AssetsTable />}
      </PageBody>
    </Page>
  )
}
