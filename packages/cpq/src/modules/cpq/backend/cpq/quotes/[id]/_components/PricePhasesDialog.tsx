'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  ADJUSTMENT_ERROR_FALLBACKS,
  MAX_PHASE_STEPS,
  adjustmentErrorCode,
  buildPhaseDrafts,
  emptyPhaseStep,
  phaseStepRanges,
  type AdjustmentTarget,
  type PhaseStepForm,
} from '../../../../../lib/priceAdjustmentView'
import { useMonthRangeLabel } from '../../../../../components/PriceScheduleTable'
import type { AdjustmentReason } from './PriceAdjustmentDialog'

const KIND_FALLBACKS: Record<PhaseStepForm['kind'], string> = {
  free: 'Free',
  price_override: 'Set price',
  discount_percent: '% off',
  discount_absolute: 'Amount off',
}

const PHASE_ERROR_FALLBACKS: Record<string, string> = {
  PHASE_LENGTH_INVALID: 'Enter a whole number of months or years (1 or more)',
  PHASE_VALUE_INVALID: 'Enter a valid price, percentage (above 0, up to 100) or amount',
  PHASE_PAST_TERM: 'The phases run past the line’s term',
  PHASE_TOO_MANY: 'At most 12 phases',
  PHASE_NONE: 'Add at least one phase',
}

/**
 * Phases editor (spec P §4.3): trial, promotion or ramp steps on a line's
 * recurring total or on one recurring charge. Steps run back to back from
 * month 1 (years = 12 months); after the last one the regular price applies.
 * Each step is saved as a manual price adjustment with a month range, one
 * write at a time (each one an undoable command).
 */
export function PricePhasesDialog<Q extends { pricingRevision?: number }>({
  open, quoteId, currency, pricingRevision, target, targetLabel, termMonths, reasons, onClose, onSaved, onStale,
}: {
  open: boolean
  quoteId: string
  currency: string
  pricingRevision: number
  target: AdjustmentTarget
  targetLabel: string
  termMonths?: number | null
  reasons: AdjustmentReason[]
  onClose: () => void
  onSaved: (quote: Q) => void
  onStale: () => void
}) {
  const t = useT()
  const rangeLabel = useMonthRangeLabel()
  const [steps, setSteps] = React.useState<PhaseStepForm[]>([emptyPhaseStep()])
  const [reasonCode, setReasonCode] = React.useState('')
  const [reasonNote, setReasonNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) { setSteps([emptyPhaseStep()]); setReasonCode('promotion'); setReasonNote(''); setErrorCode(null) }
  }, [open])

  const ranges = phaseStepRanges(steps)
  const built = buildPhaseDrafts({ steps, target, reasonCode, reasonNote, currencyCode: currency, termMonths })
  const lastRange = ranges.at(-1)
  const regularFrom = lastRange ? lastRange.toMonth + 1 : null
  const noteRequired = reasonCode === 'other' && !reasonNote.trim()
  const reasonKnown = reasons.some((reason) => reason.value === reasonCode)
  const canSave = !saving && !built.error && reasonKnown && !noteRequired
  const message = (code: string) => t(`cpq.priceAdjustments.errors.${code}`, PHASE_ERROR_FALLBACKS[code] ?? ADJUSTMENT_ERROR_FALLBACKS[code] ?? code)

  const update = (index: number, patch: Partial<PhaseStepForm>) =>
    setSteps((current) => current.map((step, at) => (at === index ? { ...step, ...patch } : step)))

  const save = async () => {
    if (!canSave) return
    setSaving(true); setErrorCode(null)
    let revision = pricingRevision
    let latest: Q | null = null
    for (const draft of built.drafts) {
      const call = await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, expectedRevision: revision }),
      })
      if (!call.ok || !call.result?.quote) {
        setSaving(false)
        if (latest) onSaved(latest)
        setErrorCode(adjustmentErrorCode(call.status, call.result))
        return
      }
      latest = call.result.quote
      revision = latest.pricingRevision ?? revision + 1
    }
    setSaving(false)
    if (latest) onSaved(latest)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} className="max-w-2xl" data-testid="cpq-price-phases-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.phases.dialog.title', 'Price phases')}</DialogTitle>
          <DialogDescription>
            {targetLabel}
            {target.level === 'line' && <> · {t('cpq.phases.dialog.lineScope', 'recurring total of the line')}</>}
            {termMonths ? <> · {t('cpq.phases.dialog.term', 'term {months} months', { months: termMonths })}</> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('cpq.phases.dialog.hint', 'Trial, promotion or ramp steps, back to back from the start of the subscription. After the last step the regular price applies.')}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">{t('cpq.phases.columns.months', 'Months')}</th>
                <th className="py-1 text-left font-medium">{t('cpq.phases.dialog.length', 'Length')}</th>
                <th className="py-1 text-left font-medium">{t('cpq.phases.dialog.price', 'Price')}</th>
                <th className="py-1 text-left font-medium">{t('cpq.phases.dialog.value', 'Value')}</th>
                <th className="py-1 text-left font-medium">{t('cpq.phases.columns.phase', 'Phase')}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => {
                const range = ranges[index]
                return (
                  <tr key={index} className="border-t align-top" data-testid="cpq-price-phase-step">
                    <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">{range ? rangeLabel(range.fromMonth, range.toMonth) : '—'}</td>
                    <td className="py-1 pr-2">
                      <div className="flex gap-1">
                        <Input className="w-16" inputMode="numeric" value={step.length} onChange={(event) => update(index, { length: event.target.value })}
                          aria-label={t('cpq.phases.dialog.length', 'Length')} />
                        <Select value={step.unit} onValueChange={(value) => update(index, { unit: value as PhaseStepForm['unit'] })}>
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="month">{t('cpq.phases.dialog.units.month', 'months')}</SelectItem>
                            <SelectItem value="year">{t('cpq.phases.dialog.units.year', 'years')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={step.kind} onValueChange={(value) => update(index, { kind: value as PhaseStepForm['kind'] })}>
                        <SelectTrigger className="w-32" data-testid="cpq-price-phase-kind"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(KIND_FALLBACKS) as Array<PhaseStepForm['kind']>).map((kind) => (
                            <SelectItem key={kind} value={kind}>{t(`cpq.phases.kinds.${kind}`, KIND_FALLBACKS[kind])}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      {step.kind === 'free' ? <span className="text-muted-foreground">0</span> : (
                        <Input className="w-24" inputMode="decimal" value={step.value} onChange={(event) => update(index, { value: event.target.value })}
                          placeholder={step.kind === 'discount_percent' ? '%' : currency} aria-label={t('cpq.phases.dialog.value', 'Value')} />
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <Input maxLength={100} value={step.name} onChange={(event) => update(index, { name: event.target.value })}
                        placeholder={t('cpq.phases.dialog.namePlaceholder', 'e.g. Free trial')} aria-label={t('cpq.phases.columns.phase', 'Phase')} />
                    </td>
                    <td className="py-1">
                      <IconButton type="button" variant="ghost" size="xs" aria-label={t('cpq.phases.dialog.removeStep', 'Remove phase')}
                        disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                )
              })}
              {regularFrom !== null && (
                <tr className="border-t text-muted-foreground">
                  <td className="py-1 pr-2 whitespace-nowrap">{rangeLabel(regularFrom, null)}</td>
                  <td colSpan={5} className="py-1">{t('cpq.phases.regularPrice', 'Regular price')}</td>
                </tr>
              )}
            </tbody>
          </table>
          <Button type="button" variant="outline" size="sm" disabled={steps.length >= MAX_PHASE_STEPS}
            onClick={() => setSteps((current) => [...current, { ...emptyPhaseStep(), kind: 'discount_percent' }])}>
            <Plus className="h-4 w-4" />
            {t('cpq.phases.dialog.addStep', 'Add phase')}
          </Button>

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.reason', 'Reason')}</span>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger><SelectValue placeholder={t('cpq.priceAdjustments.dialog.reasonPlaceholder', 'Pick a reason')} /></SelectTrigger>
              <SelectContent>
                {reasons.map((reason) => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.note', 'Note')}{reasonCode === 'other' ? ' *' : ''}</span>
            <Textarea rows={2} maxLength={500} value={reasonNote} onChange={(event) => setReasonNote(event.target.value)} />
          </label>

          {(errorCode || built.error || noteRequired) && (
            <Alert variant="warning">
              <AlertDescription>
                {errorCode ? message(errorCode) : built.error ? message(built.error) : message('REASON_NOTE_REQUIRED')}
                {errorCode === 'STALE_REVISION' && (
                  <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => { onStale(); onClose() }}>
                    {t('cpq.priceAdjustments.dialog.reload', 'Reload')}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('cpq.priceAdjustments.dialog.cancel', 'Cancel')}</Button>
          <Button type="button" onClick={() => void save()} disabled={!canSave} title={t('cpq.priceAdjustments.dialog.saveShortcut', 'Ctrl/Cmd+Enter')}
            data-testid="cpq-price-phases-save">
            {saving ? t('cpq.priceAdjustments.dialog.saving', 'Saving…') : t('cpq.phases.dialog.save', 'Save phases')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
