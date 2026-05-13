"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type Specification = {
  id: string
  productId: string
  code: string
  name: string
  description: string | null
  specType: string
  isAssetizable: boolean
  lifecycleStatus: string
  version: number
  isActive: boolean
  createdAt: string
}

type SpecificationsResponse = {
  items?: Specification[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  deprecated: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-red-100 text-red-700',
}

export default function SpecificationsListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<Specification[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const lifecycleOptions = React.useMemo(
    () => [
      { value: 'draft', label: t('cpq.specifications.lifecycle.draft', 'Draft') },
      { value: 'active', label: t('cpq.specifications.lifecycle.active', 'Active') },
      { value: 'deprecated', label: t('cpq.specifications.lifecycle.deprecated', 'Deprecated') },
      { value: 'retired', label: t('cpq.specifications.lifecycle.retired', 'Retired') },
    ],
    [t],
  )

  const specTypeOptions = React.useMemo(
    () => [
      { value: 'simple', label: t('cpq.specifications.type.simple', 'Simple') },
      { value: 'bundle', label: t('cpq.specifications.type.bundle', 'Bundle') },
    ],
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'lifecycleStatus',
        label: t('cpq.specifications.filters.lifecycleStatus', 'Lifecycle Status'),
        type: 'select',
        options: lifecycleOptions,
      },
      {
        id: 'specType',
        label: t('cpq.specifications.filters.specType', 'Type'),
        type: 'select',
        options: specTypeOptions,
      },
      {
        id: 'isActive',
        label: t('cpq.specifications.filters.isActive', 'Active'),
        type: 'checkbox',
      },
      {
        id: 'isAssetizable',
        label: t('cpq.specifications.filters.isAssetizable', 'Assetizable'),
        type: 'checkbox',
      },
    ],
    [lifecycleOptions, specTypeOptions, t],
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
    if (typeof filterValues.lifecycleStatus === 'string' && filterValues.lifecycleStatus) {
      params.set('lifecycleStatus', filterValues.lifecycleStatus)
    }
    if (typeof filterValues.specType === 'string' && filterValues.specType) {
      params.set('specType', filterValues.specType)
    }
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    if (filterValues.isAssetizable === true) params.set('isAssetizable', 'true')
    if (filterValues.isAssetizable === false) params.set('isAssetizable', 'false')
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: SpecificationsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<SpecificationsResponse>(
          `/api/cpq/product-specifications?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.specifications.list.error.load', 'Failed to load specifications'), 'error')
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

  const columns = React.useMemo<ColumnDef<Specification>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('cpq.specifications.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: 'name',
        header: t('cpq.specifications.name', 'Name'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.name}
            {row.original.specType === 'bundle' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px] font-medium">
                bundle
              </span>
            )}
            {row.original.isAssetizable && (
              <span className="ml-1 inline-flex items-center rounded-full bg-orange-100 text-orange-800 px-2 py-0.5 text-[10px] font-medium">
                asset
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.specifications.isActive', 'Is Active?'),
        cell: ({ row }) => <Checkbox checked={row.original.isActive} disabled />,
      },
      {
        accessorKey: 'lifecycleStatus',
        header: t('cpq.specifications.lifecycleStatus', 'Lifecycle Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_COLORS[row.original.lifecycleStatus] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {row.original.lifecycleStatus}
          </span>
        ),
      },
      {
        accessorKey: 'version',
        header: t('cpq.specifications.version', 'Version'),
        cell: ({ row }) => <span>v{row.original.version}</span>,
      },
      {
        accessorKey: 'description',
        header: t('cpq.specifications.description', 'Description'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.description ?? '—'}</span>
        ),
        meta: { truncate: true, maxWidth: 320 },
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
    async (selectedRows: Specification[]) => {
      if (!selectedRows.length) return { ok: false as const }
      const confirmed = await confirm({
        title: t(
          'cpq.specifications.bulk.deleteConfirm',
          `Delete ${selectedRows.length} specification${selectedRows.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false as const }
      let failed = 0
      for (const row of selectedRows) {
        const res = await fetch('/api/cpq/product-specifications', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        if (!res.ok) failed += 1
      }
      if (failed > 0) {
        flash(
          t('cpq.specifications.flash.deleteFailed', `Failed to delete ${failed} specification(s)`),
          'error',
        )
      } else {
        flash(t('cpq.specifications.flash.deleted', 'Specifications deleted'), 'success')
      }
      setReloadToken((token) => token + 1)
      return { ok: failed === 0, affectedCount: selectedRows.length - failed }
    },
    [confirm, t],
  )

  const bulkActions = React.useMemo<BulkAction<Specification>[]>(
    () => [
      {
        id: 'delete',
        label: t('cpq.specifications.bulk.deleteSelected', 'Delete selected'),
        destructive: true,
        onExecute: deleteSelected,
      },
    ],
    [deleteSelected, t],
  )

  return (
    <Page>
      <PageBody className="space-y-6">
        <DataTable<Specification>
          title={t('cpq.specifications.list.title', 'Product Specifications')}
          actions={
            <Button asChild>
              <a href="/backend/cpq/specifications/new">
                {t('cpq.specifications.add', 'New Specification')}
              </a>
            </Button>
          }
          refreshButton={{
            label: t('cpq.specifications.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('cpq.specifications.search.placeholder', 'Search specifications...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          bulkActions={bulkActions}
          selectionScopeKey="cpq.specifications"
          onRowClick={(row) => router.push(`/backend/cpq/specifications/${row.id}`)}
          perspective={{ tableId: 'cpq.specifications.list' }}
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
                'cpq.specifications.empty',
                'No product specifications found. Create one to define your product catalogue.',
              )}
            </div>
          }
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
