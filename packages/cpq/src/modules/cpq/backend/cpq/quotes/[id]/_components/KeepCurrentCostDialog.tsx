'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  KEEP_CURRENT_ISSUE_FALLBACKS,
  buildKeepCurrentBody,
  keepCurrentFormFromCost,
  keepCurrentIssues,
  keepCurrentShortDates,
  type KeepCurrentForm,
} from '../../../../../lib/arcCostView'
import { costErrorFallback, type FullQuoteCost } from '../../../../../lib/quoteCostView'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/**
 * Keep current cost (ARC costs spec, R13): confirms a renegotiation-due carried cost unchanged. Asks for the valid-until date, the
 * supplier term end or "rolling", and the evidence (a new supplier quote reference or a note). Warns when a date is before the new term end.
 * Ctrl/Cmd+Enter saves, Escape cancels (Radix dialog).
 */
export function KeepCurrentCostDialog({ cost, lineName, newTermEnd, revision, onSubmit, onClose, onReload }: {
  cost: FullQuoteCost
  lineName: string
  /** The renewal's new term end (target subscription), when known: dates before it raise the warning. */
  newTermEnd: string | null
  /** The `pricingRevision` of the costs read; sent as `expectedRevision`. */
  revision: number
  /** Sends the body; resolves to an error code, or null on success. */
  onSubmit: (body: Record<string, unknown>) => Promise<string | null>
  onClose: () => void
  onReload: () => void
}) {
  const t = useT()
  const [form, setForm] = React.useState<KeepCurrentForm>(() => keepCurrentFormFromCost(cost))
  const [showIssues, setShowIssues] = React.useState(false)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const issues = keepCurrentIssues(form, cost)
  const short = keepCurrentShortDates(form, newTermEnd)
  const set = <K extends keyof KeepCurrentForm>(key: K, value: KeepCurrentForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setErrorCode(null)
    const code = await onSubmit(buildKeepCurrentBody(form, revision))
    setSaving(false)
    if (code) setErrorCode(code)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }
  const shown = showIssues ? issues.map((issue) => t(`cpq.arc.keepCurrent.issues.${issue}`, KEEP_CURRENT_ISSUE_FALLBACKS[issue])) : []
  const errorText = errorCode === 'STALE_REVISION'
    ? t('cpq.arc.staleRevision', 'Quote changed, reload')
    : errorCode ? t(`cpq.quoteCosts.errors.${errorCode}`, costErrorFallback(errorCode)) : null

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-keep-current-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.arc.keepCurrent.title', 'Keep current cost')}</DialogTitle>
          <DialogDescription>{[cost.name, lineName].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('cpq.arc.keepCurrent.hint', 'The value stays as it is. Confirm it for the renewal term and say what supports it.')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('cpq.quoteCosts.validUntil', 'Valid until')}>
              <Input autoFocus type="date" value={form.validUntil} onChange={(event) => set('validUntil', event.target.value)} />
            </Field>
            <Field label={t('cpq.quoteCosts.dialog.supplierTermEnd', 'Supplier term end')}>
              <Input type="date" value={form.rolling ? '' : form.supplierTermEnd} disabled={form.rolling} onChange={(event) => set('supplierTermEnd', event.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={form.rolling} onCheckedChange={(checked) => set('rolling', checked === true)} data-testid="cpq-keep-current-rolling" />
            {t('cpq.arc.keepCurrent.rolling', 'Rolling — the supplier term has no fixed end')}
          </label>
          <Field label={t('cpq.quoteCosts.dialog.supplierQuoteRef', 'Supplier quote ref')}>
            <Input value={form.supplierQuoteRef} maxLength={255} onChange={(event) => set('supplierQuoteRef', event.target.value)} />
          </Field>
          <Field label={`${t('cpq.quoteCosts.dialog.note', 'Note')}${showIssues && issues.includes('VALIDITY_EVIDENCE_REQUIRED') ? ' *' : ''}`}>
            <Textarea rows={2} maxLength={500} value={form.note} onChange={(event) => set('note', event.target.value)} />
          </Field>
          {short.length > 0 && (
            <Alert variant="warning" data-testid="cpq-keep-current-short">
              <AlertDescription>
                {t('cpq.arc.keepCurrent.short', 'A date is before the new term end ({date}) — extend it or the cost cannot be kept.', { date: (newTermEnd ?? '').slice(0, 10) })}
              </AlertDescription>
            </Alert>
          )}
          {(shown.length > 0 || errorText) && (
            <Alert variant="warning" data-testid="cpq-keep-current-errors">
              <AlertDescription>
                {shown.length > 0 && <span className="block">{shown.join(' · ')}</span>}
                {errorText && <span className="block">{errorText}</span>}
                {errorCode === 'STALE_REVISION' && (
                  <Button variant="outline" size="sm" className="mt-1" onClick={onReload}>{t('cpq.quoteCosts.dialog.reload', 'Reload')}</Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.quoteCosts.dialog.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')}>
            {saving ? t('cpq.quoteCosts.dialog.saving', 'Saving…') : t('cpq.arc.keepCurrent.confirm', 'Keep current cost')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
