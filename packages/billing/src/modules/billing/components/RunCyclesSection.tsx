"use client"
import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'

/**
 * Spec A — per-bill-date breakdown of a Bill Run.
 *
 * Every run bills all due cycles, so one account outcome can stand for
 * several invoices. These two tables flatten the outcomes currently shown
 * on the run page into:
 *   - Cycles: one row per (account, bill date) with its status and invoice;
 *   - Skipped items: diagnostics such as partial periods not prorated.
 * Both are paginated client-side over the already-loaded outcome page.
 */

export type RunCycle = {
  bill_date: string
  period_start: string | null
  period_end: string | null
  status: 'invoiced' | 'previewed' | 'empty' | 'skipped_existing'
  line_count: number
  total_net: string
  invoice_id: string | null
  invoice_number?: string | null
}

export type RunCycleOutcome = {
  bill_account_id: string
  bill_account_name: string | null
  cycles?: RunCycle[] | null
  warnings: Record<string, unknown> | null
}

type CycleRow = RunCycle & { key: string; accountId: string; accountName: string }

type SkippedRow = {
  key: string
  accountId: string
  accountName: string
  itemId: string
  reason: string
  periodStart: string | null
  periodEnd: string | null
}

const PAGE_SIZE = 50

function cycleVariant(status: RunCycle['status']): 'success' | 'info' | 'neutral' | 'warning' {
  switch (status) {
    case 'invoiced':
      return 'success'
    case 'previewed':
      return 'info'
    case 'skipped_existing':
      return 'warning'
    default:
      return 'neutral'
  }
}

function usePagedRows<T>(rows: T[]): { page: number; setPage: (page: number) => void; pageRows: T[]; totalPages: number } {
  const [page, setPage] = React.useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = React.useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage],
  )
  return { page: safePage, setPage, pageRows, totalPages }
}

export function RunCyclesSection({ outcomes }: { outcomes: RunCycleOutcome[] }) {
  const t = useT()

  const cycleRows = React.useMemo<CycleRow[]>(
    () =>
      outcomes.flatMap((outcome) =>
        (outcome.cycles ?? []).map((cycle) => ({
          ...cycle,
          key: `${outcome.bill_account_id}:${cycle.bill_date}`,
          accountId: outcome.bill_account_id,
          accountName: outcome.bill_account_name ?? outcome.bill_account_id,
        })),
      ),
    [outcomes],
  )

  const skippedRows = React.useMemo<SkippedRow[]>(
    () =>
      outcomes.flatMap((outcome) => {
        const skipped = (outcome.warnings?.skipped_items ?? []) as Array<Record<string, unknown>>
        return skipped.map((entry, index) => ({
          key: `${outcome.bill_account_id}:${index}`,
          accountId: outcome.bill_account_id,
          accountName: outcome.bill_account_name ?? outcome.bill_account_id,
          itemId: String(entry.item_id ?? ''),
          reason: String(entry.reason ?? ''),
          periodStart: typeof entry.service_period_start === 'string' ? entry.service_period_start : null,
          periodEnd: typeof entry.service_period_end === 'string' ? entry.service_period_end : null,
        }))
      }),
    [outcomes],
  )

  const statusLabel = React.useCallback(
    (status: RunCycle['status']) => {
      switch (status) {
        case 'invoiced':
          return t('billing.runs.cycles.status.invoiced', 'Invoiced')
        case 'previewed':
          return t('billing.runs.cycles.status.previewed', 'Preview')
        case 'skipped_existing':
          return t('billing.runs.cycles.status.skipped_existing', 'Skipped — draft exists')
        default:
          return t('billing.runs.cycles.status.empty', 'Nothing to bill')
      }
    },
    [t],
  )

  const reasonLabel = React.useCallback(
    (reason: string) => {
      switch (reason) {
        case 'partial-period-not-prorated':
          return t('billing.runs.skipped.reason.partial_not_prorated', 'Partial period, proration off')
        case 'ended-after-billing-no-credit':
          return t('billing.runs.skipped.reason.ended_no_credit', 'Ended after billing, proration off — no credit')
        case 'period-cap-reached':
          return t('billing.runs.skipped.reason.period_cap', 'Too many periods for one bill date')
        default:
          return reason
      }
    },
    [t],
  )

  const cycleColumns = React.useMemo<ColumnDef<CycleRow>[]>(
    () => [
      {
        accessorKey: 'accountName',
        header: t('billing.runs.outcomes.columns.account', 'Account'),
        cell: ({ row }) => (
          <Link href={`/backend/billing/accounts/${row.original.accountId}`} className="text-sm text-primary hover:underline">
            {row.original.accountName}
          </Link>
        ),
      },
      {
        accessorKey: 'bill_date',
        header: t('billing.runs.cycles.columns.bill_date', 'Bill date'),
      },
      {
        accessorKey: 'period_start',
        header: t('billing.runs.cycles.columns.service_period', 'Service period'),
        cell: ({ row }) =>
          row.original.period_start && row.original.period_end
            ? `${row.original.period_start} – ${row.original.period_end}`
            : '—',
      },
      {
        accessorKey: 'status',
        header: t('billing.runs.outcomes.columns.status', 'Status'),
        cell: ({ row }) => <Tag variant={cycleVariant(row.original.status)}>{statusLabel(row.original.status)}</Tag>,
      },
      {
        accessorKey: 'line_count',
        header: t('billing.runs.cycles.columns.lines', 'Lines'),
      },
      {
        accessorKey: 'total_net',
        header: t('billing.runs.cycles.columns.total_net', 'Net total'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.total_net}</span>,
      },
      {
        accessorKey: 'invoice_id',
        header: t('billing.runs.outcomes.columns.invoice', 'Invoice'),
        cell: ({ row }) =>
          row.original.invoice_id ? (
            <Link href={`/backend/billing/invoices/${row.original.invoice_id}`} className="text-sm text-primary hover:underline">
              {row.original.invoice_number ?? row.original.invoice_id}
            </Link>
          ) : (
            '—'
          ),
      },
    ],
    [statusLabel, t],
  )

  const skippedColumns = React.useMemo<ColumnDef<SkippedRow>[]>(
    () => [
      {
        accessorKey: 'accountName',
        header: t('billing.runs.outcomes.columns.account', 'Account'),
      },
      {
        accessorKey: 'itemId',
        header: t('billing.runs.skipped.columns.item', 'Item'),
        cell: ({ row }) => (
          <Link href={`/backend/billing/items/${row.original.itemId}`} className="text-sm text-primary hover:underline">
            {row.original.itemId}
          </Link>
        ),
      },
      {
        accessorKey: 'reason',
        header: t('billing.runs.skipped.columns.reason', 'Reason'),
        cell: ({ row }) => reasonLabel(row.original.reason),
      },
      {
        accessorKey: 'periodStart',
        header: t('billing.runs.cycles.columns.service_period', 'Service period'),
        cell: ({ row }) =>
          row.original.periodStart ? `${row.original.periodStart} – ${row.original.periodEnd ?? '…'}` : '—',
      },
    ],
    [reasonLabel, t],
  )

  const cyclesPaging = usePagedRows(cycleRows)
  const skippedPaging = usePagedRows(skippedRows)

  if (cycleRows.length === 0 && skippedRows.length === 0) return null

  return (
    <>
      {cycleRows.length > 0 ? (
        <div>
          <h2 className="text-base font-semibold mb-1">{t('billing.runs.cycles.title', 'Cycles')}</h2>
          <p className="text-sm text-muted-foreground mb-2">
            {t(
              'billing.runs.cycles.help',
              'One row per account and bill date — a run bills every due cycle up to its as-of date.',
            )}
          </p>
          <DataTable
            columns={cycleColumns}
            data={cyclesPaging.pageRows}
            pagination={{
              page: cyclesPaging.page,
              pageSize: PAGE_SIZE,
              total: cycleRows.length,
              totalPages: cyclesPaging.totalPages,
              onPageChange: cyclesPaging.setPage,
            }}
          />
        </div>
      ) : null}
      {skippedRows.length > 0 ? (
        <div>
          <h2 className="text-base font-semibold mb-2">{t('billing.runs.skipped.title', 'Skipped items')}</h2>
          <DataTable
            columns={skippedColumns}
            data={skippedPaging.pageRows}
            pagination={{
              page: skippedPaging.page,
              pageSize: PAGE_SIZE,
              total: skippedRows.length,
              totalPages: skippedPaging.totalPages,
              onPageChange: skippedPaging.setPage,
            }}
          />
        </div>
      ) : null}
    </>
  )
}
