'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  ADJUSTMENT_ERROR_FALLBACKS,
  adjustmentErrorCode,
  allowedAdjustmentTypes,
  buildAdjustmentDraft,
  formatDepth,
  discountDepth,
  toAdjustmentPatch,
  type AdjustmentForm,
  type AdjustmentTarget,
  type AdjustmentType,
  type WaterfallChargeInput,
} from '../../../../../lib/priceAdjustmentView'

export type AdjustmentReason = { value: string; label: string }

/** Minimal view of the quote the dialog needs, kept local so the page owns the full type. */
type PreviewQuote = {
  pricingRevision?: number
  lines: Array<{ lineId: string; mrcTotal: number; nrcTotal: number; charges: Array<Omit<WaterfallChargeInput, 'unitPrice'> & { unitPrice: number | null; chargeCode: string; adjustmentErrors?: Array<{ adjustmentId: string; code: string }> }> }>
}

export type ExistingAdjustment = {
  id: string
  adjustmentType: AdjustmentType
  value: number
  reasonCode: string
  reasonNote?: string | null
  chargeTypeFilter?: 'nrc' | 'mrc' | null
}

export type PriceAdjustmentDialogProps<Q extends PreviewQuote> = {
  open: boolean
  quoteId: string
  currency: string
  pricingRevision: number
  target: AdjustmentTarget
  /** Display name of the line / charge being adjusted. */
  targetLabel: string
  /** The charge for charge-level targets (drives type options and the current price). */
  charge?: WaterfallChargeInput & { chargeCode: string; chargeName: string }
  existing?: ExistingAdjustment | null
  /** Ids of adjustments already stored on the quote; their errors don't block this draft. */
  storedAdjustmentIds: string[]
  reasons: AdjustmentReason[]
  onClose: () => void
  onSaved: (quote: Q) => void
  /** Called when the server reports a stale revision; the page reloads the quote. */
  onStale: () => void
}

const TYPE_FALLBACKS: Record<AdjustmentType, string> = {
  price_override: 'Set a new unit price',
  discount_percent: 'Percentage discount',
  discount_absolute: 'Amount off the charge total',
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export function PriceAdjustmentDialog<Q extends PreviewQuote>(props: PriceAdjustmentDialogProps<Q>) {
  const { open, quoteId, currency, pricingRevision, target, targetLabel, charge, existing, storedAdjustmentIds, reasons, onClose, onSaved, onStale } = props
  const t = useT()
  const types = allowedAdjustmentTypes(target.level, charge)
  const initialForm = React.useCallback((): AdjustmentForm => ({
    adjustmentType: existing?.adjustmentType ?? types[0] ?? 'discount_percent',
    value: existing ? String(existing.value) : '',
    reasonCode: existing?.reasonCode ?? '',
    reasonNote: existing?.reasonNote ?? '',
    chargeTypeFilter: existing?.chargeTypeFilter ?? '',
  }), [existing, types])
  const [form, setForm] = React.useState<AdjustmentForm>(initialForm)
  const [preview, setPreview] = React.useState<{ quote: Q; errors: Array<{ adjustmentId: string; code: string }> } | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) { setForm(initialForm()); setPreview(null); setErrorCode(null) }
    // Reset only when the dialog (re)opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const draft = buildAdjustmentDraft(form, target, currency, pricingRevision)
  const draftKey = draft && form.reasonCode ? JSON.stringify(draft) : null
  const message = (code: string) => t(`cpq.priceAdjustments.errors.${code}`, ADJUSTMENT_ERROR_FALLBACKS[code] ?? code)

  // Debounced, side-effect-free preview of the draft.
  React.useEffect(() => {
    if (!open || !draftKey) { setPreview(null); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setPreviewing(true)
      const call = await apiCall<{ quote: Q; errors: Array<{ adjustmentId: string; code: string }> }>(
        `/api/cpq/quotes/${quoteId}/price-adjustments/preview`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: JSON.parse(draftKey), ...(existing ? { replaceAdjustmentId: existing.id } : {}) }) },
      )
      if (cancelled) return
      setPreviewing(false)
      if (call.ok && call.result) { setPreview(call.result); setErrorCode(null) }
      else { setPreview(null); setErrorCode(adjustmentErrorCode(call.status, call.result)) }
    }, 400)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, draftKey, quoteId, existing])

  const previewLine = preview?.quote.lines.find((line) => line.lineId === target.quoteLineId)
  const previewCharge = target.level === 'charge' ? previewLine?.charges.find((entry) => entry.chargeCode === target.chargeCode) : undefined
  // The draft's id is server-generated on create, so "not stored" identifies it; on edit it keeps its id.
  const previewErrors = preview?.errors.filter((error) => existing ? error.adjustmentId === existing.id : !storedAdjustmentIds.includes(error.adjustmentId)) ?? []
  const noteRequired = form.reasonCode === 'other' && !form.reasonNote.trim()
  const canSave = !!draft && !!form.reasonCode && !noteRequired && !saving && previewErrors.length === 0

  const save = async () => {
    if (!draft || !canSave) return
    setSaving(true); setErrorCode(null)
    const call = existing
      ? await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments/${existing.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toAdjustmentPatch(draft)),
      })
      : await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
      })
    setSaving(false)
    if (call.ok && call.result?.quote) { onSaved(call.result.quote); onClose(); return }
    setErrorCode(adjustmentErrorCode(call.status, call.result))
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }

  const standardUnit = charge?.standardUnitPrice ?? charge?.unitPrice
  const valueHint = form.adjustmentType === 'discount_percent'
    ? t('cpq.priceAdjustments.dialog.percentHint', 'Percent off the standard price (0–100)')
    : form.adjustmentType === 'price_override'
      ? t('cpq.priceAdjustments.dialog.overrideHint', 'New unit price, at most the standard price')
      : t('cpq.priceAdjustments.dialog.absoluteHint', 'Amount taken off this charge’s total')

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-price-adjustment-dialog">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? t('cpq.priceAdjustments.dialog.editTitle', 'Edit price adjustment')
              : target.level === 'line'
                ? t('cpq.priceAdjustments.dialog.lineTitle', 'Discount line')
                : t('cpq.priceAdjustments.dialog.chargeTitle', 'Adjust price')}
          </DialogTitle>
          <DialogDescription>
            {targetLabel}
            {charge && standardUnit !== undefined && (
              <> · {t('cpq.priceAdjustments.dialog.standard', 'Standard')} {money(standardUnit, currency)}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.type', 'Adjustment')}</span>
            <Select value={form.adjustmentType} onValueChange={(value) => setForm({ ...form, adjustmentType: value as AdjustmentType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type} value={type}>{t(`cpq.priceAdjustments.dialog.types.${type}`, TYPE_FALLBACKS[type])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {target.level === 'line' && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.appliesTo', 'Applies to')}</span>
              <Select value={form.chargeTypeFilter || 'all'} onValueChange={(value) => setForm({ ...form, chargeTypeFilter: value === 'all' ? '' : value as 'nrc' | 'mrc' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('cpq.priceAdjustments.dialog.allCharges', 'All one-time and recurring charges')}</SelectItem>
                  <SelectItem value="mrc">{t('cpq.priceAdjustments.dialog.mrcOnly', 'Recurring charges only')}</SelectItem>
                  <SelectItem value="nrc">{t('cpq.priceAdjustments.dialog.nrcOnly', 'One-time charges only')}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.value', 'Value')}</span>
            <Input inputMode="decimal" autoFocus value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} aria-describedby="cpq-adjustment-value-hint" />
            <span id="cpq-adjustment-value-hint" className="block text-xs text-muted-foreground">{valueHint}</span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.reason', 'Reason')}</span>
            <Select value={form.reasonCode} onValueChange={(value) => setForm({ ...form, reasonCode: value })}>
              <SelectTrigger><SelectValue placeholder={t('cpq.priceAdjustments.dialog.reasonPlaceholder', 'Pick a reason')} /></SelectTrigger>
              <SelectContent>
                {reasons.map((reason) => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">
              {t('cpq.priceAdjustments.dialog.note', 'Note')}{form.reasonCode === 'other' ? ' *' : ''}
            </span>
            <Textarea rows={2} maxLength={500} value={form.reasonNote} onChange={(event) => setForm({ ...form, reasonNote: event.target.value })} />
          </label>

          <div className="rounded border bg-muted/20 p-2 text-xs" aria-live="polite" data-testid="cpq-adjustment-preview">
            {!draftKey && <span className="text-muted-foreground">{t('cpq.priceAdjustments.dialog.previewEmpty', 'Enter a value and reason to preview the new price.')}</span>}
            {draftKey && previewing && <span className="text-muted-foreground">{t('cpq.priceAdjustments.dialog.previewing', 'Calculating…')}</span>}
            {draftKey && !previewing && previewCharge && previewCharge.unitPrice !== null && (
              <span>
                {t('cpq.priceAdjustments.dialog.previewCharge', 'New offer price')}: <span className="font-mono font-medium">{money(previewCharge.unitPrice, currency)}</span>
                {' '}{formatDepth(discountDepth(previewCharge.standardUnitPrice ?? standardUnit, previewCharge.unitPrice)) ?? ''}
              </span>
            )}
            {draftKey && !previewing && (!previewCharge || previewCharge.unitPrice === null) && previewLine && (
              <span>
                {t('cpq.priceAdjustments.dialog.previewLine', 'Line totals')}: MRC <span className="font-mono font-medium">{money(previewLine.mrcTotal, currency)}</span>
                {' · '}NRC <span className="font-mono font-medium">{money(previewLine.nrcTotal, currency)}</span>
              </span>
            )}
          </div>

          {(errorCode || previewErrors.length > 0 || noteRequired) && (
            <Alert variant="warning">
              <AlertDescription>
                {errorCode ? message(errorCode) : previewErrors.length > 0 ? message(previewErrors[0].code) : message('REASON_NOTE_REQUIRED')}
                {errorCode === 'STALE_REVISION' && (
                  <Button variant="outline" size="sm" className="ml-2" onClick={() => { onStale(); onClose() }}>
                    {t('cpq.priceAdjustments.dialog.reload', 'Reload')}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.priceAdjustments.dialog.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={!canSave} title="Ctrl/Cmd+Enter">
            {saving ? t('cpq.priceAdjustments.dialog.saving', 'Saving…') : t('cpq.priceAdjustments.dialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
