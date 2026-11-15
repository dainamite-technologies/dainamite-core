"use client"
import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatMoney } from './InvoicesTable'

/**
 * Create a credit or debit memo for a posted invoice (Spec D, D-D9).
 *
 *   - credit memo: the original lines with a checkbox and editable quantity /
 *     unit net (VAT rate stays the original's), a "Full credit" shortcut,
 *     the required reason and the projected totals;
 *   - debit memo: the reason only — lines are added on the draft.
 *
 * Creates a DRAFT memo and hands its id back (the page navigates to it).
 * Cmd/Ctrl+Enter submits, Escape cancels.
 */

export type MemoSourceLine = {
  id: string
  description: string | null
  quantity: string
  unit_price_net: string
  tax_rate: string | number | null
}

type LineState = { selected: boolean; quantity: string; unitPriceNet: string }

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function CreateMemoDialog({
  open,
  type,
  invoiceId,
  invoiceNumber,
  currencyCode,
  lines,
  onClose,
  onCreated,
}: {
  open: boolean
  type: 'credit_memo' | 'debit_memo'
  invoiceId: string
  invoiceNumber: string
  currencyCode: string
  lines: MemoSourceLine[]
  onClose: () => void
  onCreated: (memoId: string) => void
}) {
  const t = useT()
  const [reason, setReason] = React.useState('')
  const [state, setState] = React.useState<Record<string, LineState>>({})
  const [saving, setSaving] = React.useState(false)

  const fullCredit = React.useCallback(() => {
    setState(
      Object.fromEntries(
        lines.map((line) => [
          line.id,
          { selected: true, quantity: String(Number(line.quantity)), unitPriceNet: String(Math.abs(Number(line.unit_price_net))) },
        ]),
      ),
    )
  }, [lines])

  React.useEffect(() => {
    if (!open) return
    setReason('')
    if (type === 'credit_memo') fullCredit()
    else setState({})
  }, [fullCredit, open, type])

  const selected = lines.filter((line) => state[line.id]?.selected)
  const projected = selected.reduce(
    (acc, line) => {
      const s = state[line.id]
      const net = round2((Number.parseFloat(s.quantity) || 0) * (Number.parseFloat(s.unitPriceNet) || 0))
      const tax = round2(net * ((Number(line.tax_rate) || 0) / 100))
      return { net: acc.net + net, tax: acc.tax + tax }
    },
    { net: 0, tax: 0 },
  )

  const update = (id: string, patch: Partial<LineState>) =>
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const submit = React.useCallback(async () => {
    if (saving) return
    if (!reason.trim()) {
      flash(t('billing.memo.error.reason_required', 'A reason is required'), 'error')
      return
    }
    if (type === 'credit_memo' && selected.length === 0) {
      flash(t('billing.memo.error.no_lines', 'Select at least one line to credit'), 'error')
      return
    }
    setSaving(true)
    try {
      const body =
        type === 'credit_memo'
          ? {
              type,
              reason: reason.trim(),
              lines: selected.map((line) => ({
                correctsLineId: line.id,
                description: line.description ?? '',
                quantity: Number.parseFloat(state[line.id].quantity),
                unitPriceNet: Number.parseFloat(state[line.id].unitPriceNet),
              })),
            }
          : { type, reason: reason.trim() }
      const call = await apiCallOrThrow<{ memoId: string }>(`/api/billing/invoices/${encodeURIComponent(invoiceId)}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      flash(t('billing.memo.created', 'Draft memo created'), 'success')
      onClose()
      if (call.result?.memoId) onCreated(call.result.memoId)
    } catch (err) {
      const code = (err as { body?: { code?: string } } | null)?.body?.code
      flash(
        code === 'billing.memo.exceeds_invoice'
          ? t('billing.memo.error.exceeds', 'The credit is more than what is left to credit on this invoice')
          : normalizeCrudServerError(err).message || t('billing.memo.error.create', 'Could not create the memo'),
        'error',
      )
    } finally {
      setSaving(false)
    }
  }, [invoiceId, onClose, onCreated, reason, saving, selected, state, t, type])

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        className="max-w-3xl"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {type === 'credit_memo'
              ? t('billing.memo.create_credit.title', 'Create credit memo')
              : t('billing.memo.create_debit.title', 'Create debit memo')}
          </DialogTitle>
          <DialogDescription>
            {t('billing.memo.corrects', 'Corrects')} {invoiceNumber} ·{' '}
            {t('billing.memo.hint', 'Corrects this document only. Update the billing item to change future invoices.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2 text-sm">
          {type === 'credit_memo' ? (
            <>
              <div className="flex items-center justify-between">
                <span className="font-medium">{t('billing.memo.lines', 'Lines to credit')}</span>
                <Button type="button" variant="outline" size="sm" onClick={fullCredit}>
                  {t('billing.memo.full_credit', 'Full credit')}
                </Button>
              </div>
              <div className="max-h-72 overflow-auto rounded-md border">
                {lines.map((line) => {
                  const s = state[line.id] ?? { selected: false, quantity: '', unitPriceNet: '' }
                  return (
                    <div key={line.id} className="grid grid-cols-[24px_1fr_90px_110px_60px] items-center gap-2 border-b px-2 py-1 last:border-b-0">
                      <Checkbox checked={s.selected} onCheckedChange={(next) => update(line.id, { selected: next === true })} />
                      <span className="truncate">{line.description}</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={s.quantity}
                        disabled={!s.selected}
                        onChange={(e) => update(line.id, { quantity: e.currentTarget.value })}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={s.unitPriceNet}
                        disabled={!s.selected}
                        onChange={(e) => update(line.id, { unitPriceNet: e.currentTarget.value })}
                      />
                      <span className="text-right text-xs text-muted-foreground">{Number(line.tax_rate ?? 0)} %</span>
                    </div>
                  )
                })}
              </div>
              <div className="text-right text-muted-foreground">
                {t('billing.memo.projected', 'Credit')}: {formatMoney(String(projected.net), currencyCode)} +{' '}
                {t('billing.invoices.lines.columns.tax_amount', 'VAT')} {formatMoney(String(projected.tax), currencyCode)} ={' '}
                <span className="font-medium text-foreground">{formatMoney(String(projected.net + projected.tax), currencyCode)}</span>
              </div>
            </>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('billing.memo.reason', 'Reason (printed on the document)')} *</span>
            <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          </label>
        </div>
        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> · <Kbd>Esc</Kbd>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('billing.common.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={saving}>
                {t('billing.memo.create', 'Create draft')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
