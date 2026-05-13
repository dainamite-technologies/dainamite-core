"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useCpqListData } from '../../../components/CpqListView'
import { useCpqRowActions } from '../../../components/useCpqRowActions'
import { StatusBadge, formatCurrency } from './shared'

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

const PAGE_SIZE = 50

const ASSET_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'active', label: 'Active' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.status === 'string' && values.status) {
    params.set('status', values.status)
  }
  if (typeof values.assetType === 'string' && values.assetType.trim()) {
    params.set('assetType', values.assetType.trim())
  }
}

export function AssetsTable() {
  const t = useT()
  const router = useRouter()

  const data = useCpqListData<Asset>({
    endpoint: '/api/cpq/inventory/assets',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.inventory.assets.error.load', 'Failed to load assets'),
  })

  // Assets follow a `delivered → active → returned` lifecycle; deletion only
  // makes sense before the asset is provisioned, so gate by status.
  const rowActionsApi = useCpqRowActions<Asset>({
    endpoint: '/api/cpq/inventory/assets',
    entityName: t('cpq.inventory.assets.entityName', 'asset'),
    editHref: (row) => `/backend/cpq/inventory/assets/${row.id}`,
    onReload: data.reload,
    canDelete: (row) => row.status === 'pending' || row.status === 'cancelled',
  })

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('cpq.inventory.filters.status', 'Status'),
        type: 'select',
        options: [...ASSET_STATUS_OPTIONS],
      },
      {
        id: 'assetType',
        label: t('cpq.inventory.filters.assetType', 'Asset Type'),
        type: 'text',
      },
    ],
    [t],
  )

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
            {formatCurrency(row.original.purchasePrice, row.original.currencyCode || 'USD')}
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
    <>
      {rowActionsApi.ConfirmDialogElement}
      <DataTable<Asset>
      title={t('cpq.inventory.assets', 'Assets')}
      refreshButton={{
        label: t('cpq.inventory.actions.refresh', 'Refresh'),
        onRefresh: data.reload,
        isRefreshing: data.isLoading,
      }}
      columns={columns}
      data={data.rows}
      searchValue={data.search}
      onSearchChange={data.setSearch}
      searchPlaceholder={t('cpq.inventory.assets.search.placeholder', 'Search assets...')}
      filters={filters}
      filterValues={data.filterValues}
      onFiltersApply={data.setFilterValues}
      onFiltersClear={data.clearFilters}
      sorting={data.sorting}
      onSortingChange={data.setSorting}
      onRowClick={(row) => router.push(`/backend/cpq/inventory/assets/${row.id}`)}
      rowActions={(row) => <RowActions items={rowActionsApi.buildItems(row)} />}
      perspective={{ tableId: 'cpq.inventory.assets.list' }}
      columnChooser={{ auto: true }}
      pagination={{
        page: data.page,
        pageSize: PAGE_SIZE,
        total: data.total,
        totalPages: data.totalPages,
        onPageChange: data.setPage,
      }}
      isLoading={data.isLoading}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.inventory.assets.empty', 'No assets found.')}
        </div>
      }
    />
    </>
  )
}
