'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  DECLINE_ISSUE_FALLBACKS,
  buildDeclineBody,
  classifySourcingError,
  declineIssues,
  type SourcingFailure,
} from '../../../../lib/costSourcingView'
import { SourcingErrorAlert, SourcingField, submitOnModEnter, type SourcingDialogProps } from './sourcingDialogShared'

/** Decline a supplier cost request (shared by the page and the quote Costs panel). Ctrl/Cmd+Enter declines, Escape cancels. */
export function DeclineCostDialog({ target, onClose, onDone, onFailure }: SourcingDialogProps) {
  const t = useT()
  const [reason, setReason] = React.useState('')
  const [showIssues, setShowIssues] = React.useState(false)
  const [failure, setFailure] = React.useState<SourcingFailure | null>(null)
  const [saving, setSaving] = React.useState(false)
  const issues = declineIssues(reason)

  const submit = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setFailure(null)
    const call = await apiCall<{ outcome?: string }>(`/api/cpq/quotes/${target.quoteId}/costs/${target.costId}/decline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildDeclineBody(reason, target.costRequestId)),
    })
    setSaving(false)
    if (call.ok) { onDone(call.result?.outcome); return }
    const next = classifySourcingError(call.status, call.result)
    if (next.effect === 'stay') setFailure(next)
    else onFailure(next)
  }

  const shown = showIssues ? issues.map((issue) => t(`cpq.costRequests.decline.issues.${issue}`, DECLINE_ISSUE_FALLBACKS[issue])) : []
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={submitOnModEnter(() => void submit())} data-testid="cpq-decline-cost-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.costRequests.decline.title', 'Decline cost request')}</DialogTitle>
          <DialogDescription>{[target.costName, target.contextLabel].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('cpq.costRequests.requestId', 'Request {id} (#{seq})', { id: target.costRequestId, seq: target.requestSeq ?? '—' })}
          </p>
          <SourcingField
            label={`${t('cpq.costRequests.decline.reason', 'Reason')} *`}
            hint={target.locked
              ? t('cpq.costRequests.decline.lockedHint', 'The estimate stays on the sent quote but conversion is blocked until an alternative value is entered.')
              : undefined}
          >
            <Textarea autoFocus rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </SourcingField>
          <SourcingErrorAlert failure={failure} issues={shown} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.costRequests.cancel', 'Cancel')}</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={saving} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')} data-testid="cpq-decline-submit">
            {saving ? t('cpq.costRequests.saving', 'Saving…') : t('cpq.costRequests.decline.submit', 'Decline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
