'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  ANSWER_ISSUE_FALLBACKS,
  answerFormIssues,
  buildAnswerBody,
  classifySourcingError,
  emptyAnswerForm,
  type AnswerForm,
  type SourcingFailure,
} from '../../../../lib/costSourcingView'
import { SourcingErrorAlert, SourcingField, submitOnModEnter, type SourcingDialogProps } from './sourcingDialogShared'

/**
 * Answer a supplier cost request (shared by the Cost requests page and the quote Costs panel). Takes no
 * `expectedRevision`: the answer route takes the quote lock itself. Ctrl/Cmd+Enter answers, Escape cancels.
 */
export function AnswerCostDialog({ target, onClose, onDone, onFailure }: SourcingDialogProps) {
  const t = useT()
  const [form, setForm] = React.useState<AnswerForm>(() => emptyAnswerForm(target.defaultCurrency, target.supplierName ?? null))
  const [showIssues, setShowIssues] = React.useState(false)
  const [failure, setFailure] = React.useState<SourcingFailure | null>(null)
  const [saving, setSaving] = React.useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const issues = answerFormIssues(form, today)
  const set = <K extends keyof AnswerForm>(key: K, value: AnswerForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setFailure(null)
    const call = await apiCall<{ outcome?: string }>(`/api/cpq/quotes/${target.quoteId}/costs/${target.costId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildAnswerBody(form, target.costRequestId, target.supplierId)),
    })
    setSaving(false)
    if (call.ok) { onDone(call.result?.outcome); return }
    const next = classifySourcingError(call.status, call.result)
    if (next.effect === 'stay') setFailure(next)
    else onFailure(next)
  }

  const shown = showIssues ? issues.map((issue) => t(`cpq.costRequests.answer.issues.${issue}`, ANSWER_ISSUE_FALLBACKS[issue])) : []
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={submitOnModEnter(() => void submit())} data-testid="cpq-answer-cost-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.costRequests.answer.title', 'Answer cost request')}</DialogTitle>
          <DialogDescription>
            {[target.costName, target.contextLabel].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm" data-testid="cpq-answer-cost-form">
          <p className="text-xs text-muted-foreground" data-testid="cpq-answer-request-id">
            {t('cpq.costRequests.requestId', 'Request {id} (#{seq})', { id: target.costRequestId, seq: target.requestSeq ?? '—' })}
          </p>
          {target.locked && (
            <Alert variant="warning" data-testid="cpq-answer-locked">
              <AlertDescription>
                {t('cpq.costRequests.answer.lockedNotice',
                  'This quote is locked in status {status}. A different value will be recorded as a proposal; the price changes only after Reopen and apply supplier answer.',
                  { status: target.cpqStatus })}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <SourcingField label={`${t('cpq.costRequests.answer.amount', 'Unit cost')} *`}>
                <Input autoFocus inputMode="decimal" value={form.unitAmount} onChange={(event) => set('unitAmount', event.target.value)} />
              </SourcingField>
            </div>
            <SourcingField label={`${t('cpq.costRequests.answer.currency', 'Currency')} *`}>
              <Input value={form.currencyCode} maxLength={3} onChange={(event) => set('currencyCode', event.target.value.toUpperCase())} />
            </SourcingField>
          </div>
          <SourcingField label={t('cpq.costRequests.answer.valueStatus', 'Value status')}>
            <Select value={form.valueStatus} onValueChange={(next) => set('valueStatus', next as AnswerForm['valueStatus'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">{t('cpq.quoteCosts.statuses.confirmed', 'Confirmed')}</SelectItem>
                <SelectItem value="estimated">{t('cpq.costRequests.answer.budgetary', 'Budgetary estimate')}</SelectItem>
              </SelectContent>
            </Select>
          </SourcingField>
          <div className="grid grid-cols-2 gap-3">
            <SourcingField label={t('cpq.costRequests.answer.supplierName', 'Supplier')}>
              <Input value={form.supplierName} maxLength={255} onChange={(event) => set('supplierName', event.target.value)} />
            </SourcingField>
            <SourcingField label={`${t('cpq.costRequests.answer.supplierQuoteRef', 'Supplier quote reference')} *`}>
              <Input value={form.supplierQuoteRef} maxLength={100} onChange={(event) => set('supplierQuoteRef', event.target.value)} />
            </SourcingField>
            <SourcingField label={t('cpq.costRequests.answer.validUntil', 'Valid until')}>
              <Input type="date" value={form.validUntil} onChange={(event) => set('validUntil', event.target.value)} />
            </SourcingField>
            <SourcingField label={t('cpq.costRequests.answer.supplierTermEnd', 'Supplier term end')}>
              <Input type="date" value={form.supplierTermEnd} onChange={(event) => set('supplierTermEnd', event.target.value)} />
            </SourcingField>
            <SourcingField label={t('cpq.costRequests.answer.supplierMinTermMonths', 'Min. term (months)')}>
              <Input inputMode="numeric" value={form.supplierMinTermMonths} onChange={(event) => set('supplierMinTermMonths', event.target.value)} />
            </SourcingField>
          </div>
          <SourcingField label={t('cpq.costRequests.answer.note', 'Note')}>
            <Textarea rows={2} maxLength={500} value={form.note} onChange={(event) => set('note', event.target.value)} />
          </SourcingField>
          <SourcingErrorAlert failure={failure} issues={shown} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.costRequests.cancel', 'Cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving} title="Ctrl/Cmd+Enter" data-testid="cpq-answer-submit">
            {saving ? t('cpq.costRequests.saving', 'Saving…') : t('cpq.costRequests.answer.submit', 'Answer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
