"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'

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

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.cpqStatus === 'string' && values.cpqStatus) {
    params.set('cpqStatus', values.cpqStatus)
  }
  if (typeof values.currencyCode === 'string' && values.currencyCode.trim()) {
    params.set('currencyCode', values.currencyCode.trim().toUpperCase())
  }
}

export default function CpqOrdersListPage() {
  const router = useRouter()
  const t = useT()

  const data = useCpqListData<OrderConfig>({
    endpoint: '/api/cpq/orders',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.orders.list.error.load', 'Failed to load orders'),
  })

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

  return (
    <CpqListView<OrderConfig>
      title={t('cpq.orders.list.title', 'CPQ Orders')}
      tableId="cpq.orders.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.orders.search.placeholder', 'Search by order / customer id...')}
      onRowClick={(row) => router.push(`/backend/cpq/orders/${row.id}`)}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(
            'cpq.orders.empty',
            'No CPQ orders found. Convert an accepted quote to create an order.',
          )}
        </div>
      }
    />
  )
}
