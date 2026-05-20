"use client"
import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Bill Runs admin list page.
 *
 * Read-only surface: lists every Bill Run for the operator's tenant
 * with status, mode, summary stats, and a link into the detail page.
 * Retry-failed is wired into the run detail page; manual triggers
 * remain API-driven for v1 (operators curl `/api/billing/runs`) — a
 * trigger button on this page lands in a follow-up iteration once
 * the operator UX is signed off.
 */

// API list rows are snake_case (see `api/runs/route.ts` `fields`).
type BillRunRow = {
  id: string
  triggered_by: 'schedule' | 'manual'
  parent_run_id: string | null
  dry_run: boolean
  test_mode: boolean
  catch_up: boolean
  as_of_date: string
  started_at: string | null
  finished_at: string | null
  status: 'running' | 'completed' | 'partial_failure' | 'failed'
  summary: {
    accounts_processed?: number
    drafts_created?: number
    drafts_skipped_existing?: number
    accounts_failed?: number
    accounts_with_warnings?: number
    usage_records_rated?: number
  } | null
  created_at: string
  updated_at: string
}

type ListResponse = {
  items: BillRunRow[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function statusVariant(
  status: BillRunRow['status'],
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'partial_failure':
      return 'warning'
    case 'failed':
      return 'error'
    case 'running':
    default:
      return 'default'
  }
}

function modeBadge(row: BillRunRow): { label: string; variant: 'default' | 'warning' } | null {
  if (row.dry_run) return { label: 'Dry-run', variant: 'warning' }
  if (row.test_mode) return { label: 'Test', variant: 'warning' }
  return null
}

export default function BillRunsListPage() {
  const t = useT()
  const [rows, setRows] = React.useState<BillRunRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('billing.runs.filters.status', 'Status'),
        type: 'select',
        options: [
          { value: 'running', label: t('billing.runs.status.running', 'Running') },
          { value: 'completed', label: t('billing.runs.status.completed', 'Completed') },
          {
            value: 'partial_failure',
            label: t('billing.runs.status.partial_failure', 'Partial failure'),
          },
          { value: 'failed', label: t('billing.runs.status.failed', 'Failed') },
        ],
      },
      {
        id: 'triggeredBy',
        label: t('billing.runs.filters.triggered_by', 'Trigger'),
        type: 'select',
        options: [
          { value: 'schedule', label: t('billing.runs.trigger.schedule', 'Schedule') },
          { value: 'manual', label: t('billing.runs.trigger.manual', 'Manual') },
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
        sortField: 'startedAt',
        sortDir: 'desc',
      })
      if (search.trim()) params.set('search', search.trim())
      if (typeof filters.status === 'string' && filters.status) {
        params.set('status', filters.status)
      }
      if (typeof filters.triggeredBy === 'string' && filters.triggeredBy) {
        params.set('triggeredBy', filters.triggeredBy)
      }
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/runs?${params.toString()}`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.triggeredBy, page, pageSize, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<BillRunRow>[]>(
    () => [
      {
        accessorKey: 'status',
        header: t('billing.runs.columns.status', 'Status'),
        cell: ({ row }) => {
          const mode = modeBadge(row.original)
          return (
            <div className="flex items-center gap-2">
              <Tag variant={statusVariant(row.original.status)}>
                {row.original.status}
              </Tag>
              {mode ? <Tag variant={mode.variant}>{mode.label}</Tag> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'as_of_date',
        header: t('billing.runs.columns.as_of_date', 'As-of date'),
        cell: ({ row }) => formatDateOnly(row.original.as_of_date),
      },
      {
        accessorKey: 'triggered_by',
        header: t('billing.runs.columns.triggered_by', 'Trigger'),
      },
      {
        id: 'drafts_created',
        header: t('billing.runs.columns.drafts', 'Drafts'),
        cell: ({ row }) => row.original.summary?.drafts_created ?? '—',
      },
      {
        id: 'accounts_processed',
        header: t('billing.runs.columns.accounts', 'Accounts'),
        cell: ({ row }) => row.original.summary?.accounts_processed ?? '—',
      },
      {
        id: 'accounts_failed',
        header: t('billing.runs.columns.failed', 'Failed'),
        cell: ({ row }) => {
          const failed = row.original.summary?.accounts_failed ?? 0
          if (failed === 0) return '—'
          return <Tag variant="error">{failed}</Tag>
        },
      },
      {
        accessorKey: 'started_at',
        header: t('billing.runs.columns.started_at', 'Started'),
        cell: ({ row }) => formatDate(row.original.started_at),
      },
      {
        accessorKey: 'finished_at',
        header: t('billing.runs.columns.finished_at', 'Finished'),
        cell: ({ row }) => formatDate(row.original.finished_at),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Link
            href={`/backend/billing/runs/${row.original.id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('billing.runs.actions.open', 'Open')}
          </Link>
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.runs.title', 'Bill Runs')}
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-runs' }}
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
