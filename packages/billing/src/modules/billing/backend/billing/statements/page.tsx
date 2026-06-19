"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Consumption statements admin list (SPEC-002 P3). Non-fiscal period summaries
 * for prepaid accounts — opening / top-ups / usage / recurring / closing.
 */

type StatementRow = {
  id: string
  bill_account_id: string
  period_start: string
  period_end: string
  currency_code: string
  opening_balance: string
  total_topups: string
  total_usage: string
  total_recurring: string
  closing_balance: string
  status: string
}

type ListResponse = { items: StatementRow[]; total: number; totalPages: number }

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

export function statementStatusVariant(status: string): 'success' | 'info' {
  return status === 'sent' ? 'success' : 'info'
}

export default function BillingStatementsListPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<StatementRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortField: 'periodEnd',
        sortDir: 'desc',
      })
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/statements?${params.toString()}`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<StatementRow>[]>(
    () => [
      {
        accessorKey: 'period_end',
        header: t('billing.statements.columns.period', 'Period'),
        cell: ({ row }) =>
          `${formatDate(row.original.period_start)} – ${formatDate(row.original.period_end)}`,
      },
      {
        accessorKey: 'opening_balance',
        header: t('billing.statements.columns.opening', 'Opening'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.opening_balance}</span>,
      },
      {
        accessorKey: 'total_topups',
        header: t('billing.statements.columns.topups', 'Top-ups'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.total_topups}</span>,
      },
      {
        accessorKey: 'total_usage',
        header: t('billing.statements.columns.usage', 'Usage'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.total_usage}</span>,
      },
      {
        accessorKey: 'total_recurring',
        header: t('billing.statements.columns.recurring', 'Recurring'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.total_recurring}</span>,
      },
      {
        accessorKey: 'closing_balance',
        header: t('billing.statements.columns.closing', 'Closing'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {row.original.closing_balance} {row.original.currency_code}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('billing.statements.columns.status', 'Status'),
        cell: ({ row }) => (
          <Tag variant={statementStatusVariant(row.original.status)}>
            {t(`billing.statements.status.${row.original.status}`, row.original.status)}
          </Tag>
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.statements.title', 'Statements')}
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-statements' }}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/billing/statements/${row.id}`)}
          isLoading={loading}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
