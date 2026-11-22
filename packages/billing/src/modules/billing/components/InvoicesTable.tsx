"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../lib/displayDate'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BillingDataTable as DataTable } from './BillingDataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { invoiceDetailHref, invoicePdfHref } from '../lib/navigation'
import { displaySign } from '../lib/documentTypes'

/**
 * Billing documents table (Spec B) — shared by the global Invoices list and
 * the Invoices section of a billing account (and, later, Spec E's tab).
 *
 *   - `billAccountId` pins the list to one account (no account column; rows
 *     open the invoice with a return link to the account).
 *   - Filters: status, overdue (computed server-side, B-D6), document type,
 *     test runs. Columns include due date, outstanding and days overdue.
 *   - Row action: download the PDF (frozen when posted, preview for drafts).
 *
 * Server-paginated via `GET /api/billing/invoices` (pageSize ≤ 100).
 */

export type BillingInvoiceRow = {
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
  days_overdue: number
  created_at: string
  updated_at: string
}

type ListResponse = {
  items: BillingInvoiceRow[]
  total: number
  totalPages: number
}

export type InvoicesTableProps = {
  title: string
  /** Pin the table to one account (account Invoices section). */
  billAccountId?: string
  /** Stable perspective / extension id. */
  tableId: string
  pageSize?: number
  /** Extra header actions (e.g. the billing settings shortcut). */
  actions?: React.ReactNode
}

export function formatMoney(value: string, currency: string): string {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return value
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
  } catch {
    return `${value} ${currency}`
  }
}

export function invoiceStatusVariant(status: BillingInvoiceRow['status']): 'default' | 'success' | 'warning' | 'error' {
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

export function InvoicesTable({ title, billAccountId, tableId, pageSize = 25, actions }: InvoicesTableProps) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [rows, setRows] = React.useState<BillingInvoiceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const statusLabel = React.useCallback(
    (status: BillingInvoiceRow['status']) =>
      ({
        draft: t('billing.invoices.status.draft', 'Draft'),
        posted: t('billing.invoices.status.posted', 'Posted'),
        partially_paid: t('billing.invoices.status.partially_paid', 'Partially paid'),
        paid: t('billing.invoices.status.paid', 'Paid'),
        credited: t('billing.invoices.status.credited', 'Credited'),
      })[status] ?? status,
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('billing.invoices.filters.status', 'Status'),
        type: 'select',
        options: (['draft', 'posted', 'partially_paid', 'paid', 'credited'] as const).map((value) => ({
          value,
          label: statusLabel(value),
        })),
      },
      {
        id: 'overdue',
        label: t('billing.invoices.filters.overdue', 'Overdue'),
        type: 'select',
        options: [
          { value: 'true', label: t('billing.invoices.filters.overdue.only', 'Only overdue') },
          { value: 'false', label: t('billing.invoices.filters.overdue.exclude', 'Not overdue') },
        ],
      },
      {
        id: 'documentType',
        label: t('billing.invoices.filters.document_type', 'Document type'),
        type: 'select',
        options: [
          { value: 'invoice', label: t('billing.invoices.document_type.invoice', 'Invoice') },
          { value: 'credit_memo', label: t('billing.invoices.document_type.credit_memo', 'Credit memo') },
          { value: 'debit_memo', label: t('billing.invoices.document_type.debit_memo', 'Debit memo') },
          { value: 'receipt', label: t('billing.invoices.document_type.receipt', 'Top-up receipt') },
        ],
      },
      {
        id: 'testRun',
        label: t('billing.invoices.filters.test_run', 'Test runs'),
        type: 'select',
        options: [
          { value: 'true', label: t('billing.invoices.filters.test_run.only', 'Only test') },
          { value: 'false', label: t('billing.invoices.filters.test_run.exclude', 'Exclude test') },
        ],
      },
    ],
    [statusLabel, t],
  )

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(Math.min(pageSize, 100)) })
      if (billAccountId) params.set('billAccountId', billAccountId)
      if (search.trim()) params.set('search', search.trim())
      for (const key of ['status', 'documentType'] as const) {
        const value = filters[key]
        if (typeof value === 'string' && value) params.set(key, value)
      }
      for (const key of ['testRun', 'overdue'] as const) {
        const value = filters[key]
        if (value === 'true' || value === 'false') params.set(key, value)
      }
      const result = await readApiResultOrThrow<ListResponse>(`/api/billing/invoices?${params.toString()}`)
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('billing.invoices.error.load', 'Could not load invoices'))
    } finally {
      setLoading(false)
    }
  }, [billAccountId, filters, page, pageSize, search, t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<BillingInvoiceRow>[]>(() => {
    const cols: ColumnDef<BillingInvoiceRow>[] = [
      {
        accessorKey: 'number',
        header: t('billing.invoices.columns.number', 'Number'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary">{row.original.number}</span>
            {row.original.test_run ? <Tag variant="warning">TEST</Tag> : null}
          </div>
        ),
      },
      {
        accessorKey: 'document_type',
        header: t('billing.invoices.columns.type', 'Type'),
        cell: ({ row }) =>
          ({
            invoice: t('billing.invoices.document_type.invoice', 'Invoice'),
            credit_memo: t('billing.invoices.document_type.credit_memo', 'Credit memo'),
            debit_memo: t('billing.invoices.document_type.debit_memo', 'Debit memo'),
            receipt: t('billing.invoices.document_type.receipt', 'Top-up receipt'),
          })[row.original.document_type] ?? row.original.document_type,
      },
      {
        accessorKey: 'status',
        header: t('billing.invoices.columns.status', 'Status'),
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Tag variant={invoiceStatusVariant(row.original.status)}>{statusLabel(row.original.status)}</Tag>
            {row.original.days_overdue > 0 ? (
              <Tag variant="error">{t('billing.invoices.overdue', 'Overdue')}</Tag>
            ) : null}
          </div>
        ),
      },
    ]
    if (!billAccountId) {
      cols.push({
        accessorKey: 'bill_account_name',
        header: t('billing.invoices.columns.account', 'Account'),
        cell: ({ row }) => row.original.bill_account_name ?? '—',
        meta: { truncate: true, maxWidth: '220px' },
      })
    }
    cols.push(
      {
        id: 'period',
        header: t('billing.invoices.columns.period', 'Period'),
        // The range has a fixed length, so size the column to it instead of the 150px truncate default.
        meta: { truncate: false },
        cell: ({ row }) => {
          const { period_start: start, period_end: end } = row.original
          if (!start || !end) return '—'
          return (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(start)} → {formatDate(end)}
            </span>
          )
        },
      },
      {
        id: 'total',
        header: t('billing.invoices.columns.total', 'Total'),
        // Credit memos are stored positive (D-D5) and shown negative.
        cell: ({ row }) =>
          formatMoney(
            String(displaySign(row.original.document_type) * Number.parseFloat(row.original.total_gross)),
            row.original.currency_code,
          ),
      },
      {
        accessorKey: 'outstanding',
        header: t('billing.invoices.columns.outstanding', 'Outstanding'),
        cell: ({ row }) => formatMoney(row.original.outstanding, row.original.currency_code),
      },
      {
        accessorKey: 'issue_date',
        header: t('billing.invoices.columns.issued', 'Issued'),
        cell: ({ row }) => formatBillingDay(row.original.issue_date, locale),
      },
      {
        accessorKey: 'due_date',
        header: t('billing.invoices.columns.due', 'Due'),
        cell: ({ row }) => formatBillingDay(row.original.due_date, locale),
      },
      {
        accessorKey: 'days_overdue',
        header: t('billing.invoices.columns.days_overdue', 'Days overdue'),
        cell: ({ row }) =>
          row.original.days_overdue > 0 ? (
            <span className="font-medium text-status-error-text tabular-nums">{row.original.days_overdue}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    )
    return cols
  }, [billAccountId, statusLabel, t, locale])

  return (
    <DataTable
      title={title}
      actions={actions}
      refreshButton={{ label: t('billing.common.refresh', 'Refresh'), onRefresh: loadRows, isRefreshing: loading }}
      columnChooser={{ auto: true }}
      perspective={{ tableId }}
      columns={columns}
      data={rows}
      error={error}
      emptyState={t('billing.invoices.empty', 'No invoices yet.')}
      onRowClick={(row) => router.push(invoiceDetailHref(row.id, { fromAccountId: billAccountId }))}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('billing.invoices.actions.open', 'Open'),
              href: invoiceDetailHref(row.id, { fromAccountId: billAccountId }),
            },
            {
              id: 'pdf',
              label:
                row.status === 'draft'
                  ? t('billing.invoices.actions.pdf_preview', 'Preview PDF')
                  : t('billing.invoices.actions.pdf', 'Download PDF'),
              href: invoicePdfHref(row.id),
            },
          ]}
        />
      )}
      isLoading={loading}
      pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
      filters={filterDefs}
      filterValues={filters}
      onFiltersApply={(next) => {
        setPage(1)
        setFilters(next)
      }}
      onFiltersClear={() => {
        setPage(1)
        setFilters({})
      }}
      searchValue={search}
      onSearchChange={(next) => {
        setPage(1)
        setSearch(next)
      }}
    />
  )
}
