"use client"
import * as React from 'react'
import { Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'

/**
 * "Post invoices" for a REAL Bill Run: posts every draft invoice the run
 * wrote. Batches through `POST /api/billing/runs/{id}/post-drafts` (cursor
 * paging) so large runs never become one long request, showing progress on
 * the button. Renders nothing when the run has no drafts left.
 */

type BatchResult = {
  posted: number
  failed: Array<{ invoiceId: string; number: string; error: string; code: string | null }>
  nextCursor: string | null
  remaining: number
  stoppedReason: string | null
}

const BATCH_SIZE = 25

export function PostRunDraftsButton({ runId, onPosted }: { runId: string; onPosted: () => void }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [draftCount, setDraftCount] = React.useState<number | null>(null)
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)

  const loadCount = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ billRunId: runId, status: 'draft', testRun: 'false', pageSize: '1' })
      const result = await readApiResultOrThrow<{ total?: number }>(`/api/billing/invoices?${params.toString()}`)
      setDraftCount(result.total ?? 0)
    } catch {
      setDraftCount(0)
    }
  }, [runId])

  React.useEffect(() => {
    void loadCount()
  }, [loadCount])

  const handlePost = React.useCallback(async () => {
    if (!draftCount) return
    const ok = await confirm({
      title: t('billing.runs.post.confirm.title', 'Post the draft invoices of this run?'),
      text: `${t(
        'billing.runs.post.confirm.text',
        'Each draft gets its final number, due date and frozen PDF; invoices set to auto-send are emailed. Posted invoices cannot be edited. Drafts:',
      )} ${draftCount}`,
      confirmText: t('billing.runs.post.confirm.button', 'Post invoices'),
    })
    if (!ok) return
    const total = draftCount
    let done = 0
    let posted = 0
    const failed: BatchResult['failed'] = []
    let cursor: string | null = null
    let stoppedReason: string | null = null
    setProgress({ done, total })
    try {
      // Bounded by the draft count: every batch advances the cursor or stops.
      for (let guard = 0; guard <= Math.ceil(total / BATCH_SIZE) + 1; guard += 1) {
        const call: { result?: BatchResult | null } = await apiCallOrThrow<BatchResult>(
          `/api/billing/runs/${encodeURIComponent(runId)}/post-drafts`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: BATCH_SIZE, ...(cursor ? { afterInvoiceId: cursor } : {}) }),
          },
        )
        const batch = call.result
        if (!batch) break
        posted += batch.posted
        failed.push(...batch.failed)
        done += batch.posted + batch.failed.length
        setProgress({ done: Math.min(done, total), total })
        if (batch.stoppedReason) {
          stoppedReason = batch.stoppedReason
          break
        }
        if (batch.remaining === 0 || !batch.nextCursor || batch.nextCursor === cursor) break
        cursor = batch.nextCursor
      }
      if (stoppedReason === 'billing.settings.incomplete') {
        flash(
          t('billing.invoices.post.settings_incomplete', 'Fill in the seller details in Settings → Billing before posting invoices.'),
          'error',
        )
      } else if (failed.length > 0) {
        const sample = failed
          .slice(0, 3)
          .map((f) => `${f.number}: ${f.error}`)
          .join('; ')
        flash(
          `${t('billing.runs.post.partial', 'Posted')} ${posted} · ${t('billing.runs.post.failed', 'failed')} ${failed.length} — ${sample}`,
          'warning',
        )
      } else {
        flash(`${t('billing.runs.post.success', 'Invoices posted')}: ${posted}`, 'success')
      }
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.runs.post.error', 'Posting failed'), 'error')
    } finally {
      setProgress(null)
      void loadCount()
      onPosted()
    }
  }, [confirm, draftCount, onPosted, runId, t])

  if (!draftCount && !progress) return ConfirmDialogElement
  return (
    <>
      <Button type="button" onClick={() => void handlePost()} disabled={progress !== null}>
        <Send size={16} />
        {progress
          ? `${t('billing.runs.post.in_progress', 'Posting…')} ${progress.done}/${progress.total}`
          : `${t('billing.runs.post.action', 'Post invoices')} (${draftCount})`}
      </Button>
      {ConfirmDialogElement}
    </>
  )
}
