"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
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
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { localTodayIso } from '../lib/dateOnly'
import {
  defaultChargeBehavior,
  STATUS_PERIOD_OVERLAP,
  STATUS_PERIOD_READ_ONLY,
  STATUS_PERIOD_RECURRING_ONLY,
  STATUS_PERIOD_END_BEFORE_START,
  type ItemStatus,
  type StatusChargeBehavior,
} from '../lib/itemStatusPeriods'
import { statusName } from './ItemLineLabels'

/**
 * Pause / Suspend / Grace period dialog (line-period-and-status spec §4.3).
 *
 *   target = item     POST /api/billing/items/status-periods
 *   target = account  POST /api/billing/items/status-periods/bulk — every
 *                     recurring line of the account; lines that cannot take
 *                     the status come back in `skipped` and are reported.
 *
 * From (default today), To (optional = open-ended), charge behaviour
 * (paused: no charge default; suspended: keep charging default; grace is a
 * flag only and always charges) and an optional reason.
 */

type Translate = ReturnType<typeof useT>

export type BulkStatusResult = {
  created: Array<{ id: string; billingItemId: string }>
  skipped: Array<{ billingItemId: string; reason: 'read_only' | 'overlap' | 'ended' }>
}

export type ItemStatusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: { kind: 'item'; itemId: string } | { kind: 'account'; accountId: string }
  /** Preselected status; the account dialog lets the operator switch it. */
  status: ItemStatus
  onSaved: (result?: BulkStatusResult) => void
}

/** The `code` of a billing API error (`{ code }` body), when present. */
export function serverErrorCode(err: unknown): string | null {
  const body = (err as { body?: { code?: unknown } } | null)?.body
  return typeof body?.code === 'string' ? body.code : null
}

/** Translated message for a status-period write error. */
export function statusErrorMessage(t: Translate, err: unknown): string {
  const code = serverErrorCode(err)
  switch (code) {
    case STATUS_PERIOD_OVERLAP:
      return t('billing.items.status.error.overlap', 'This line already has a status in that period. End or remove it first.')
    case STATUS_PERIOD_READ_ONLY:
      return t('billing.items.status.error.read_only', 'Status comes from the CPQ subscription — change it in CPQ.')
    case STATUS_PERIOD_RECURRING_ONLY:
      return t('billing.items.status.error.recurring_only', 'Only recurring lines can be paused or suspended.')
    case STATUS_PERIOD_END_BEFORE_START:
      return t('billing.items.status.error.end_before_start', 'The end date cannot be before the start date.')
  }
  const { message } = normalizeCrudServerError(err)
  return message || t('billing.items.status.error.save', 'Could not save the status')
}

export function ItemStatusDialog({ open, onOpenChange, target, status: initialStatus, onSaved }: ItemStatusDialogProps) {
  const t = useT()
  const [status, setStatus] = React.useState<ItemStatus>(initialStatus)
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')
  const [chargeBehavior, setChargeBehavior] = React.useState<StatusChargeBehavior>(defaultChargeBehavior(initialStatus))
  const [reason, setReason] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const { runMutation } = useGuardedMutation<{ target: string }>({ contextId: 'billing-item-status' })

  React.useEffect(() => {
    if (!open) return
    setStatus(initialStatus)
    setFromDate(localTodayIso())
    setToDate('')
    setChargeBehavior(defaultChargeBehavior(initialStatus))
    setReason('')
  }, [initialStatus, open])

  const changeStatus = (next: ItemStatus) => {
    setStatus(next)
    setChargeBehavior(defaultChargeBehavior(next))
  }

  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && (!toDate || toDate >= fromDate)
  const isAccount = target.kind === 'account'

  const handleSubmit = React.useCallback(async () => {
    if (!datesValid || saving) return
    setSaving(true)
    const body: Record<string, unknown> = {
      status,
      fromDate,
      toDate: toDate || null,
      reason: reason.trim() || null,
    }
    // Grace is a flag only — billed normally; the server ignores the behaviour.
    if (status !== 'grace') body.chargeBehavior = chargeBehavior
    try {
      if (target.kind === 'item') {
        body.billingItemId = target.itemId
        await runMutation({
          operation: () =>
            apiCallOrThrow('/api/billing/items/status-periods', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          context: { target: target.itemId },
          mutationPayload: body,
        })
        flash(t('billing.items.status.saved', '{status} set', { status: statusName(t, status) }), 'success')
        onOpenChange(false)
        onSaved()
      } else {
        body.billAccountId = target.accountId
        const call = await runMutation({
          operation: () =>
            apiCallOrThrow<BulkStatusResult>('/api/billing/items/status-periods/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          context: { target: target.accountId },
          mutationPayload: body,
        })
        const result: BulkStatusResult = {
          created: call.result?.created ?? [],
          skipped: call.result?.skipped ?? [],
        }
        flash(
          t('billing.accounts.items.bulk_status.saved', '{status} set on {count} lines', {
            status: statusName(t, status),
            count: result.created.length,
          }),
          result.created.length > 0 ? 'success' : 'warning',
        )
        onOpenChange(false)
        onSaved(result)
      }
    } catch (err) {
      flash(statusErrorMessage(t, err), 'error')
    } finally {
      setSaving(false)
    }
  }, [chargeBehavior, datesValid, fromDate, onOpenChange, onSaved, reason, runMutation, saving, status, t, target, toDate])

  const title = isAccount
    ? t('billing.accounts.items.bulk_status.title', 'Pause / suspend all lines')
    : status === 'paused'
      ? t('billing.items.status.pause_title', 'Pause line')
      : status === 'suspended'
        ? t('billing.items.status.suspend_title', 'Suspend line')
        : t('billing.items.status.grace_title', 'Start grace period')

  return (
    <Dialog open={open} onOpenChange={(next) => (!saving ? onOpenChange(next) : undefined)}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleSubmit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isAccount
              ? t(
                  'billing.accounts.items.bulk_status.description',
                  'Sets the status on every recurring line of this account. CPQ lines, lines that already have a status in the period and ended lines are skipped.',
                )
              : status === 'grace'
                ? t('billing.items.status.grace_help', 'Payment is overdue but the service stays on. The line is billed normally.')
                : t('billing.items.status.description', 'The status runs from the first day to the last day (both included). Leave the end empty for an open-ended status.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isAccount ? (
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">{t('billing.items.status.field.status', 'Status')}</span>
              <Select value={status} onValueChange={(next) => changeStatus(next as ItemStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paused">{statusName(t, 'paused')}</SelectItem>
                  <SelectItem value="suspended">{statusName(t, 'suspended')}</SelectItem>
                  <SelectItem value="grace">{statusName(t, 'grace')}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('billing.items.status.field.from', 'From')}</span>
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('billing.items.status.field.to', 'To (optional)')}</span>
            <Input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.currentTarget.value)} />
            {toDate && toDate < fromDate ? (
              <span className="text-xs text-destructive">
                {t('billing.items.status.error.end_before_start', 'The end date cannot be before the start date.')}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('billing.items.status.field.to_help', 'Last day of the status. Empty = until resumed.')}
              </span>
            )}
          </label>
          {status !== 'grace' ? (
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">{t('billing.items.status.field.charge', 'Charging')}</span>
              <Select
                value={chargeBehavior}
                onValueChange={(next) => setChargeBehavior(next === 'no_charge' ? 'no_charge' : 'charge')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="charge">{t('billing.items.status.charge.charge', 'Keep charging')}</SelectItem>
                  <SelectItem value="no_charge">{t('billing.items.status.charge.no_charge', 'No charge')}</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {chargeBehavior === 'no_charge'
                  ? t(
                      'billing.items.status.charge.no_charge_help',
                      'No recurring charge for these days. Days already billed in advance are credited on the next Bill Run.',
                    )
                  : t('billing.items.status.charge.charge_help', 'The line keeps being billed while the status is on.')}
              </span>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">{t('billing.items.status.field.reason', 'Reason (optional)')}</span>
            <Textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
          </label>
        </div>
        <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> {t('billing.items.form.submit_hint', 'to save,')} <Kbd>Esc</Kbd>{' '}
            {t('billing.items.form.cancel_hint', 'to discard')}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('billing.common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!datesValid || saving}>
              {saving ? t('billing.items.form.saving', 'Saving…') : t('billing.items.status.submit', 'Set status')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
