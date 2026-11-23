'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  VALUE_FORM_ISSUE_FALLBACKS,
  addValueFormIssues,
  buildAddValueBody,
  classifyIndexError,
  emptyAddValueForm,
  isRealIsoDate,
  sameDateNotice,
  type AddValueForm,
  type CostIndexFailure,
  type CostIndexValueRow,
} from '../../../../../lib/costIndexView'
import { IndexErrorAlert, IndexField, submitOnModEnter } from '../../_components/dialogShared'

type Props = {
  indexId: string
  indexCode: string
  unit: string
  currencyCode: string
  onClose: () => void
  onAdded: (revision: number) => void
}

/**
 * Append a dated value. A date that already has a value creates a correction (revision n+1); the dialog says so before
 * submitting. Ctrl/Cmd+Enter adds, Escape cancels. `409 CONCURRENT_INDEX_WRITE` stays inline so the user can retry.
 */
export function AddValueDialog({ indexId, indexCode, unit, currencyCode, onClose, onAdded }: Props) {
  const t = useT()
  const [form, setForm] = React.useState<AddValueForm>(() => emptyAddValueForm(new Date().toISOString().slice(0, 10)))
  const [showIssues, setShowIssues] = React.useState(false)
  const [failure, setFailure] = React.useState<CostIndexFailure | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [existing, setExisting] = React.useState<Pick<CostIndexValueRow, 'revision' | 'value'> | null>(null)
  const issues = addValueFormIssues(form)
  const set = <K extends keyof AddValueForm>(key: K, value: AddValueForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  // Latest revision already stored for the chosen date (superseded rows are excluded, so the first item is the latest).
  React.useEffect(() => {
    if (!isRealIsoDate(form.effectiveDate)) { setExisting(null); return }
    let cancelled = false
    void (async () => {
      const params = new URLSearchParams({ from: form.effectiveDate, to: form.effectiveDate, pageSize: '1' })
      const call = await apiCall<{ items?: CostIndexValueRow[] }>(`/api/cpq/cost-indices/${indexId}/values?${params}`)
      if (cancelled) return
      setExisting(call.ok && call.result?.items?.[0] ? call.result.items[0] : null)
    })()
    return () => { cancelled = true }
  }, [form.effectiveDate, indexId])

  const submit = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setFailure(null)
    const call = await apiCall<{ value?: { revision: number } }>(`/api/cpq/cost-indices/${indexId}/values`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildAddValueBody(form)),
    })
    setSaving(false)
    if (call.ok) { onAdded(call.result?.value?.revision ?? 1); return }
    setFailure(classifyIndexError(call.status, call.result))
  }

  const notice = sameDateNotice(existing)
  const shown = showIssues ? issues.map((issue) => t(`cpq.costIndices.addValue.issues.${issue}`, VALUE_FORM_ISSUE_FALLBACKS[issue])) : []
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={submitOnModEnter(() => void submit())} data-testid="cpq-add-index-value-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.costIndices.addValue.title', 'Add value')}</DialogTitle>
          <DialogDescription>{indexCode}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <IndexField label={`${t('cpq.costIndices.values.effectiveDate', 'Effective date')} *`}>
              <Input autoFocus type="date" value={form.effectiveDate} onChange={(event) => set('effectiveDate', event.target.value)} />
            </IndexField>
            <IndexField label={`${t('cpq.costIndices.values.value', 'Value')} * (${currencyCode} ${unit})`}>
              <Input inputMode="decimal" value={form.value} onChange={(event) => set('value', event.target.value)} data-testid="cpq-add-index-value-input" />
            </IndexField>
          </div>
          <IndexField label={t('cpq.costIndices.values.note', 'Note')}>
            <Textarea rows={2} maxLength={500} value={form.sourceNote} onChange={(event) => set('sourceNote', event.target.value)} />
          </IndexField>
          {notice && (
            <Alert variant="default" data-testid="cpq-add-index-value-notice">
              <AlertDescription>
                {t('cpq.costIndices.addValue.sameDateNotice',
                  'This creates revision {revision} and replaces {value} for that date on the next save of unlocked quotes.',
                  { revision: notice.nextRevision, value: notice.replaces })}
              </AlertDescription>
            </Alert>
          )}
          <IndexErrorAlert failure={failure} issues={shown} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.costIndices.cancel', 'Cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')} data-testid="cpq-add-index-value-submit">
            {saving ? t('cpq.costIndices.saving', 'Saving…') : t('cpq.costIndices.addValue.submit', 'Add value')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
