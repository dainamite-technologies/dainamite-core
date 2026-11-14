"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
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

// Spec 0: rows come from billing_invoices with billing field names.
type BillingInvoiceRow = {
  id: string
  number: string
  document_type: 'invoice' | 'credit_memo' | 'debit_memo' | 'receipt'
  status: 'draft' | 'posted' | 'partially_paid' | 'paid' | 'credited'
  test_run: boolean
  bill_account_id: string
  bill_account_name: string | null
  bill_run_id: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  currency_code: string
  issue_date: string | null
  due_date: string | null
  subtotal_net: string
  total_gross: string
  paid_total: string
  outstanding: string
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
    case 'credited':
      return 'success'
    case 'posted':
    case 'partially_paid':
      return 'warning'
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
  const router = useRouter()
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
          { value: 'partially_paid', label: t('billing.invoices.status.partially_paid', 'Partially paid') },
          { value: 'paid', label: t('billing.invoices.status.paid', 'Paid') },
          { value: 'credited', label: t('billing.invoices.status.credited', 'Credited') },
        ],
      },
      {
        id: 'documentType',
        label: t('billing.invoices.filters.document_type', 'Document type'),
        type: 'select',
        options: [
          { value: 'invoice', label: t('billing.invoices.document_type.invoice', 'Invoice') },
          { value: 'receipt', label: t('billing.invoices.document_type.receipt', 'Top-up receipt') },
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
      if (typeof filters.documentType === 'string' && filters.documentType) {
        params.set('documentType', filters.documentType)
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
  }, [filters.documentType, filters.status, filters.testRun, page, pageSize, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<BillingInvoiceRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('billing.invoices.columns.number', 'Number'),
        cell: ({ row }) => {
          const isTest = row.original.test_run === true
          return (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-primary">
                {row.original.number}
              </span>
              {isTest ? <Tag variant="warning">TEST</Tag> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'status',
        header: t('billing.invoices.columns.status', 'Status'),
        cell: ({ row }) => (
          <Tag variant={statusVariant(row.original.status)}>{row.original.status}</Tag>
        ),
      },
      {
        id: 'period',
        header: t('billing.invoices.columns.period', 'Period'),
        cell: ({ row }) => {
          const start = row.original.period_start?.slice(0, 10)
          const end = row.original.period_end?.slice(0, 10)
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
          formatMoney(row.original.total_gross, row.original.currency_code),
      },
      {
        accessorKey: 'outstanding',
        header: t('billing.invoices.columns.outstanding', 'Outstanding'),
        cell: ({ row }) =>
          formatMoney(row.original.outstanding, row.original.currency_code),
      },
      {
        accessorKey: 'issue_date',
        header: t('billing.invoices.columns.issued', 'Issued'),
        cell: ({ row }) => formatDate(row.original.issue_date),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.invoices.title', 'Billing Invoices')}
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-invoices' }}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/billing/invoices/${row.id}`)}
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
