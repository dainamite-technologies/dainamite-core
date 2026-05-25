"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { billRunName } from '../../../lib/billRunLabel'

/**
 * Bill Runs admin list page.
 *
 * Lists every Bill Run for the operator's tenant with status, mode,
 * summary stats, and a link into the detail page. The "New run" button
 * opens an inline trigger dialog that posts to `/api/billing/runs` —
 * same endpoint operators previously had to curl by hand. Retry-failed
 * stays on the run detail page (scoped to a specific run's failures).
 */

type TriggerMode = 'real' | 'dry' | 'test'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

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
  const router = useRouter()
  const [rows, setRows] = React.useState<BillRunRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')

  // Trigger dialog — controls the New-run modal and its submit state.
  const [triggerOpen, setTriggerOpen] = React.useState(false)
  const [triggerMode, setTriggerMode] = React.useState<TriggerMode>('real')
  const [triggerAsOfDate, setTriggerAsOfDate] = React.useState<string>(todayIso())
  const [triggering, setTriggering] = React.useState(false)

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

  const handleTrigger = React.useCallback(async () => {
    setTriggering(true)
    try {
      const payload: Record<string, unknown> = { mode: triggerMode }
      if (triggerAsOfDate) payload.asOfDate = triggerAsOfDate
      const call = await apiCallOrThrow<{ billRunId: string | null }>(
        '/api/billing/runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      flash(t('billing.runs.trigger.success', 'Bill Run triggered'), 'success')
      setTriggerOpen(false)
      const newId = call.result?.billRunId
      if (newId) {
        router.push(`/backend/billing/runs/${newId}`)
      } else {
        void loadRows()
      }
    } catch (err) {
      const { message, fieldErrors } = normalizeCrudServerError(err)
      const fieldDetail =
        fieldErrors && Object.keys(fieldErrors).length
          ? Object.entries(fieldErrors)
              .map(([field, msg]) => `${field}: ${msg}`)
              .join('; ')
          : null
      const detailed =
        fieldDetail && message ? `${message} — ${fieldDetail}` : fieldDetail || message
      flash(detailed || t('billing.runs.trigger.error', 'Failed to trigger run'), 'error')
    } finally {
      setTriggering(false)
    }
  }, [loadRows, router, t, triggerAsOfDate, triggerMode])

  const handleTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!triggering) void handleTrigger()
      }
    },
    [handleTrigger, triggering],
  )

  const columns = React.useMemo<ColumnDef<BillRunRow>[]>(
    () => [
      {
        id: 'name',
        header: t('billing.runs.columns.name', 'Bill Run'),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-primary">
            {billRunName(row.original.as_of_date)}
          </span>
        ),
      },
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
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('billing.runs.title', 'Bill Runs')}
          actions={
            <Button onClick={() => setTriggerOpen(true)}>
              <Play size={16} />
              {t('billing.runs.trigger.action', 'New run')}
            </Button>
          }
          refreshButton={{
            label: t('billing.common.refresh', 'Refresh'),
            onRefresh: loadRows,
            isRefreshing: loading,
          }}
          columnChooser={{ auto: true }}
          perspective={{ tableId: 'billing-runs' }}
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/billing/runs/${row.id}`)}
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

        <Dialog open={triggerOpen} onOpenChange={(next) => !triggering && setTriggerOpen(next)}>
          <DialogContent onKeyDown={handleTriggerKeyDown}>
            <DialogHeader>
              <DialogTitle>
                {t('billing.runs.trigger.dialog.title', 'Trigger Bill Run')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'billing.runs.trigger.dialog.description',
                  'Runs the bill cycle for every account whose next bill date has passed. Dry-run / Test produce drafts without posting any invoices.',
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {t('billing.runs.trigger.dialog.mode', 'Mode')}
                </span>
                <Select
                  value={triggerMode}
                  onValueChange={(next) => setTriggerMode(next as TriggerMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="real">
                      {t('billing.runs.trigger.dialog.mode.real', 'Real — create draft invoices')}
                    </SelectItem>
                    <SelectItem value="dry">
                      {t('billing.runs.trigger.dialog.mode.dry', 'Dry-run — no rows written')}
                    </SelectItem>
                    <SelectItem value="test">
                      {t('billing.runs.trigger.dialog.mode.test', 'Test — drafts tagged for cleanup')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {t('billing.runs.trigger.dialog.as_of_date', 'As-of date')}
                </span>
                <Input
                  type="date"
                  value={triggerAsOfDate}
                  onChange={(event) => setTriggerAsOfDate(event.currentTarget.value)}
                />
                <span className="text-xs text-muted-foreground">
                  {t(
                    'billing.runs.trigger.dialog.as_of_date.help',
                    'Accounts whose next bill date is on or before this date will be billed.',
                  )}
                </span>
              </label>
            </div>
            <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
              <span className="text-xs text-muted-foreground">
                <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />{' '}
                {t('billing.runs.trigger.dialog.submit_hint', 'to run,')} <Kbd>Esc</Kbd>{' '}
                {t('billing.runs.trigger.dialog.cancel_hint', 'to cancel')}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTriggerOpen(false)}
                  disabled={triggering}
                >
                  {t('billing.common.cancel', 'Cancel')}
                </Button>
                <Button type="button" onClick={() => void handleTrigger()} disabled={triggering}>
                  {triggering
                    ? t('billing.runs.trigger.dialog.running', 'Running…')
                    : t('billing.runs.trigger.dialog.submit', 'Run now')}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
