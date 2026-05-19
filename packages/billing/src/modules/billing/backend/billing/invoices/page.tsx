"use client"
import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Billing Invoices list — what the operator actually opens every
 * morning to "review and post drafts".
 *
 * Scope: only invoices the billing engine emitted (`metadata.bill_run_id`
 * set). Plain `core/sales` invoices (created by sales orders, etc.)
 * are NOT shown here — billing has its own surface so the operator's
 * review queue is small and focused.
 */

type BillingInvoiceRow = {
  id: string
  invoice_number: string
  status: 'draft' | 'posted' | 'paid' | 'void' | null
  currency_code: string
  issue_date: string | null
  due_date: string | null
  subtotal_net_amount: string
  grand_total_net_amount: string
  grand_total_gross_amount: string
  paid_total_amount: string
  outstanding_amount: string
  metadata: {
    bill_run_id?: string
    bill_account_id?: string
    bill_period_start?: string
    bill_period_end?: string
    test_run?: boolean
  } | null
  created_at: string
  updated_at: string
}

type ListResponse = {
  items: BillingInvoiceRow[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function statusVariant(
  status: BillingInvoiceRow['status'],
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'paid':
      return 'success'
    case 'posted':
      return 'warning'
    case 'void':
      return 'error'
    case 'draft':
    default:
      return 'default'
  }
}

function formatMoney(value: string, currency: string): string {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return value
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
  } catch {
    return `${value} ${currency}`
  }
}

export default function BillingInvoicesListPage() {
  const t = useT()
  const [rows, setRows] = React.useState<BillingInvoiceRow[]>([])
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
        id: 'status',
        label: t('billing.invoices.filters.status', 'Status'),
        type: 'select',
        options: [
          { value: 'draft', label: t('billing.invoices.status.draft', 'Draft') },
          { value: 'posted', label: t('billing.invoices.status.posted', 'Posted') },
          { value: 'paid', label: t('billing.invoices.status.paid', 'Paid') },
          { value: 'void', label: t('billing.invoices.status.void', 'Void') },
        ],
      },
      {
        id: 'testRun',
        label: t('billing.invoices.filters.test_run', 'Test runs'),
        type: 'select',
        options: [
          { value: 'true', label: t('billing.invoices.filters.test_run.only', 'Only test') },
          {
            value: 'false',
            label: t('billing.invoices.filters.test_run.exclude', 'Exclude test'),
          },
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
      })
      if (search.trim()) params.set('search', search.trim())
      if (typeof filters.status === 'string' && filters.status) {
        params.set('status', filters.status)
      }
      if (filters.testRun === 'true' || filters.testRun === 'false') {
        params.set('testRun', String(filters.testRun))
      }
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/invoices?${params.toString()}`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.testRun, page, pageSize, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<BillingInvoiceRow>[]>(
    () => [
      {
        accessorKey: 'invoice_number',
        header: t('billing.invoices.columns.number', 'Number'),
        cell: ({ row }) => {
          const isTest = row.original.metadata?.test_run === true
          return (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{row.original.invoice_number}</span>
              {isTest ? <Tag variant="warning">TEST</Tag> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'status',
        header: t('billing.invoices.columns.status', 'Status'),
        cell: ({ row }) => (
          <Tag variant={statusVariant(row.original.status)}>{row.original.status ?? '—'}</Tag>
        ),
      },
      {
        id: 'period',
        header: t('billing.invoices.columns.period', 'Period'),
        cell: ({ row }) => {
          const start = row.original.metadata?.bill_period_start
          const end = row.original.metadata?.bill_period_end
          if (!start || !end) return '—'
          return (
            <span className="text-xs">
              {start} → {end}
            </span>
          )
        },
      },
      {
        id: 'total',
        header: t('billing.invoices.columns.total', 'Total'),
        cell: ({ row }) =>
          formatMoney(row.original.grand_total_gross_amount, row.original.currency_code),
      },
      {
        accessorKey: 'outstanding_amount',
        header: t('billing.invoices.columns.outstanding', 'Outstanding'),
        cell: ({ row }) =>
          formatMoney(row.original.outstanding_amount, row.original.currency_code),
      },
      {
        accessorKey: 'issue_date',
        header: t('billing.invoices.columns.issued', 'Issued'),
        cell: ({ row }) => formatDate(row.original.issue_date),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Link
            href={`/backend/billing/invoices/${row.original.id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('billing.invoices.actions.open', 'Open')}
          </Link>
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageHeader title={t('billing.invoices.title', 'Billing Invoices')} />
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
