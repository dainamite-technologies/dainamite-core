'use client'

import * as React from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import type { SubscriptionStatusAction } from '../../../../../../lib/subscriptionStatusActions'

/**
 * D6 (spec 2026-11-26 line status): pause / suspend / grace / resume /
 * terminate a subscription or one item, through
 * `POST /api/cpq/inventory/subscriptions/actions`. Billing follows through the
 * emitted event. Cmd/Ctrl+Enter submits, Escape cancels (dialog primitive).
 */
export type StatusActionTarget = {
  subscriptionId: string
  /** Omitted = the whole subscription. */
  subscriptionItemId?: string
  /** Subscription or item name, for the title. */
  label: string
  action: SubscriptionStatusAction
}

export function statusActionLabel(t: TranslateFn, action: SubscriptionStatusAction): string {
  switch (action) {
    case 'pause': return t('cpq.inventory.statusActions.action.pause', 'Pause')
    case 'suspend': return t('cpq.inventory.statusActions.action.suspend', 'Suspend')
    case 'grace': return t('cpq.inventory.statusActions.action.grace', 'Grace period')
    case 'resume': return t('cpq.inventory.statusActions.action.resume', 'Resume')
    case 'terminate': return t('cpq.inventory.statusActions.action.terminate', 'Terminate')
  }
}

function actionHint(t: TranslateFn, action: SubscriptionStatusAction): string {
  switch (action) {
    case 'pause': return t('cpq.inventory.statusActions.hint.pause', 'The customer asked to stop for a while. By default billing does not charge paused days.')
    case 'suspend': return t('cpq.inventory.statusActions.hint.suspend', 'The service is cut, usually for non-payment. By default billing keeps charging.')
    case 'grace': return t('cpq.inventory.statusActions.hint.grace', 'Payment is overdue but the service stays on. Billed normally; a warning before a suspension.')
    case 'resume': return t('cpq.inventory.statusActions.hint.resume', 'The service runs again from the date below; billing ends the open stop period the day before.')
    case 'terminate': return t('cpq.inventory.statusActions.hint.terminate', 'Ends the service on the date below. Billing ends the billing items like a cancellation.')
  }
}

const today = () => new Date().toISOString().slice(0, 10)

export function StatusActionDialog({
  target,
  onClose,
  onDone,
}: {
  target: StatusActionTarget | null
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  const open = target !== null
  const action = target?.action ?? 'pause'
  const isStop = action === 'pause' || action === 'suspend' || action === 'grace'
  const [fromDate, setFromDate] = React.useState(today())
  const [toDate, setToDate] = React.useState('')
  const [chargeBehavior, setChargeBehavior] = React.useState<'charge' | 'no_charge'>('charge')
  const [reason, setReason] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!target) return
    setFromDate(today())
    setToDate('')
    setChargeBehavior(target.action === 'pause' ? 'no_charge' : 'charge')
    setReason('')
    setError(null)
  }, [target])

  const datesInvalid = !fromDate || (isStop && toDate !== '' && toDate < fromDate)
  const canSave = open && !saving && !datesInvalid

  const save = async () => {
    if (!target || !canSave) return
    setSaving(true)
    setError(null)
    const body = {
      subscriptionId: target.subscriptionId,
      ...(target.subscriptionItemId ? { subscriptionItemId: target.subscriptionItemId } : {}),
      action: target.action,
      fromDate,
      ...(isStop && toDate ? { toDate } : {}),
      ...(isStop ? { chargeBehavior } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }
    const call = await apiCall<{ error?: string }>('/api/cpq/inventory/subscriptions/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (call.ok) { onDone(); onClose(); return }
    setError(call.result?.error ?? t('cpq.inventory.statusActions.error', 'The status change failed.'))
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-status-action-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('cpq.inventory.statusActions.title', '{action}: {target}', { action: statusActionLabel(t, action), target: target?.label ?? '' })}
          </DialogTitle>
          <DialogDescription>{actionHint(t, action)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium">
                {action === 'resume'
                  ? t('cpq.inventory.statusActions.fields.resumeDate', 'Running again from')
                  : action === 'terminate'
                    ? t('cpq.inventory.statusActions.fields.effectiveDate', 'Effective date')
                    : t('cpq.inventory.statusActions.fields.fromDate', 'From')}
              </span>
              <Input type="date" autoFocus value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            {isStop && (
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('cpq.inventory.statusActions.fields.toDate', 'To (optional)')}</span>
                <Input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} />
              </label>
            )}
          </div>
          {isStop && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">{t('cpq.inventory.statusActions.fields.chargeBehavior', 'Billing')}</span>
              <Select value={chargeBehavior} onValueChange={(value) => setChargeBehavior(value === 'no_charge' ? 'no_charge' : 'charge')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="charge">{t('cpq.inventory.statusActions.charge.charge', 'Keep charging')}</SelectItem>
                  <SelectItem value="no_charge">{t('cpq.inventory.statusActions.charge.noCharge', 'No charge for these days')}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('cpq.inventory.statusActions.fields.reason', 'Reason')}</span>
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
          </label>
          {datesInvalid && fromDate && (
            <p className="text-xs text-destructive">{t('cpq.inventory.statusActions.toBeforeFrom', 'The end date cannot be before the start date.')}</p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.inventory.statusActions.cancel', 'Cancel')}</Button>
          <Button
            variant={action === 'terminate' ? 'destructive' : 'default'}
            onClick={() => void save()}
            disabled={!canSave}
            title={t('cpq.inventory.statusActions.saveShortcut', 'Ctrl/Cmd+Enter')}
          >
            {saving ? t('cpq.inventory.statusActions.saving', 'Saving…') : statusActionLabel(t, action)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default StatusActionDialog
