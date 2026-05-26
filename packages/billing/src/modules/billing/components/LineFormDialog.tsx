"use client"
import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Shared dialog for add / edit of an invoice line.
 *
 * - `mode='add'` shows empty fields and calls the
 *   `billing.invoices.add_draft_line` route on submit.
 * - `mode='edit'` pre-fills from `initial` and calls
 *   `billing.invoices.edit_draft_line`.
 *
 * The caller owns the network call (so we can stay simple and avoid
 * threading apiCall context through the component). On submit, this
 * dialog only emits `onSubmit(values)` and the parent decides which
 * command to hit.
 *
 * UX conventions per `@open-mercato/ui`:
 *   - `Cmd/Ctrl + Enter` submits.
 *   - `Escape` cancels (Radix Dialog handles this for free).
 *   - Hint row at the bottom lists both shortcuts via `Kbd` /
 *     `KbdShortcut` (not raw `<span>`).
 */

export type LineFormValues = {
  description: string
  quantity: number
  unitPriceNet: number
  /** Optional explicit total override (operator "I know better" path). */
  totalNetAmount?: number
}

export type LineFormDialogProps = {
  open: boolean
  mode: 'add' | 'edit'
  /** Pre-fill values for edit mode. */
  initial?: Partial<LineFormValues>
  submitting?: boolean
  onSubmit: (values: LineFormValues) => Promise<void> | void
  onCancel: () => void
}

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

export function LineFormDialog({
  open,
  mode,
  initial,
  submitting = false,
  onSubmit,
  onCancel,
}: LineFormDialogProps) {
  const t = useT()
  const [description, setDescription] = React.useState(initial?.description ?? '')
  const [quantity, setQuantity] = React.useState(
    initial?.quantity != null ? String(initial.quantity) : '',
  )
  const [unitPriceNet, setUnitPriceNet] = React.useState(
    initial?.unitPriceNet != null ? String(initial.unitPriceNet) : '',
  )
  const [totalOverride, setTotalOverride] = React.useState(
    initial?.totalNetAmount != null ? String(initial.totalNetAmount) : '',
  )
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setDescription(initial?.description ?? '')
      setQuantity(initial?.quantity != null ? String(initial.quantity) : '')
      setUnitPriceNet(initial?.unitPriceNet != null ? String(initial.unitPriceNet) : '')
      setTotalOverride(initial?.totalNetAmount != null ? String(initial.totalNetAmount) : '')
      setError(null)
    }
  }, [open, initial])

  const handleSubmit = React.useCallback(async () => {
    const trimmedDescription = description.trim()
    if (!trimmedDescription) {
      setError(t('billing.invoices.lines.form.error.description_required', 'Description is required'))
      return
    }
    const quantityValue = toNumber(quantity)
    if (quantityValue == null || quantityValue < 0) {
      setError(t('billing.invoices.lines.form.error.quantity_invalid', 'Quantity must be a non-negative number'))
      return
    }
    const unitPriceValue = toNumber(unitPriceNet)
    if (unitPriceValue == null) {
      setError(t('billing.invoices.lines.form.error.unit_price_invalid', 'Unit price must be a number'))
      return
    }
    const totalOverrideRaw = totalOverride.trim()
    let totalOverrideValue: number | undefined
    if (totalOverrideRaw !== '') {
      const parsed = toNumber(totalOverrideRaw)
      if (parsed == null) {
        setError(t('billing.invoices.lines.form.error.total_invalid', 'Total override must be a number when set'))
        return
      }
      totalOverrideValue = parsed
    }
    setError(null)
    await onSubmit({
      description: trimmedDescription,
      quantity: quantityValue,
      unitPriceNet: unitPriceValue,
      totalNetAmount: totalOverrideValue,
    })
  }, [description, onSubmit, quantity, t, totalOverride, unitPriceNet])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Cmd/Ctrl + Enter submits — required by the OM UX convention
      // for every dialog. Escape is handled by Radix Dialog itself.
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  // Auto-compute total for the helper text — purely informational, not
  // submitted unless the operator types into `totalOverride`.
  const computedTotal = React.useMemo(() => {
    const q = toNumber(quantity)
    const u = toNumber(unitPriceNet)
    if (q == null || u == null) return null
    return (Math.round(q * u * 100) / 100).toFixed(2)
  }, [quantity, unitPriceNet])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {mode === 'add'
              ? t('billing.invoices.lines.form.title_add', 'Add invoice line')
              : t('billing.invoices.lines.form.title_edit', 'Edit invoice line')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'billing.invoices.lines.form.help',
              'Changes are recorded in the draft-edit audit log.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.invoices.lines.form.description', 'Description')}
            </span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              rows={2}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('billing.invoices.lines.form.quantity', 'Quantity')}
              </span>
              <Input
                type="number"
                value={quantity}
                step="0.0001"
                onChange={(event) => setQuantity(event.currentTarget.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('billing.invoices.lines.form.unit_price', 'Unit price (net)')}
              </span>
              <Input
                type="number"
                value={unitPriceNet}
                step="0.0001"
                onChange={(event) => setUnitPriceNet(event.currentTarget.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('billing.invoices.lines.form.total_override', 'Total override (optional)')}
            </span>
            <Input
              type="number"
              value={totalOverride}
              step="0.0001"
              placeholder={computedTotal ?? ''}
              onChange={(event) => setTotalOverride(event.currentTarget.value)}
            />
            <span className="text-xs text-muted-foreground">
              {computedTotal != null
                ? t(
                    'billing.invoices.lines.form.computed_total',
                    'Computed total: {computed}',
                  ).replace('{computed}', computedTotal)
                : null}
            </span>
          </label>
          {error ? (
            <div className="text-sm text-destructive">{error}</div>
          ) : null}
        </div>
        <DialogFooter>
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-xs text-muted-foreground">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} />
              {' '}
              {t('billing.invoices.lines.form.submit_hint', 'to save,')}
              {' '}
              <Kbd>Esc</Kbd>
              {' '}
              {t('billing.invoices.lines.form.cancel_hint', 'to cancel')}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('billing.common.cancel', 'Cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
              >
                {submitting
                  ? t('billing.invoices.lines.form.saving', 'Saving…')
                  : t('billing.common.save', 'Save')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
