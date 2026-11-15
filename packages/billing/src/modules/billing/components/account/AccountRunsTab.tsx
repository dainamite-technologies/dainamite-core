"use client"
import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BillingDataTable as DataTable } from '../BillingDataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useTestRunCleanup, type BillRunMode } from '../TestRunActions'

/**
 * Bill Runs tab of the account workspace (Spec E §4 / Spec F, F8): this
 * account's run outcomes, newest first, from
 * `GET /api/billing/run-outcomes?billAccountId=` (server-paginated).
 */

type OutcomeCycle = {
  bill_date: string
  status: string
  invoice_id: string | null
  invoice_number?: string | null
  statement_id?: string | null
}

type OutcomeRow = {
  id: string
  bill_run_id: string
  run_mode: BillRunMode | null
  run_as_of_date: string | null
  status: string
  error_message: string | null
  draft_invoice_id: string | null
  invoice_number: string | null
  cycles: OutcomeCycle[] | null
  created_at: string
}

type ListResponse = { items: OutcomeRow[]; total: number; totalPages: number }

const PAGE_SIZE = 20

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'success_with_warnings' || status.startsWith('skipped')) return 'warning'
  return 'neutral'
}

export function AccountRunsTab({ accountId, refreshKey = 0 }: { accountId: string; refreshKey?: number }) {
  const t = useT()
  const [rows, setRows] = React.useState<OutcomeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const cleanup = useTestRunCleanup()

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        billAccountId: accountId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortField: 'createdAt',
        sortDir: 'desc',
      })
      const result = await readApiResultOrThrow<ListResponse>(`/api/billing/run-outcomes?${params.toString()}`)
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } catch {
      setError(t('billing.accounts.runs.error', 'Failed to load bill runs'))
    } finally {
      setLoading(false)
    }
  }, [accountId, page, t])

  React.useEffect(() => {
    void load()
  }, [load, refreshKey])

  const columns = React.useMemo<ColumnDef<OutcomeRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('billing.accounts.runs.columns.when', 'Run at'),
        cell: ({ row }) => (
          <Link href={`/backend/billing/runs/${row.original.bill_run_id}`} className="text-primary hover:underline">
            {new Date(row.original.created_at).toLocaleString()}
          </Link>
        ),
      },
      {
        accessorKey: 'run_mode',
        header: t('billing.runs.detail.field.mode', 'Mode'),
        cell: ({ row }) =>
          row.original.run_mode === 'dry' ? (
            <Tag variant="warning">{t('billing.runs.mode.dry_run', 'Dry-run')}</Tag>
          ) : row.original.run_mode === 'test' ? (
            <Tag variant="warning">{t('billing.runs.mode.test', 'Test')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.runs.mode.real', 'Real')}</Tag>
          ),
      },
      {
        accessorKey: 'run_as_of_date',
        header: t('billing.runs.columns.as_of_date', 'As-of date'),
        cell: ({ row }) => row.original.run_as_of_date ?? '—',
      },
      {
        accessorKey: 'status',
        header: t('billing.runs.outcomes.columns.status', 'Status'),
        cell: ({ row }) => <Tag variant={statusVariant(row.original.status)}>{row.original.status}</Tag>,
      },
      {
        id: 'cycles',
        header: t('billing.accounts.runs.columns.cycles', 'Bill dates'),
        cell: ({ row }) => {
          const cycles = row.original.cycles ?? []
          if (cycles.length === 0) return '—'
          return cycles.map((cycle) => cycle.bill_date).join(', ')
        },
      },
      {
        id: 'documents',
        header: t('billing.accounts.runs.columns.documents', 'Documents'),
        cell: ({ row }) => {
          const cycles = row.original.cycles ?? []
          const links = cycles.flatMap((cycle) =>
            cycle.invoice_id
              ? [
                  <Link key={cycle.invoice_id} href={`/backend/billing/invoices/${cycle.invoice_id}`} className="text-primary hover:underline">
                    {cycle.invoice_number ?? cycle.invoice_id.slice(0, 8)}
                  </Link>,
                ]
              : cycle.statement_id
                ? [
                    <Link key={cycle.statement_id} href={`/backend/billing/statements/${cycle.statement_id}`} className="text-primary hover:underline">
                      {t('billing.runs.cycles.statement', 'Statement')} {cycle.bill_date}
                    </Link>,
                  ]
                : [],
          )
          if (links.length === 0) return row.original.error_message ?? '—'
          return <span className="flex flex-wrap gap-x-3 gap-y-1">{links}</span>
        },
      },
    ],
    [t],
  )

  return (
    <>
    <DataTable
      title={t('billing.accounts.tabs.runs', 'Bill runs')}
      columns={columns}
      data={rows}
      isLoading={loading}
      error={error}
      pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
      emptyState={t('billing.accounts.runs.empty', 'No bill runs for this account yet.')}
      rowActions={(row) => (
        <RowActions
          items={[
            { id: 'open', label: t('billing.runs.actions.open', 'Open'), href: `/backend/billing/runs/${row.bill_run_id}` },
            ...(row.run_mode === 'test'
              ? [
                  {
                    id: 'wipe',
                    label: t('billing.runs.wipe.action', 'Wipe test invoices'),
                    onSelect: async () => {
                      if ((await cleanup.wipe(row.bill_run_id)) !== null) void load()
                    },
                  },
                ]
              : []),
            ...(row.run_mode === 'test' || row.run_mode === 'dry'
              ? [
                  {
                    id: 'delete',
                    label: t('billing.runs.delete.action', 'Delete run'),
                    destructive: true,
                    onSelect: async () => {
                      const removed = await cleanup.remove({ runId: row.bill_run_id, mode: row.run_mode ?? 'test' })
                      if (removed !== null) void load()
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    />
    {cleanup.ConfirmDialogElement}
    </>
  )
}
