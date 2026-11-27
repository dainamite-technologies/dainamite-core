'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ADJUSTMENT_ERROR_FALLBACKS } from '../../../../../lib/priceAdjustmentView'
import {
  bodyFromEditor, bundleLines, canSaveTarget, defaultTargetKey, editorFromRows, serverEditorError, targetOptions,
  type DialogLine, type EditorState, type StoredRow, type TargetOption,
} from '../../../../../lib/priceDialogView'
import { CurrentPricesTable } from './CurrentPricesTable'
import { TargetPicker } from './TargetPicker'
import { OnePriceEditor } from './OnePriceEditor'
import { PhaseScheduleEditor } from './PhaseScheduleEditor'
import { PricePreview, type PreviewError } from './PricePreview'

export type AdjustmentReason = { value: string; label: string }
type PreviewQuote = { pricingRevision?: number; lines: DialogLine[] }

/** English fallbacks of the editor's own codes (server codes use `ADJUSTMENT_ERROR_FALLBACKS`). */
const EDITOR_ERROR_FALLBACKS: Record<string, string> = {
  PHASE_LENGTH_INVALID: 'Enter a whole number of months or years (1 or more)',
  PHASE_VALUE_INVALID: 'Enter a valid price, percentage (above 0, up to 100) or amount',
  PHASE_TOO_MANY: 'At most 12 phases',
  PHASE_NONE: 'Add a phase that is not the regular price, or use One price',
  THEN_PAST_TERM: 'The phases fill the term, so a Then price would never apply: shorten a phase or set Then to Regular price',
  VALUE_REQUIRED: 'Enter a value to preview the new price',
  REASON_REQUIRED: 'Pick a reason',
}

/**
 * The quote line's Price dialog (UX feedback spec §3): current prices, *Applies
 * to* (one adjustment set per target), One price / Price phases, a live
 * preview and one atomic, undoable save (`PUT …/price-adjustments/target`).
 */
export function PriceDialog<Q extends PreviewQuote>(props: {
  open: boolean
  quoteId: string
  currency: string
  pricingRevision: number
  line: DialogLine
  lines: DialogLine[]
  rows: StoredRow[]
  /** A charge's % opens that charge; the panel's Edit opens a target. */
  chargeCode?: string | null
  targetKey?: string | null
  reasons: AdjustmentReason[]
  onClose: () => void
  onSaved: (quote: Q) => void
  onStale: () => void
  /** Confirms and removes everything on the target; resolves true when done. */
  onRemove: (option: TargetOption) => Promise<boolean>
}) {
  const { open, quoteId, currency, pricingRevision, line, lines, rows, chargeCode, reasons, onClose, onSaved, onStale, onRemove } = props
  const t = useT()
  const bundle = React.useMemo(() => bundleLines(line, lines), [line, lines])
  const options = React.useMemo(() => targetOptions(line, bundle, rows), [line, bundle, rows])
  const defaultReason = reasons.some((reason) => reason.value === 'promotion') ? 'promotion' : ''
  const [key, setKey] = React.useState<string>(() => props.targetKey ?? defaultTargetKey(options, chargeCode) ?? '')
  const option = options.find((entry) => entry.key === key) ?? options[0]
  const [editor, setEditor] = React.useState<EditorState>(() => editorFromRows(t, option ?? { rows: [], types: [], takesPhases: false }, defaultReason))
  // `key` is the body the preview priced: Save needs the preview of the current body.
  const [preview, setPreview] = React.useState<{ key: string; quote: Q; errors: PreviewError[] } | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [serverError, setServerError] = React.useState<{ code: string; stepIndex?: number } | null>(null)
  const [saving, setSaving] = React.useState(false)

  const selectTarget = (next: string) => {
    const picked = options.find((entry) => entry.key === next)
    setKey(next)
    if (picked) setEditor(editorFromRows(t, picked, defaultReason))
    setPreview(null); setServerError(null)
  }

  const built = option ? bodyFromEditor(t, editor, option, currency, line.termMonths) : { body: null, error: null }
  const previewKey = built.body ? JSON.stringify({ ...built.body, expectedRevision: pricingRevision }) : null
  const stepCount = editor.mode === 'phases' && option?.takesPhases ? editor.steps.length : 0
  const message = (code: string) => t(`cpq.priceAdjustments.errors.${code}`, EDITOR_ERROR_FALLBACKS[code] ?? ADJUSTMENT_ERROR_FALLBACKS[code] ?? code)

  // Debounced, side-effect-free preview of the draft (400 ms, §3.4).
  React.useEffect(() => {
    // A changed body drops the old preview at once, so Save waits for the fresh one.
    setPreview(null)
    if (!open || !previewKey) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setPreviewing(true)
      const call = await apiCall<{ quote: Q; errors: PreviewError[] }>(`/api/cpq/quotes/${quoteId}/price-adjustments/target/preview`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: previewKey })
      if (cancelled) return
      setPreviewing(false)
      if (call.ok && call.result) { setPreview({ ...call.result, key: previewKey }); setServerError(null) }
      else { setPreview(null); setServerError(serverEditorError(call.status, call.result, stepCount)) }
    }, 400)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, previewKey, quoteId, stepCount])

  const errors = preview?.errors ?? []
  const canSave = canSaveTarget({ previewKey, preview, saving, previewing, serverError: serverError?.code ?? null })

  const save = async () => {
    if (!canSave || !previewKey) return
    setSaving(true); setServerError(null)
    const call = await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments/target`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: previewKey })
    setSaving(false)
    if (call.ok && call.result?.quote) { onSaved(call.result.quote); onClose(); return }
    setServerError(serverEditorError(call.status, call.result, stepCount))
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }

  if (!option) return null
  const previewBundle = preview ? bundle.map((entry) => preview.quote.lines.find((candidate) => candidate.lineId === entry.lineId) ?? entry) : null
  const charge = option.target.level === 'charge' ? line.charges.find((entry) => option.target.level === 'charge' && entry.chargeCode === option.target.chargeCode) : undefined
  const phases = option.takesPhases && editor.mode === 'phases'
  const invalidText = built.error ? message(built.error) : null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} className="max-h-[85vh] max-w-5xl overflow-y-auto" data-testid="cpq-price-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.priceDialog.title', 'Adjust price — {line}', { line: line.offeringName })}</DialogTitle>
          <DialogDescription>
            {line.termMonths ? <>{t('cpq.phases.dialog.term', 'term {months} months', { months: line.termMonths })} · </> : null}{currency}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <CurrentPricesTable rootLineId={line.lineId} bundle={bundle} rows={rows} currency={currency} />
          <div className="space-y-3 border-t pt-3">
            <TargetPicker options={options} value={option.key} onChange={selectTarget} mode={phases ? 'phases' : 'one_price'}
              onModeChange={(mode) => setEditor((current) => ({ ...current, mode }))} />
            {phases ? (
              <PhaseScheduleEditor steps={editor.steps} then={editor.then} types={option.types} currency={currency}
                errorStep={built.error ? built.stepIndex : serverError?.stepIndex} onChange={(steps, then) => setEditor((current) => ({ ...current, steps, then }))} />
            ) : (
              <OnePriceEditor option={option} charge={charge} value={editor.one} onChange={(one) => setEditor((current) => ({ ...current, one }))} />
            )}
            <div className="grid grid-cols-[16rem_1fr] gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.reason', 'Reason')}</span>
                <Select value={editor.reasonCode} onValueChange={(reasonCode) => setEditor((current) => ({ ...current, reasonCode }))}>
                  <SelectTrigger data-testid="cpq-price-reason"><SelectValue placeholder={t('cpq.priceAdjustments.dialog.reasonPlaceholder', 'Pick a reason')} /></SelectTrigger>
                  <SelectContent>
                    {reasons.map((reason) => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.note', 'Note')}{editor.reasonCode === 'other' ? ' *' : ''}</span>
                <Input maxLength={500} value={editor.reasonNote} onChange={(event) => setEditor((current) => ({ ...current, reasonNote: event.target.value }))} />
              </label>
            </div>
            <PricePreview option={option} options={options} rows={rows} bundle={bundle} previewBundle={previewBundle} errors={errors}
              previewing={previewing} invalidText={invalidText} currency={currency} />
            {serverError && (
              <Alert variant="warning">
                <AlertDescription>
                  {message(serverError.code)}
                  {serverError.code === 'STALE_REVISION' && (
                    <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => { onStale(); onClose() }}>
                      {t('cpq.priceAdjustments.dialog.reload', 'Reload')}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <div>
            {option.rows.length > 0 && (
              <Button type="button" variant="destructive-outline" onClick={() => { void onRemove(option).then((done) => { if (done) onClose() }) }} data-testid="cpq-price-remove">
                {t('cpq.priceDialog.remove', 'Remove adjustment')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('cpq.priceAdjustments.dialog.cancel', 'Cancel')}</Button>
            <Button type="button" onClick={() => void save()} disabled={!canSave} title={t('cpq.priceAdjustments.dialog.saveShortcut', 'Ctrl/Cmd+Enter')} data-testid="cpq-price-save">
              {saving ? t('cpq.priceAdjustments.dialog.saving', 'Saving…') : t('cpq.priceAdjustments.dialog.save', 'Save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
