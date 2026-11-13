'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  MARKUP_ISSUE_FALLBACKS,
  MARKUP_RULES,
  MARKUP_RULE_FALLBACKS,
  buildMarkupBody,
  costErrorFallback,
  markupFormIssues,
  type MarkupForm,
  type MarkupFormIssue,
  type MarkupRule,
  type QuoteMarkupOverride,
} from '../../../../../lib/quoteCostView'
import type { ChargeOption } from './CostFormBody'

export function MarkupFormBody({ form, onChange, charges, overrides, issues, errorCode, onClear, onReload }: {
  form: MarkupForm
  onChange: (next: MarkupForm) => void
  /** Cost-plus charges of the line. */
  charges: ChargeOption[]
  /** Existing overrides of the line, so the current one can be cleared. */
  overrides: QuoteMarkupOverride[]
  issues: MarkupFormIssue[]
  errorCode: string | null
  onClear: (chargeCode: string) => void
  onReload: () => void
}) {
  const t = useT()
  const current = overrides.find((override) => override.chargeCode === form.chargeCode)
  const errorText = errorCode ? t(`cpq.quoteCosts.errors.${errorCode}`, costErrorFallback(errorCode)) : null
  return (
    <div className="space-y-3 text-sm" data-testid="cpq-markup-form">
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('cpq.quoteCosts.dialog.charge', 'Charge')}</span>
        <Select value={form.chargeCode} onValueChange={(chargeCode) => onChange({ ...form, chargeCode })}>
          <SelectTrigger><SelectValue placeholder={t('cpq.quoteCosts.markup.pickCharge', 'Pick a cost-plus charge')} /></SelectTrigger>
          <SelectContent>{charges.map((charge) => <SelectItem key={charge.chargeCode} value={charge.chargeCode}>{charge.chargeName}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      {current && (
        <div className="flex items-center justify-between rounded border bg-muted/20 p-2 text-xs" data-testid="cpq-markup-current">
          <span>
            {t('cpq.quoteCosts.markup.current', 'Current override')}: {t(`cpq.quoteCosts.markup.rules.${current.markupRule}`, MARKUP_RULE_FALLBACKS[current.markupRule as MarkupRule] ?? current.markupRule)} {current.markupValue}
            {current.note ? ` — ${current.note}` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={() => onClear(current.chargeCode)}>{t('cpq.quoteCosts.markup.clear', 'Clear override')}</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t('cpq.quoteCosts.markup.rule', 'Rule')}</span>
          <Select value={form.markupRule} onValueChange={(markupRule) => onChange({ ...form, markupRule: markupRule as MarkupRule })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MARKUP_RULES.map((rule) => <SelectItem key={rule} value={rule}>{t(`cpq.quoteCosts.markup.rules.${rule}`, MARKUP_RULE_FALLBACKS[rule])}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t('cpq.quoteCosts.value', 'Value')}</span>
          <Input inputMode="decimal" value={form.markupValue} onChange={(event) => onChange({ ...form, markupValue: event.target.value })} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('cpq.quoteCosts.dialog.note', 'Note')} *</span>
        <Textarea rows={2} maxLength={500} value={form.note} onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </label>
      {(issues.length > 0 || errorText) && (
        <Alert variant="warning" data-testid="cpq-markup-form-errors">
          <AlertDescription>
            {issues.length > 0 && <span className="block">{issues.map((issue) => t(`cpq.quoteCosts.markup.issues.${issue}`, MARKUP_ISSUE_FALLBACKS[issue])).join(' · ')}</span>}
            {errorText && <span className="block">{errorText}</span>}
            {errorCode === 'STALE_REVISION' && (
              <Button variant="outline" size="sm" className="mt-1" onClick={onReload}>{t('cpq.quoteCosts.dialog.reload', 'Reload')}</Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export type MarkupOverrideDialogProps = {
  quoteLineId: string
  lineName: string
  revision: number
  charges: ChargeOption[]
  overrides: QuoteMarkupOverride[]
  /** Resolve to an error code, or null on success. */
  onSubmit: (body: Record<string, unknown>) => Promise<string | null>
  onClear: (chargeCode: string) => Promise<string | null>
  onClose: () => void
  onReload: () => void
}

/** Override the markup of one cost-plus charge on this line. Ctrl/Cmd+Enter saves; Escape cancels. */
export function MarkupOverrideDialog({ quoteLineId, lineName, revision, charges, overrides, onSubmit, onClear, onClose, onReload }: MarkupOverrideDialogProps) {
  const t = useT()
  const [form, setForm] = React.useState<MarkupForm>({ chargeCode: charges[0]?.chargeCode ?? '', markupRule: 'markup_percent', markupValue: '', note: '' })
  const [showIssues, setShowIssues] = React.useState(false)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const issues = markupFormIssues(form)

  const save = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setErrorCode(null)
    const code = await onSubmit(buildMarkupBody(form, quoteLineId, revision))
    setSaving(false)
    if (code) setErrorCode(code)
  }
  const clear = async (chargeCode: string) => {
    setSaving(true); setErrorCode(null)
    const code = await onClear(chargeCode)
    setSaving(false)
    if (code) setErrorCode(code)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-markup-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.quoteCosts.markup.title', 'Override markup')}</DialogTitle>
          <DialogDescription>{lineName}</DialogDescription>
        </DialogHeader>
        <MarkupFormBody form={form} onChange={setForm} charges={charges} overrides={overrides} issues={showIssues ? issues : []}
          errorCode={errorCode} onClear={(chargeCode) => void clear(chargeCode)} onReload={onReload} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.quoteCosts.dialog.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving} title="Ctrl/Cmd+Enter">
            {saving ? t('cpq.quoteCosts.dialog.saving', 'Saving…') : t('cpq.quoteCosts.dialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
