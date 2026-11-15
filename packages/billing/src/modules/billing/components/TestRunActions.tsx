"use client"
import * as React from 'react'
import { Eraser, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'

export type BillRunMode = 'real' | 'test' | 'dry'

export function billRunMode(run: { dry_run?: boolean | null; test_mode?: boolean | null }): BillRunMode {
  if (run.dry_run) return 'dry'
  if (run.test_mode) return 'test'
  return 'real'
}

export type TestRunActionsProps = {
  runId: string
  mode: BillRunMode
  /** Test drafts the run wrote (from the run summary), for the confirm text. */
  draftsCount?: number
  onWiped?: (invoicesRemoved: number) => void
  onDeleted?: (invoicesRemoved: number) => void
}

/**
 * Confirm-then-call cleanup flows for a test / dry Bill Run (Spec F, F1),
 * shared by the run detail page, the runs list row action and the account
 * "Run billing" dialog. Each call resolves to the removed invoice count, or
 * `null` when the operator cancelled or the call failed (already flashed).
 */
export function useTestRunCleanup() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [busy, setBusy] = React.useState<'wipe' | 'delete' | null>(null)

  const wipe = React.useCallback(
    async (runId: string): Promise<number | null> => {
      const ok = await confirm({
        title: t('billing.runs.wipe.confirm.title', 'Wipe test invoices?'),
        text: t(
          'billing.runs.wipe.confirm.text',
          'Every test invoice from this Bill Run will be permanently deleted. The run itself stays. This cannot be undone.',
        ),
        confirmText: t('billing.runs.wipe.confirm.button', 'Delete test invoices'),
        variant: 'destructive',
      })
      if (!ok) return null
      setBusy('wipe')
      try {
        const call = await apiCallOrThrow<{ invoicesRemoved: number }>('/api/billing/test-invoices/wipe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billRunId: runId }),
        })
        const removed = call.result?.invoicesRemoved ?? 0
        flash(`${t('billing.runs.wipe.success', 'Test invoices removed')} (${removed})`, 'success')
        return removed
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.runs.wipe.error', 'Wipe failed'), 'error')
        return null
      } finally {
        setBusy(null)
      }
    },
    [confirm, t],
  )

  const remove = React.useCallback(
    async (params: { runId: string; mode: BillRunMode; draftsCount?: number }): Promise<number | null> => {
      const text =
        params.mode === 'test' && typeof params.draftsCount === 'number' && params.draftsCount > 0
          ? `${t('billing.runs.delete.confirm.text_with_invoices', 'The run, its results and its test invoices will be permanently deleted. Test invoices:')} ${params.draftsCount}`
          : t('billing.runs.delete.confirm.text', 'The run and its results will be permanently deleted.')
      const ok = await confirm({
        title: t('billing.runs.delete.confirm.title', 'Delete this run?'),
        text,
        confirmText: t('billing.runs.delete.confirm.button', 'Delete run'),
        variant: 'destructive',
      })
      if (!ok) return null
      setBusy('delete')
      try {
        const call = await apiCallOrThrow<{ invoicesRemoved: number }>(
          `/api/billing/runs/${encodeURIComponent(params.runId)}`,
          { method: 'DELETE' },
        )
        flash(t('billing.runs.delete.success', 'Run deleted'), 'success')
        return call.result?.invoicesRemoved ?? 0
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.runs.delete.error', 'Delete failed'), 'error')
        return null
      } finally {
        setBusy(null)
      }
    },
    [confirm, t],
  )

  return { wipe, remove, busy, ConfirmDialogElement }
}

/**
 * Cleanup buttons for a test / dry Bill Run: "Wipe test invoices" keeps the
 * run, "Delete run" removes it with its test invoices. Renders nothing for
 * real runs (they are never deleted).
 */
export function TestRunActions({ runId, mode, draftsCount, onWiped, onDeleted }: TestRunActionsProps) {
  const t = useT()
  const { wipe, remove, busy, ConfirmDialogElement } = useTestRunCleanup()

  if (mode === 'real') return null
  return (
    <>
      {mode === 'test' ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={async () => {
            const removed = await wipe(runId)
            if (removed !== null) onWiped?.(removed)
          }}
        >
          <Eraser size={16} />
          {busy === 'wipe'
            ? t('billing.runs.wipe.in_progress', 'Wiping…')
            : t('billing.runs.wipe.action', 'Wipe test invoices')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        disabled={busy !== null}
        onClick={async () => {
          const removed = await remove({ runId, mode, draftsCount })
          if (removed !== null) onDeleted?.(removed)
        }}
      >
        <Trash2 size={16} />
        {busy === 'delete'
          ? t('billing.runs.delete.in_progress', 'Deleting…')
          : t('billing.runs.delete.action', 'Delete run')}
      </Button>
      {ConfirmDialogElement}
    </>
  )
}
