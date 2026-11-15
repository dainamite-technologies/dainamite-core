"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatMoney } from './InvoicesTable'

/**
 * Billing payments table (Spec C) — shared by the Payments list page and the
 * Payments section of a billing account. `billAccountId` / `importId` pin
 * the list; row click opens the payment.
 */

export type PaymentRow = {
  id: string
  received_at: string
  amount: string
  currency_code: string
  reference: string | null
  payer_name: string | null
  source: string
  import_id: string | null
  bill_account_id: string | null
  bill_account_name: string | null
  status: string
  unallocated_amount: string
  match_reason: string | null
}

type ListResponse = { items: PaymentRow[]; total: number; totalPages: number }

export const PAYMENT_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'info' | 'default'> = {
  allocated: 'success',
  partially_allocated: 'info',
  matched: 'info',
  unmatched: 'warning',
  ignored: 'neutral',
  converted_to_topup: 'success',
}

export function usePaymentLabels() {
  const t = useT()
  return React.useMemo(
    () => ({
      status: (status: string) =>
        ({
          unmatched: t('billing.payments.status.unmatched', 'Unmatched'),
          matched: t('billing.payments.status.matched', 'Matched'),
          partially_allocated: t('billing.payments.status.partially_allocated', 'Partially allocated'),
          allocated: t('billing.payments.status.allocated', 'Allocated'),
          ignored: t('billing.payments.status.ignored', 'Ignored'),
          converted_to_topup: t('billing.payments.status.converted_to_topup', 'Converted to top-up'),
        })[status] ?? status,
      reason: (reason: string | null) =>
        reason
          ? ({
              no_reference: t('billing.payments.reason.no_reference', 'No invoice number found'),
              currency_mismatch: t('billing.payments.reason.currency_mismatch', 'Currency differs from the invoice'),
              invoice_already_paid: t('billing.payments.reason.invoice_already_paid', 'Invoice already paid — kept as credit'),
              prepaid_account: t('billing.payments.reason.prepaid_account', 'Prepaid account — convert to a top-up'),
              manual: t('billing.payments.reason.manual', 'Entered or assigned manually'),
            })[reason] ?? reason
          : '—',
    }),
    [t],
  )
}

export type PaymentsTableProps = {
  title: string
  tableId: string
  billAccountId?: string
  importId?: string
  pageSize?: number
  /** Bumped by the host to force a reload (e.g. after an upload). */
  reloadKey?: number
  actions?: React.ReactNode
}

export function PaymentsTable({ title, tableId, billAccountId, importId, pageSize = 25, reloadKey = 0, actions }: PaymentsTableProps) {
  const t = useT()
  const router = useRouter()
  const labels = usePaymentLabels()
  const [rows, setRows] = React.useState<PaymentRow[]>([])
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('billing.payments.filters.status', 'Status'),
        type: 'select',
        options: ['unmatched', 'matched', 'partially_allocated', 'allocated', 'ignored', 'converted_to_topup'].map((value) => ({
          value,
          label: labels.status(value),
        })),
      },
    ],
    [labels, t],
  )

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(Math.min(pageSize, 100)) })
      if (billAccountId) params.set('billAccountId', billAccountId)
      if (importId) params.set('importId', importId)
      if (search.trim()) params.set('search', search.trim())
      if (typeof filters.status === 'string' && filters.status) params.set('status', filters.status)
      const result = await readApiResultOrThrow<ListResponse>(`/api/billing/payments?${params.toString()}`)
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('billing.payments.error.load', 'Could not load payments'))
    } finally {
      setLoading(false)
    }
    // reloadKey forces a refetch from the host.
  }, [billAccountId, filters.status, importId, page, pageSize, search, t, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    void load()
  }, [load])

  const columns = React.useMemo<ColumnDef<PaymentRow>[]>(() => {
    const cols: ColumnDef<PaymentRow>[] = [
      {
        accessorKey: 'received_at',
        header: t('billing.payments.columns.received', 'Received'),
        cell: ({ row }) => row.original.received_at?.slice(0, 10) ?? '—',
      },
      {
        accessorKey: 'amount',
        header: t('billing.payments.columns.amount', 'Amount'),
        cell: ({ row }) => formatMoney(row.original.amount, row.original.currency_code),
      },
      {
        accessorKey: 'status',
        header: t('billing.payments.columns.status', 'Status'),
        cell: ({ row }) => <Tag variant={PAYMENT_STATUS_VARIANT[row.original.status] ?? 'default'}>{labels.status(row.original.status)}</Tag>,
      },
      {
        accessorKey: 'unallocated_amount',
        header: t('billing.payments.columns.unallocated', 'Unallocated'),
        cell: ({ row }) => formatMoney(row.original.unallocated_amount, row.original.currency_code),
      },
      {
        accessorKey: 'reference',
        header: t('billing.payments.columns.reference', 'Reference'),
        cell: ({ row }) => row.original.reference ?? '—',
        meta: { truncate: true, maxWidth: '260px' },
      },
      {
        accessorKey: 'payer_name',
        header: t('billing.payments.columns.payer', 'Payer'),
        cell: ({ row }) => row.original.payer_name ?? '—',
        meta: { truncate: true, maxWidth: '180px' },
      },
    ]
    if (!billAccountId) {
      cols.splice(3, 0, {
        accessorKey: 'bill_account_name',
        header: t('billing.payments.columns.account', 'Account'),
        cell: ({ row }) => row.original.bill_account_name ?? '—',
        meta: { truncate: true, maxWidth: '200px' },
      })
    }
    return cols
  }, [billAccountId, labels, t])

  return (
    <DataTable
      title={title}
      actions={actions}
      refreshButton={{ label: t('billing.common.refresh', 'Refresh'), onRefresh: load, isRefreshing: loading }}
      perspective={{ tableId }}
      columns={columns}
      data={rows}
      error={error}
      emptyState={t('billing.payments.empty', 'No payments yet.')}
      isLoading={loading}
      onRowClick={(row) => router.push(`/backend/billing/payments/${encodeURIComponent(row.id)}`)}
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
