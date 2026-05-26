"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
 * Billing Accounts admin list.
 *
 * Search + filter by bill cycle / currency / active state. The
 * "New account" CTA opens the create page; rows link into the detail
 * page for inspect + edit + soft-delete.
 */

// API list rows are snake_case — the billing list endpoints project
// raw column names (see `api/accounts/route.ts` `fields`).
type BillingAccountRow = {
  id: string
  customer_id: string
  name: string
  currency_code: string
  bill_cycle: 'monthly' | 'quarterly' | 'annually' | 'weekly'
  bill_cycle_anchor: string
  invoice_email: string
  next_bill_date: string
  last_bill_date: string | null
  is_active: boolean
  created_at: string
}

type ListResponse = {
  items: BillingAccountRow[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

export default function BillingAccountsListPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<BillingAccountRow[]>([])
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
        id: 'billCycle',
        label: t('billing.accounts.filters.cycle', 'Bill cycle'),
        type: 'select',
        options: [
          { value: 'weekly', label: t('billing.cycle.weekly', 'Weekly') },
          { value: 'monthly', label: t('billing.cycle.monthly', 'Monthly') },
          { value: 'quarterly', label: t('billing.cycle.quarterly', 'Quarterly') },
          { value: 'annually', label: t('billing.cycle.annually', 'Annually') },
        ],
      },
      {
        id: 'currencyCode',
        label: t('billing.accounts.filters.currency', 'Currency'),
        type: 'text',
      },
      {
        id: 'isActive',
        label: t('billing.accounts.filters.active', 'Active'),
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
      if (typeof filters.billCycle === 'string' && filters.billCycle) {
        params.set('billCycle', filters.billCycle)
      }
      if (typeof filters.currencyCode === 'string' && filters.currencyCode.trim()) {
        params.set('currencyCode', filters.currencyCode.trim().toUpperCase())
      }
      if (filters.isActive === 'true') params.set('isActive', 'true')
      if (filters.isActive === 'false') params.set('isActive', 'false')
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/accounts?${params.toString()}`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [filters.billCycle, filters.currencyCode, filters.isActive, page, pageSize, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<BillingAccountRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('billing.accounts.columns.name', 'Name'),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-primary">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'customer_id',
        header: t('billing.accounts.columns.customer', 'Customer'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.customer_id}</span>
        ),
      },
      {
        accessorKey: 'currency_code',
        header: t('billing.accounts.columns.currency', 'Currency'),
      },
      {
        accessorKey: 'bill_cycle',
        header: t('billing.accounts.columns.cycle', 'Cycle'),
        cell: ({ row }) => (
          <span>
            {row.original.bill_cycle}
            <span className="text-muted-foreground"> · {row.original.bill_cycle_anchor}</span>
          </span>
        ),
      },
      {
        accessorKey: 'next_bill_date',
        header: t('billing.accounts.columns.next_bill', 'Next bill'),
        cell: ({ row }) => formatDate(row.original.next_bill_date),
      },
      {
        accessorKey: 'last_bill_date',
        header: t('billing.accounts.columns.last_bill', 'Last bill'),
        cell: ({ row }) => formatDate(row.original.last_bill_date),
      },
      {
        accessorKey: 'is_active',
        header: t('billing.accounts.columns.status', 'Status'),
        cell: ({ row }) =>
          row.original.is_active ? (
            <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
          ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.accounts.title', 'Billing Accounts')}
          actions={
            <Button asChild>
              <Link href="/backend/billing/accounts/create">
                <Plus size={16} />
                {t('billing.accounts.create.action', 'New account')}
              </Link>
            </Button>
          }
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-accounts' }}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/billing/accounts/${row.id}`)}
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
