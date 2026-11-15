"use client"
import * as React from 'react'
import { Play } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { BillRunMode } from '../TestRunActions'

/**
 * "Run billing" for one account (Spec E, E2-D3 / Spec F, F8): mode (Test by
 * default) + as-of date → `POST /api/billing/runs` with
 * `scopedAccountIds: [id]`. On success the dialog closes with a one-line
 * summary; the workspace switches to its Bill runs tab, where the run (with
 * its mode, documents and cleanup actions) is listed.
 */

type OutcomeRow = { status: string; error_message: string | null; cycles: Array<{ status: string }> | null }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export type AccountRunBillingDialogProps = {
  accountId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a run finished — the workspace closes the dialog and refreshes. */
  onCompleted: (billRunId: string) => void
}

export function AccountRunBillingDialog({ accountId, open, onOpenChange, onCompleted }: AccountRunBillingDialogProps) {
  const t = useT()
  const [mode, setMode] = React.useState<BillRunMode>('test')
  const [asOfDate, setAsOfDate] = React.useState<string>(todayIso())
  const [running, setRunning] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setMode('test')
      setAsOfDate(todayIso())
    }
  }, [open])

  const handleRun = React.useCallback(async () => {
    setRunning(true)
    try {
      const call = await apiCallOrThrow<{ billRunId: string | null }>('/api/billing/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, asOfDate, scopedAccountIds: [accountId] }),
      })
      const billRunId = call.result?.billRunId
      if (!billRunId) throw new Error(t('billing.runs.trigger.error', 'Failed to trigger run'))
      const outcomes = await readApiResultOrThrow<{ items: OutcomeRow[] }>(
        `/api/billing/run-outcomes?billRunId=${encodeURIComponent(billRunId)}&pageSize=1`,
      )
      const outcome = outcomes.items?.[0]
      if (!outcome) {
        flash(t('billing.accounts.run.nothing_due', 'Nothing is due up to this date — the next bill date is later.'), 'info')
      } else if (outcome.status === 'failed') {
        flash(`${t('billing.accounts.run.failed', 'Bill run failed')}: ${outcome.error_message ?? ''}`, 'error')
      } else {
        const cycles = (outcome.cycles ?? []).filter((cycle) => cycle.status !== 'empty').length
        flash(`${t('billing.accounts.run.done', 'Bill run completed — bill dates with charges:')} ${cycles}`, 'success')
      }
      onCompleted(billRunId)
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.runs.trigger.error', 'Failed to trigger run'), 'error')
    } finally {
      setRunning(false)
    }
  }, [accountId, asOfDate, mode, onCompleted, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!running) void handleRun()
      }
    },
    [handleRun, running],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (!running ? onOpenChange(next) : undefined)}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('billing.accounts.run.title', 'Run billing for this account')}</DialogTitle>
          <DialogDescription>
            {t(
              'billing.accounts.run.description',
              'Bills every due cycle of this account up to the as-of date. Test and dry runs change nothing on the account.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('billing.runs.trigger.dialog.mode', 'Mode')}</span>
            <Select value={mode} onValueChange={(next) => setMode(next === 'real' || next === 'dry' ? next : 'test')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">{t('billing.runs.trigger.dialog.mode.test', 'Test — drafts tagged for cleanup')}</SelectItem>
                <SelectItem value="dry">{t('billing.runs.trigger.dialog.mode.dry', 'Dry-run — no rows written')}</SelectItem>
                <SelectItem value="real">{t('billing.runs.trigger.dialog.mode.real', 'Real — create draft invoices')}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('billing.runs.trigger.dialog.as_of_date', 'As-of date')}</span>
            <Input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.currentTarget.value)} />
          </label>
        </div>
        <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> {t('billing.accounts.run.submit_hint', 'to run,')} <Kbd>Esc</Kbd>{' '}
            {t('billing.accounts.run.close_hint', 'to close')}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
              {t('billing.common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleRun()} disabled={running}>
              <Play size={16} />
              {running ? t('billing.accounts.run.running', 'Running…') : t('billing.accounts.run.action', 'Run billing')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
