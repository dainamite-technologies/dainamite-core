"use client"
import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Billing Accounts admin list — read-only for v1.
 *
 * CRUD lives at `/api/billing/accounts` (REST). The admin UI for
 * editing accounts ships in a follow-up iteration once the operator
 * workflow is signed off — for now operators create + edit accounts
 * via the REST API or via integrations.
 */

type BillingAccountRow = {
  id: string
  customerId: string
  name: string
  currencyCode: string
  billCycle: 'monthly' | 'quarterly' | 'annually' | 'weekly'
  billCycleAnchor: string
  invoiceEmail: string
  nextBillDate: string
  lastBillDate: string | null
  isActive: boolean
  createdAt: string
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
      },
      {
        accessorKey: 'customerId',
        header: t('billing.accounts.columns.customer', 'Customer'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.customerId}</span>
        ),
      },
      {
        accessorKey: 'currencyCode',
        header: t('billing.accounts.columns.currency', 'Currency'),
      },
      {
        accessorKey: 'billCycle',
        header: t('billing.accounts.columns.cycle', 'Cycle'),
        cell: ({ row }) => (
          <span>
            {row.original.billCycle}
            <span className="text-muted-foreground"> · {row.original.billCycleAnchor}</span>
          </span>
        ),
      },
      {
        accessorKey: 'nextBillDate',
        header: t('billing.accounts.columns.next_bill', 'Next bill'),
        cell: ({ row }) => formatDate(row.original.nextBillDate),
      },
      {
        accessorKey: 'lastBillDate',
        header: t('billing.accounts.columns.last_bill', 'Last bill'),
        cell: ({ row }) => formatDate(row.original.lastBillDate),
      },
      {
        accessorKey: 'isActive',
        header: t('billing.accounts.columns.status', 'Status'),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
          ),
      },
    ],
    [t],
  )

  return (
    <Page title={t('billing.accounts.title', 'Billing Accounts')}>
      <PageBody>
        <DataTable
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
