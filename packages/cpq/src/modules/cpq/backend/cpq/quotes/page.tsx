"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Plus, Search as SearchIcon } from 'lucide-react'

type QuoteConfig = {
  id: string
  quoteId: string
  customerId: string
  cpqStatus: string
  version: number
  currencyCode: string
  pricingSummary: {
    nrcTotal?: number
    mrcTotal?: number
  } | null
  createdAt: string
  updatedAt: string
}

type Customer = {
  id: string
  display_name?: string
  displayName?: string
  name?: string
  companyName?: string
  primary_email?: string
  primaryEmail?: string
}

type QuotesResponse = {
  items?: QuoteConfig[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  incomplete: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  in_approval: 'bg-purple-100 text-purple-800',
  approved: 'bg-green-100 text-green-800',
  with_customer: 'bg-sky-100 text-sky-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

function fmt(amount: number | undefined, currency: string): string {
  if (amount == null || amount === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export default function CpqQuotesListPage() {
  const router = useRouter()
  const t = useT()

  const [rows, setRows] = React.useState<QuoteConfig[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const [showCustomerPicker, setShowCustomerPicker] = React.useState(false)
  const [customers, setCustomers] = React.useState<Customer[]>([])
  const [customersLoading, setCustomersLoading] = React.useState(false)
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const statusOptions = React.useMemo(
    () => [
      { value: 'new', label: 'New' },
      { value: 'incomplete', label: 'Incomplete' },
      { value: 'ready', label: 'Ready' },
      { value: 'in_approval', label: 'In Approval' },
      { value: 'approved', label: 'Approved' },
      { value: 'with_customer', label: 'With Customer' },
      { value: 'accepted', label: 'Accepted' },
      { value: 'rejected', label: 'Rejected' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    [],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'cpqStatus',
        label: t('cpq.quotes.filters.status', 'Status'),
        type: 'select',
        options: statusOptions,
      },
      {
        id: 'currencyCode',
        label: t('cpq.quotes.filters.currency', 'Currency'),
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
        const fallback: QuotesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<QuotesResponse>(
          `/api/cpq/quotes?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.quotes.list.error.load', 'Failed to load quotes'), 'error')
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

  const openCustomerPicker = async () => {
    setShowCustomerPicker(true)
    setCustomerSearch('')
    setCustomersLoading(true)
    try {
      const res = await fetch('/api/customers/companies?pageSize=100')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data.items ?? data ?? [])
      }
    } catch {
      setCustomers([])
    } finally {
      setCustomersLoading(false)
    }
  }

  const selectCustomer = async (customer: Customer) => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/cpq/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id }),
      })
      const data = await res.json()
      if (res.ok) {
        setShowCustomerPicker(false)
        router.push(`/backend/cpq/quotes/${data.id}`)
      } else {
        setCreateError(data.error ?? `Failed to create quote (${res.status})`)
      }
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const getCustomerLabel = (c: Customer) =>
    c.display_name || c.displayName || c.name || c.companyName || 'Unnamed'
  const getCustomerEmail = (c: Customer) => c.primary_email || c.primaryEmail || ''

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch.trim()) return true
    const q = customerSearch.toLowerCase()
    return (
      getCustomerLabel(c).toLowerCase().includes(q) ||
      getCustomerEmail(c).toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    )
  })

  const columns = React.useMemo<ColumnDef<QuoteConfig>[]>(
    () => [
      {
        accessorKey: 'quoteId',
        header: t('cpq.quotes.table.quoteId', 'Quote ID'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-primary">
            {(row.original.quoteId ?? row.original.id).slice(0, 8)}…
          </span>
        ),
      },
      {
        accessorKey: 'cpqStatus',
        header: t('cpq.quotes.table.status', 'Status'),
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
        accessorKey: 'version',
        header: t('cpq.quotes.table.version', 'Version'),
        cell: ({ row }) => <span className="text-muted-foreground">v{row.original.version}</span>,
      },
      {
        accessorKey: 'currencyCode',
        header: t('cpq.quotes.table.currency', 'Currency'),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.currencyCode}</span>,
      },
      {
        id: 'nrcTotal',
        header: t('cpq.quotes.table.nrcTotal', 'NRC Total'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmt(row.original.pricingSummary?.nrcTotal, row.original.currencyCode)}
          </span>
        ),
      },
      {
        id: 'mrcTotal',
        header: t('cpq.quotes.table.mrcTotal', 'MRC Total'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {fmt(row.original.pricingSummary?.mrcTotal, row.original.currencyCode)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('cpq.quotes.table.createdAt', 'Created'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
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
        {showCustomerPicker && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => !creating && setShowCustomerPicker(false)}
          >
            <div
              className="w-full max-w-lg rounded-lg border bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="text-sm font-medium">Select Customer for New Quote</h3>
                <button
                  onClick={() => setShowCustomerPicker(false)}
                  disabled={creating}
                  className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none"
                >
                  &times;
                </button>
              </div>
              <div className="p-4 space-y-3">
                {createError && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    {createError}
                  </div>
                )}
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search customers…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    autoFocus
                    className="pl-10"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {customersLoading ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Loading customers…
                    </div>
                  ) : filteredCustomers.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {customerSearch
                        ? 'No customers match your search.'
                        : 'No customers found.'}
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectCustomer(c)}
                        disabled={creating}
                        className="w-full rounded-md border px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                      >
                        <p className="text-sm font-medium">{getCustomerLabel(c)}</p>
                        {getCustomerEmail(c) && (
                          <p className="text-xs text-muted-foreground mt-0.5">{getCustomerEmail(c)}</p>
                        )}
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.id}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <DataTable<QuoteConfig>
          title={t('cpq.quotes.list.title', 'CPQ Quotes')}
          actions={
            <Button type="button" onClick={openCustomerPicker} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {t('cpq.quotes.add', 'New Quote')}
            </Button>
          }
          refreshButton={{
            label: t('cpq.quotes.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('cpq.quotes.search.placeholder', 'Search by quote / customer id...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          onRowClick={(row) => router.push(`/backend/cpq/quotes/${row.id}`)}
          perspective={{ tableId: 'cpq.quotes.list' }}
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
                'cpq.quotes.empty',
                'No CPQ quotes found. Create one to start configuring offerings for a customer.',
              )}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}
