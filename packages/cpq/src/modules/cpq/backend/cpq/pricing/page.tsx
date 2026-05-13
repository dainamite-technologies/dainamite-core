"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type PricingTable = {
  id: string
  code: string
  name: string
  priceColumns: Array<{ key: string; label: string }>
  currencyCodeList: string[]
  isActive: boolean
}

type PricingTablesResponse = {
  items?: PricingTable[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 50

export default function PricingTablesPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<PricingTable[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'isActive',
        label: t('cpq.pricing.filters.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [t],
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
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: PricingTablesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PricingTablesResponse>(
          `/api/cpq/pricing-tables?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.pricing.list.error.load', 'Failed to load pricing tables'), 'error')
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

  const columns = React.useMemo<ColumnDef<PricingTable>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('cpq.pricing.name', 'Name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'code',
        header: t('cpq.pricing.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        id: 'priceColumns',
        header: t('cpq.pricing.priceColumns', 'Price Columns'),
        cell: ({ row }) => <span>{row.original.priceColumns?.length ?? 0}</span>,
      },
      {
        id: 'currencies',
        header: t('cpq.pricing.currencies', 'Currencies'),
        cell: ({ row }) => <span>{row.original.currencyCodeList?.join(', ') ?? '—'}</span>,
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.pricing.status', 'Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              row.original.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}
          >
            {row.original.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
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

  const deleteSelected = React.useCallback(
    async (selectedRows: PricingTable[]) => {
      if (!selectedRows.length) return { ok: false as const }
      const confirmed = await confirm({
        title: t(
          'cpq.pricing.bulk.deleteConfirm',
          `Delete ${selectedRows.length} pricing table${selectedRows.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false as const }
      let failed = 0
      for (const row of selectedRows) {
        const res = await fetch('/api/cpq/pricing-tables', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        if (!res.ok) failed += 1
      }
      if (failed > 0) {
        flash(
          t('cpq.pricing.flash.deleteFailed', `Failed to delete ${failed} pricing table(s)`),
          'error',
        )
      } else {
        flash(t('cpq.pricing.flash.deleted', 'Pricing tables deleted'), 'success')
      }
      setReloadToken((token) => token + 1)
      return { ok: failed === 0, affectedCount: selectedRows.length - failed }
    },
    [confirm, t],
  )

  const bulkActions = React.useMemo<BulkAction<PricingTable>[]>(
    () => [
      {
        id: 'delete',
        label: t('cpq.pricing.bulk.deleteSelected', 'Delete selected'),
        destructive: true,
        onExecute: deleteSelected,
      },
    ],
    [deleteSelected, t],
  )

  return (
    <Page>
      <PageBody className="space-y-6">
        <DataTable<PricingTable>
          title={t('cpq.pricing.list.title', 'Pricing Tables')}
          actions={
            <Button asChild>
              <a href="/backend/cpq/pricing/new">
                {t('cpq.pricing.add', 'New Pricing Table')}
              </a>
            </Button>
          }
          refreshButton={{
            label: t('cpq.pricing.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('cpq.pricing.search.placeholder', 'Search pricing tables...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          bulkActions={bulkActions}
          selectionScopeKey="cpq.pricing"
          onRowClick={(row) => router.push(`/backend/cpq/pricing/${row.id}`)}
          perspective={{ tableId: 'cpq.pricing.list' }}
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
              {t('cpq.pricing.empty', 'No pricing tables found.')}
            </div>
          }
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
