"use client"
import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Billing Items admin list.
 *
 * Filters: type (one_time / recurring / usage), bill account, active.
 * Items are typically integration-driven (CPQ connector creates them
 * on subscription events), so the most common UI use is *inspecting*
 * what's there — but the "New item" CTA is available for manual
 * entry / one-off adjustments.
 */

// API list rows are snake_case (see `api/items/route.ts` `fields`).
type BillingItemRow = {
  id: string
  bill_account_id: string
  type: 'one_time' | 'recurring' | 'usage'
  description: string
  bill_start_date: string
  bill_end_date: string | null
  uom_code: string | null
  subscription_id: string | null
  source_ref: string | null
  is_active: boolean
  created_at: string
}

type ListResponse = {
  items: BillingItemRow[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function typeVariant(
  type: BillingItemRow['type'],
): 'default' | 'success' | 'warning' | 'info' {
  switch (type) {
    case 'recurring':
      return 'success'
    case 'one_time':
      return 'warning'
    case 'usage':
      return 'info'
    default:
      return 'default'
  }
}

export default function BillingItemsListPage() {
  const t = useT()
  const searchParams = useSearchParams()
  // Deep-link from the account detail page: `?billAccountId=<id>` pre-
  // filters the list so the operator lands on "items for this account".
  const initialAccountId = searchParams.get('billAccountId') ?? ''

  const [rows, setRows] = React.useState<BillingItemRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [filters, setFilters] = React.useState<FilterValues>(
    initialAccountId ? { billAccountId: initialAccountId } : {},
  )
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'type',
        label: t('billing.items.filters.type', 'Type'),
        type: 'select',
        options: [
          { value: 'one_time', label: t('billing.items.type.one_time', 'One-time') },
          { value: 'recurring', label: t('billing.items.type.recurring', 'Recurring') },
          { value: 'usage', label: t('billing.items.type.usage', 'Usage') },
        ],
      },
      {
        id: 'billAccountId',
        label: t('billing.items.filters.account', 'Billing Account ID'),
        type: 'text',
      },
      {
        id: 'subscriptionId',
        label: t('billing.items.filters.subscription', 'Subscription ID'),
        type: 'text',
      },
      {
        id: 'isActive',
        label: t('billing.items.filters.active', 'Active'),
        type: 'select',
        options: [
          { value: 'true', label: t('billing.common.active', 'Active') },
          { value: 'false', label: t('billing.common.inactive', 'Inactive') },
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
      if (typeof filters.type === 'string' && filters.type) {
        params.set('type', filters.type)
      }
      if (typeof filters.billAccountId === 'string' && filters.billAccountId.trim()) {
        params.set('billAccountId', filters.billAccountId.trim())
      }
      if (typeof filters.subscriptionId === 'string' && filters.subscriptionId.trim()) {
        params.set('subscriptionId', filters.subscriptionId.trim())
      }
      if (filters.isActive === 'true' || filters.isActive === 'false') {
        params.set('isActive', String(filters.isActive))
      }
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/items?${params.toString()}`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [filters.billAccountId, filters.isActive, filters.subscriptionId, filters.type, page, pageSize, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<BillingItemRow>[]>(
    () => [
      {
        accessorKey: 'type',
        header: t('billing.items.columns.type', 'Type'),
        cell: ({ row }) => (
          <Tag variant={typeVariant(row.original.type)}>{row.original.type}</Tag>
        ),
      },
      {
        accessorKey: 'description',
        header: t('billing.items.columns.description', 'Description'),
      },
      {
        accessorKey: 'bill_account_id',
        header: t('billing.items.columns.account', 'Account'),
        cell: ({ row }) => (
          <Link
            href={`/backend/billing/accounts/${row.original.bill_account_id}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            {row.original.bill_account_id.slice(0, 8)}…
          </Link>
        ),
      },
      {
        accessorKey: 'bill_start_date',
        header: t('billing.items.columns.start', 'Start'),
        cell: ({ row }) => formatDate(row.original.bill_start_date),
      },
      {
        accessorKey: 'bill_end_date',
        header: t('billing.items.columns.end', 'End'),
        cell: ({ row }) => formatDate(row.original.bill_end_date),
      },
      {
        accessorKey: 'uom_code',
        header: t('billing.items.columns.uom', 'UoM'),
        cell: ({ row }) => row.original.uom_code ?? '—',
      },
      {
        accessorKey: 'is_active',
        header: t('billing.items.columns.status', 'Status'),
        cell: ({ row }) =>
          row.original.is_active ? (
            <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Link
            href={`/backend/billing/items/${row.original.id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('billing.items.actions.open', 'Open')}
          </Link>
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.items.title', 'Billing Items')}
          actions={
            <Button asChild>
              <Link href="/backend/billing/items/create">
                <Plus size={16} />
                {t('billing.items.create.action', 'New item')}
              </Link>
            </Button>
          }
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-items' }}
          columns={columns}
          data={rows}
          isLoading={loading}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
          }}
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
