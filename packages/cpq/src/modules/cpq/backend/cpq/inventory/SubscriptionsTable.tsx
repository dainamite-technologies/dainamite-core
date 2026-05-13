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

const PAGE_SIZE = 50

const SUBSCRIPTION_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.status === 'string' && values.status) {
    params.set('status', values.status)
  }
  if (typeof values.billingCycle === 'string' && values.billingCycle.trim()) {
    params.set('billingCycle', values.billingCycle.trim())
  }
}

export function SubscriptionsTable() {
  const t = useT()
  const router = useRouter()

  const data = useCpqListData<Subscription>({
    endpoint: '/api/cpq/inventory/subscriptions',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.inventory.subscriptions.error.load', 'Failed to load subscriptions'),
  })

  // Subscriptions are lifecycle-managed; deleting an active one usually means
  // "terminate", which the API rejects. Allow deletion only from non-active
  // states so the row-actions menu doesn't dangle a useless "Delete" item.
  const rowActionsApi = useCpqRowActions<Subscription>({
    endpoint: '/api/cpq/inventory/subscriptions',
    entityName: t('cpq.inventory.subscriptions.entityName', 'subscription'),
    editHref: (row) => `/backend/cpq/inventory/subscriptions/${row.id}`,
    onReload: data.reload,
    canDelete: (row) => row.status !== 'active',
  })

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('cpq.inventory.filters.status', 'Status'),
        type: 'select',
        options: [...SUBSCRIPTION_STATUS_OPTIONS],
      },
      {
        id: 'billingCycle',
        label: t('cpq.inventory.filters.billingCycle', 'Billing Cycle'),
        type: 'text',
      },
    ],
    [t],
  )

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
            {formatCurrency(row.original.mrcAmount, row.original.currencyCode || 'USD')}
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
    <>
      {rowActionsApi.ConfirmDialogElement}
      <DataTable<Subscription>
      title={t('cpq.inventory.subscriptions', 'Subscriptions')}
      refreshButton={{
        label: t('cpq.inventory.actions.refresh', 'Refresh'),
        onRefresh: data.reload,
        isRefreshing: data.isLoading,
      }}
      columns={columns}
      data={data.rows}
      searchValue={data.search}
      onSearchChange={data.setSearch}
      searchPlaceholder={t('cpq.inventory.subscriptions.search.placeholder', 'Search subscriptions...')}
      filters={filters}
      filterValues={data.filterValues}
      onFiltersApply={data.setFilterValues}
      onFiltersClear={data.clearFilters}
      sorting={data.sorting}
      onSortingChange={data.setSorting}
      onRowClick={(row) => router.push(`/backend/cpq/inventory/subscriptions/${row.id}`)}
      rowActions={(row) => <RowActions items={rowActionsApi.buildItems(row)} />}
      perspective={{ tableId: 'cpq.inventory.subscriptions.list' }}
      columnChooser={{ auto: true }}
      pagination={{
        page: data.page,
        pageSize: PAGE_SIZE,
        total: data.total,
        totalPages: data.totalPages,
        onPageChange: data.setPage,
        durationMs: data.durationMs,
      }}
      isLoading={data.isLoading}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.inventory.subscriptions.empty', 'No subscriptions found.')}
        </div>
      }
    />
    </>
  )
}
