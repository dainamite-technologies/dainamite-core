"use client"
import * as React from 'react'
import { useParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'

/**
 * Bill Run detail — header card + outcomes list.
 *
 * The "Retry failed accounts" button is enabled only when the run
 * has at least one failed outcome. It POSTs the
 * `billing.runs.retry_failed` endpoint, which creates a new run
 * scoped to those accounts (the new run shows up in the list at
 * `/backend/billing/runs`).
 */

type BillRun = {
  id: string
  triggeredBy: 'schedule' | 'manual'
  parentRunId: string | null
  dryRun: boolean
  testMode: boolean
  catchUp: boolean
  asOfDate: string
  startedAt: string | null
  finishedAt: string | null
  status: 'running' | 'completed' | 'partial_failure' | 'failed'
  summary: {
    accounts_processed?: number
    drafts_created?: number
    drafts_skipped_existing?: number
    accounts_failed?: number
    accounts_with_warnings?: number
    usage_records_rated?: number
  } | null
  organizationId: string
  tenantId: string
  createdAt: string
  updatedAt: string
}

type BillRunOutcome = {
  id: string
  billRunId: string
  billAccountId: string
  status: 'success' | 'success_with_warnings' | 'skipped_existing_draft' | 'failed'
  errorMessage: string | null
  warnings: Record<string, unknown> | null
  draftInvoiceId: string | null
  createdAt: string
}

type ListResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function runStatusVariant(
  status: BillRun['status'],
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'partial_failure':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'default'
  }
}

function outcomeStatusVariant(
  status: BillRunOutcome['status'],
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'success':
      return 'success'
    case 'success_with_warnings':
      return 'warning'
    case 'failed':
      return 'error'
    case 'skipped_existing_draft':
    default:
      return 'default'
  }
}

export default function BillRunDetailPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const runId = typeof params.id === 'string' ? params.id : ''

  const [run, setRun] = React.useState<BillRun | null>(null)
  const [runError, setRunError] = React.useState<string | null>(null)
  const [outcomes, setOutcomes] = React.useState<BillRunOutcome[]>([])
  const [outcomesPage, setOutcomesPage] = React.useState(1)
  const [outcomesTotal, setOutcomesTotal] = React.useState(0)
  const [outcomesTotalPages, setOutcomesTotalPages] = React.useState(1)
  const [outcomesLoading, setOutcomesLoading] = React.useState(true)
  const [retrying, setRetrying] = React.useState(false)

  const loadRun = React.useCallback(async () => {
    if (!runId) return
    setRunError(null)
    try {
      const result = await readApiResultOrThrow<ListResponse<BillRun>>(
        `/api/billing/runs?id=${runId}&pageSize=1`,
      )
      const found = result.items?.[0]
      if (!found) {
        setRunError(t('billing.runs.detail.error.not_found', 'Run not found'))
        setRun(null)
        return
      }
      setRun(found)
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      setRunError(message || t('billing.runs.detail.error.load', 'Failed to load run'))
    }
  }, [runId, t])

  const loadOutcomes = React.useCallback(async () => {
    if (!runId) return
    setOutcomesLoading(true)
    try {
      const params = new URLSearchParams({
        billRunId: runId,
        page: String(outcomesPage),
        pageSize: '50',
      })
      const result = await readApiResultOrThrow<ListResponse<BillRunOutcome>>(
        `/api/billing/run-outcomes?${params.toString()}`,
      )
      setOutcomes(result.items ?? [])
      setOutcomesTotal(result.total ?? 0)
      setOutcomesTotalPages(result.totalPages ?? 1)
    } finally {
      setOutcomesLoading(false)
    }
  }, [outcomesPage, runId])

  React.useEffect(() => {
    void loadRun()
  }, [loadRun])
  React.useEffect(() => {
    void loadOutcomes()
  }, [loadOutcomes])

  const failedCount = run?.summary?.accounts_failed ?? 0

  const handleRetryFailed = React.useCallback(async () => {
    if (!run || failedCount === 0) return
    setRetrying(true)
    try {
      const call = await apiCallOrThrow<{ billRunId: string; outcomesCount: number }>(
        '/api/billing/runs/retry-failed',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billRunId: run.id }),
        },
      )
      const outcomesCount = call.result?.outcomesCount ?? 0
      flash(
        t('billing.runs.retry.success', 'Retry run created') +
          ` (${outcomesCount} accounts)`,
        'success',
      )
      // Refresh — the new run shows up in the list view; the current
      // run's outcomes are immutable so no reload of `loadOutcomes`
      // needed, but loadRun is cheap.
      void loadRun()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.runs.retry.error', 'Retry failed'), 'error')
    } finally {
      setRetrying(false)
    }
  }, [failedCount, loadRun, run, t])

  const outcomeColumns = React.useMemo<ColumnDef<BillRunOutcome>[]>(
    () => [
      {
        accessorKey: 'billAccountId',
        header: t('billing.runs.outcomes.columns.account', 'Account'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.billAccountId}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('billing.runs.outcomes.columns.status', 'Status'),
        cell: ({ row }) => (
          <Tag variant={outcomeStatusVariant(row.original.status)}>
            {row.original.status}
          </Tag>
        ),
      },
      {
        accessorKey: 'draftInvoiceId',
        header: t('billing.runs.outcomes.columns.invoice', 'Invoice'),
        cell: ({ row }) =>
          row.original.draftInvoiceId ? (
            <span className="font-mono text-xs">{row.original.draftInvoiceId}</span>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'errorMessage',
        header: t('billing.runs.outcomes.columns.error', 'Error'),
        cell: ({ row }) => row.original.errorMessage ?? '—',
      },
      {
        accessorKey: 'warnings',
        header: t('billing.runs.outcomes.columns.warnings', 'Warnings'),
        cell: ({ row }) => {
          if (!row.original.warnings) return '—'
          return (
            <span className="font-mono text-xs">{JSON.stringify(row.original.warnings)}</span>
          )
        },
      },
    ],
    [t],
  )

  if (runError) {
    return (
      <Page title={t('billing.runs.detail.title', 'Bill Run')}>
        <PageBody>
          <ErrorMessage label={runError} />
        </PageBody>
      </Page>
    )
  }

  if (!run) {
    return (
      <Page title={t('billing.runs.detail.title', 'Bill Run')}>
        <PageBody>
          <LoadingMessage label={t('billing.runs.detail.loading', 'Loading run…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page title={t('billing.runs.detail.title', 'Bill Run')}>
      <PageBody>
        <div className="rounded-lg border border-border bg-card p-6 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Tag variant={runStatusVariant(run.status)}>{run.status}</Tag>
                {run.dryRun ? <Tag variant="warning">Dry-run</Tag> : null}
                {run.testMode ? <Tag variant="warning">Test</Tag> : null}
                {run.catchUp ? <Tag variant="default">Catch-up</Tag> : null}
              </div>
              <div className="text-xs text-muted-foreground font-mono mb-3">{run.id}</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                  {t('billing.runs.detail.field.triggered_by', 'Trigger')}
                </dt>
                <dd>{run.triggeredBy}</dd>
                <dt className="text-muted-foreground">
                  {t('billing.runs.detail.field.as_of_date', 'As-of date')}
                </dt>
                <dd>{run.asOfDate?.slice(0, 10) ?? '—'}</dd>
                <dt className="text-muted-foreground">
                  {t('billing.runs.detail.field.started_at', 'Started')}
                </dt>
                <dd>{formatDate(run.startedAt)}</dd>
                <dt className="text-muted-foreground">
                  {t('billing.runs.detail.field.finished_at', 'Finished')}
                </dt>
                <dd>{formatDate(run.finishedAt)}</dd>
                {run.parentRunId ? (
                  <>
                    <dt className="text-muted-foreground">
                      {t('billing.runs.detail.field.parent_run', 'Parent run')}
                    </dt>
                    <dd className="font-mono text-xs">{run.parentRunId}</dd>
                  </>
                ) : null}
              </dl>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <Button
                variant={failedCount > 0 ? 'default' : 'outline'}
                disabled={failedCount === 0 || retrying}
                onClick={handleRetryFailed}
              >
                {retrying
                  ? t('billing.runs.retry.in_progress', 'Retrying…')
                  : t('billing.runs.retry.action', 'Retry failed accounts')}
                {failedCount > 0 ? ` (${failedCount})` : null}
              </Button>
            </div>
          </div>
          {run.summary ? (
            <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">
                  {t('billing.runs.summary.accounts', 'Accounts')}
                </div>
                <div className="text-lg font-semibold">
                  {run.summary.accounts_processed ?? 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('billing.runs.summary.drafts', 'Drafts')}
                </div>
                <div className="text-lg font-semibold">
                  {run.summary.drafts_created ?? 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('billing.runs.summary.skipped', 'Skipped')}
                </div>
                <div className="text-lg font-semibold">
                  {run.summary.drafts_skipped_existing ?? 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('billing.runs.summary.warnings', 'Warnings')}
                </div>
                <div className="text-lg font-semibold">
                  {run.summary.accounts_with_warnings ?? 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('billing.runs.summary.failed', 'Failed')}
                </div>
                <div className="text-lg font-semibold">
                  {run.summary.accounts_failed ?? 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('billing.runs.summary.usage', 'Usage rated')}
                </div>
                <div className="text-lg font-semibold">
                  {run.summary.usage_records_rated ?? 0}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <h2 className="text-base font-semibold mb-2">
          {t('billing.runs.outcomes.title', 'Per-account outcomes')}
        </h2>
        <DataTable
          columns={outcomeColumns}
          data={outcomes}
          isLoading={outcomesLoading}
          pagination={{
            page: outcomesPage,
            pageSize: 50,
            total: outcomesTotal,
            totalPages: outcomesTotalPages,
            onPageChange: setOutcomesPage,
          }}
        />
      </PageBody>
    </Page>
  )
}
