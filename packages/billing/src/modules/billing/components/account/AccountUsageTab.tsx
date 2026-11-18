"use client"
import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { BillingDataTable as DataTable } from '../BillingDataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatDate } from './accountRow'

// Minimal usage shape for the embedded "Usage" table. Mirrors the
// snake_case `fields` projection in `api/usage/route.ts`. Usage is
// append-only — `rated_in_bill_run_id` is null until a Bill Run rates it.
type AccountUsageRow = {
  id: string
  uom_code: string
  quantity: string
  period_start: string
  period_end: string
  line_description: string | null
  rated_in_bill_run_id: string | null
}

/** The account's usage records (workspace Usage tab). */
export function AccountUsageTab({ accountId }: { accountId: string }) {
  const t = useT()
  const locale = useLocale()
  const [rows, setRows] = React.useState<AccountUsageRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const pageSize = 25

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<{
        items: AccountUsageRow[]
        total: number
        totalPages: number
      }>(
        `/api/billing/usage?billAccountId=${accountId}&page=${page}` +
          `&pageSize=${pageSize}&sortField=periodStart&sortDir=desc`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [accountId, page])

  React.useEffect(() => {
    void load()
  }, [load])

  const columns = React.useMemo<ColumnDef<AccountUsageRow>[]>(
    () => [
      {
        accessorKey: 'uom_code',
        header: t('billing.usage.columns.uom', 'Unit'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.uom_code}</span>
        ),
      },
      {
        accessorKey: 'quantity',
        header: t('billing.usage.columns.quantity', 'Quantity'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.quantity}</span>
        ),
      },
      {
        accessorKey: 'period_start',
        header: t('billing.usage.columns.period', 'Period'),
        cell: ({ row }) =>
          `${formatDate(row.original.period_start, locale)} – ${formatDate(row.original.period_end, locale)}`,
      },
      {
        accessorKey: 'line_description',
        header: t('billing.usage.columns.description', 'Description'),
        cell: ({ row }) => row.original.line_description || '—',
      },
      {
        accessorKey: 'rated_in_bill_run_id',
        header: t('billing.usage.columns.rated', 'Rated'),
        cell: ({ row }) =>
          row.original.rated_in_bill_run_id ? (
            // Rated records carry the Bill Run that priced them — link to it.
            // Unrated records have no destination, so they stay non-interactive
            // (no misleading row-level click affordance).
            <Link
              href={`/backend/billing/runs/${row.original.rated_in_bill_run_id}`}
              className="rounded-sm hover:underline"
            >
              <Tag variant="success">{t('billing.usage.rated.yes', 'Rated')}</Tag>
            </Link>
          ) : (
            <Tag variant="default">{t('billing.usage.rated.no', 'Unrated')}</Tag>
          ),
      },
    ],
    [t, locale],
  )

  return (
    <div className="mt-6">
      <DataTable
        title={t('billing.accounts.detail.usage.title', 'Usage')}
        columns={columns}
        data={rows}
        isLoading={loading}
        pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        emptyState={
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t('billing.accounts.detail.usage.empty', 'No usage records for this account yet.')}
          </div>
        }
      />
    </div>
  )
}
