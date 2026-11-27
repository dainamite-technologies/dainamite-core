'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  ADJUSTMENT_ERROR_FALLBACKS,
  adjustmentErrorCode,
  allowedAdjustmentTypes,
  buildAdjustmentDraft,
  formatDepth,
  discountDepth,
  isAboveStandard,
  lineTypeTotals,
  overrideSetsChargeTotal,
  requiresChargeType,
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
  lines: Array<{ lineId: string; quantity?: number; mrcTotal: number; nrcTotal: number; charges: Array<WaterfallChargeInput & { chargeCode: string; adjustmentErrors?: Array<{ adjustmentId: string; code: string }> }> }>
}

export type ExistingAdjustment = {
  id: string
  adjustmentType: AdjustmentType
  value: number
  reasonCode: string
  reasonNote?: string | null
  chargeTypeFilter?: 'nrc' | 'mrc' | null
  fromMonth?: number
  toMonth?: number | null
  phaseName?: string | null
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

/** Short type labels shared by line and charge targets (spec F: Set price / % off / Amount off). */
const TYPE_FALLBACKS: Record<AdjustmentType, string> = {
  price_override: 'Set price',
  discount_percent: '% off',
  discount_absolute: 'Amount off',
}

/** "Standard → new price, depth" with an "Above standard" badge for uplifts. */
function PreviewChange({ label, standard, offer, currency, aboveLabel }: { label: string; standard: number; offer: number; currency: string; aboveLabel: string }) {
  const depth = formatDepth(discountDepth(standard, offer))
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span>{label}:</span>
      <span className="font-mono text-muted-foreground">{money(standard, currency)}</span>
      <span aria-hidden>→</span>
      <span className="font-mono font-medium">{money(offer, currency)}</span>
      {depth && <span className="font-mono">({depth})</span>}
      {isAboveStandard(standard, offer) && <Tag variant="warning" className="px-1.5 text-xs" data-testid="cpq-adjustment-above-standard">{aboveLabel}</Tag>}
    </div>
  )
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
    fromMonth: existing?.fromMonth && existing.fromMonth > 1 ? String(existing.fromMonth) : '',
    toMonth: existing?.toMonth != null ? String(existing.toMonth) : '',
    phaseName: existing?.phaseName ?? '',
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

  const needsChargeType = requiresChargeType(target.level, form.adjustmentType)
  // Price phases: month ranges apply to recurring prices only (a line's recurring total or an MRC charge).
  const recurringTarget = target.level === 'line' ? form.chargeTypeFilter === 'mrc' : charge?.chargeType === 'mrc'
  const setType = (adjustmentType: AdjustmentType) => setForm((current) => ({
    ...current, adjustmentType,
    // Set price / Amount off on a line cover one charge type: default to Recurring.
    chargeTypeFilter: requiresChargeType(target.level, adjustmentType) && !current.chargeTypeFilter ? 'mrc' : current.chargeTypeFilter,
  }))
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
  const canSave = !!draft && !!form.reasonCode && !noteRequired && !saving && previewErrors.length === 0 && (!needsChargeType || !!form.chargeTypeFilter)

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
  const setsTotal = overrideSetsChargeTotal(charge)
  const lineScope = form.chargeTypeFilter === 'nrc'
    ? t('cpq.priceAdjustments.dialog.scopeNrc', 'one-time')
    : t('cpq.priceAdjustments.dialog.scopeMrc', 'recurring')
  const valueHint = form.adjustmentType === 'discount_percent'
    ? t('cpq.priceAdjustments.dialog.percentHint', 'Percent off the standard price (0–100)')
    : target.level === 'line'
      ? form.adjustmentType === 'price_override'
        ? t('cpq.priceAdjustments.dialog.lineOverrideHint', 'New {scope} total for this line (all quantities), spread over its charges', { scope: lineScope })
        : t('cpq.priceAdjustments.dialog.lineAbsoluteHint', 'Amount taken off this line’s {scope} total, spread over its charges', { scope: lineScope })
      : form.adjustmentType === 'price_override'
        ? setsTotal
          ? t('cpq.priceAdjustments.dialog.totalOverrideHint', 'New charge total (volume and tiered charges have no single unit price)')
          : t('cpq.priceAdjustments.dialog.overrideHint', 'New unit price')
        : t('cpq.priceAdjustments.dialog.absoluteHint', 'Amount taken off this charge’s total')
  const aboveLabel = t('cpq.priceAdjustments.aboveStandard', 'Above standard')
  const typeLabel = (type: AdjustmentType) => type === 'price_override' && target.level === 'charge' && setsTotal
    ? t('cpq.priceAdjustments.dialog.types.price_override_total', 'Set charge total')
    : t(`cpq.priceAdjustments.dialog.types.${type}`, TYPE_FALLBACKS[type])
  const previewTypes: Array<'mrc' | 'nrc'> = form.chargeTypeFilter ? [form.chargeTypeFilter] : ['mrc', 'nrc']

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-price-adjustment-dialog">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? t('cpq.priceAdjustments.dialog.editTitle', 'Edit price adjustment')
              : target.level === 'line'
                ? t('cpq.priceAdjustments.dialog.lineTitle', 'Adjust line price')
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
            <Select value={form.adjustmentType} onValueChange={(value) => setType(value as AdjustmentType)}>
              <SelectTrigger data-testid="cpq-adjustment-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type} value={type}>{typeLabel(type)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {target.level === 'line' && (
            <label className="block space-y-1">
              <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.appliesTo', 'Applies to')}</span>
              <Select value={form.chargeTypeFilter || 'all'} onValueChange={(value) => setForm({ ...form, chargeTypeFilter: value === 'all' ? '' : value as 'nrc' | 'mrc' })}>
                <SelectTrigger data-testid="cpq-adjustment-applies-to"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* One amount can't span both: Set price / Amount off need Recurring or One-time. */}
                  {!needsChargeType && <SelectItem value="all">{t('cpq.priceAdjustments.dialog.allCharges', 'All one-time and recurring charges')}</SelectItem>}
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

          {recurringTarget && (
            <div className="grid grid-cols-3 gap-2" data-testid="cpq-adjustment-months">
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('cpq.phases.fields.fromMonth', 'From month')}</span>
                <Input inputMode="numeric" placeholder="1" value={form.fromMonth ?? ''} onChange={(event) => setForm({ ...form, fromMonth: event.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('cpq.phases.fields.toMonth', 'To month')}</span>
                <Input inputMode="numeric" placeholder={t('cpq.phases.fields.toEnd', 'to the end')} value={form.toMonth ?? ''} onChange={(event) => setForm({ ...form, toMonth: event.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('cpq.phases.columns.phase', 'Phase')}</span>
                <Input maxLength={100} value={form.phaseName ?? ''} onChange={(event) => setForm({ ...form, phaseName: event.target.value })} />
              </label>
              <span className="col-span-3 text-xs text-muted-foreground">
                {t('cpq.phases.fields.hint', 'Leave empty for every month. A month range makes this a price phase (recurring prices only).')}
              </span>
            </div>
          )}

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
            {draftKey && !previewing && previewCharge && (
              <PreviewChange
                label={setsTotal ? t('cpq.priceAdjustments.dialog.previewChargeTotal', 'Charge total') : t('cpq.priceAdjustments.dialog.previewCharge', 'New offer price')}
                standard={setsTotal ? previewCharge.standardTotalPrice ?? previewCharge.totalPrice ?? 0 : previewCharge.standardUnitPrice ?? standardUnit ?? previewCharge.unitPrice}
                offer={setsTotal ? previewCharge.totalPrice ?? 0 : previewCharge.unitPrice}
                currency={currency} aboveLabel={aboveLabel}
              />
            )}
            {draftKey && !previewing && !previewCharge && previewLine && (
              <div className="space-y-0.5">
                <div className="text-muted-foreground">{t('cpq.priceAdjustments.dialog.previewLine', 'Line totals')}</div>
                {previewTypes.map((type) => {
                  const totals = lineTypeTotals(previewLine, type)
                  return (
                    <PreviewChange key={type} label={type === 'mrc' ? t('cpq.lines.mrc', 'MRC') : t('cpq.lines.nrc', 'NRC')}
                      standard={totals.standard} offer={totals.offer} currency={currency} aboveLabel={aboveLabel} />
                  )
                })}
              </div>
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
          <Button onClick={() => void save()} disabled={!canSave} title={t('cpq.priceAdjustments.dialog.saveShortcut', 'Ctrl/Cmd+Enter')}>
            {saving ? t('cpq.priceAdjustments.dialog.saving', 'Saving…') : t('cpq.priceAdjustments.dialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
