"use client"
import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatMoney } from './InvoicesTable'

/**
 * Manual allocation (Spec C): lists the open invoices / debit memos of the
 * payment's account (oldest due first) with amounts pre-filled from the
 * unallocated money; the operator edits them and confirms.
 */

type OpenInvoice = {
  id: string
  number: string
  document_type: string
  status: string
  due_date: string | null
  outstanding: string
  currency_code: string
}

export function AllocatePaymentDialog({
  open,
  onClose,
  onDone,
  paymentId,
  billAccountId,
  unallocated,
  currencyCode,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  paymentId: string
  billAccountId: string
  unallocated: number
  currencyCode: string
}) {
  const t = useT()
  const [invoices, setInvoices] = React.useState<OpenInvoice[]>([])
  const [amounts, setAmounts] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    void apiCall<{ items: OpenInvoice[] }>(
      `/api/billing/invoices?billAccountId=${encodeURIComponent(billAccountId)}&testRun=false&pageSize=100`,
    ).then((call) => {
      const open = (call.ok ? (call.result?.items ?? []) : [])
        .filter(
          (inv) =>
            ['posted', 'partially_paid'].includes(inv.status) &&
            ['invoice', 'debit_memo'].includes(inv.document_type) &&
            Number.parseFloat(inv.outstanding) > 0 &&
            inv.currency_code === currencyCode,
        )
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
      setInvoices(open)
      let left = Math.round(unallocated * 100)
      const prefill: Record<string, string> = {}
      for (const inv of open) {
        const take = Math.min(left, Math.round(Number.parseFloat(inv.outstanding) * 100))
        prefill[inv.id] = take > 0 ? (take / 100).toFixed(2) : ''
        left -= Math.max(0, take)
      }
      setAmounts(prefill)
    })
  }, [billAccountId, currencyCode, open, unallocated])

  const total = Object.values(amounts).reduce((sum, v) => sum + (Number.parseFloat(v) || 0), 0)

  const submit = React.useCallback(async () => {
    const allocations = Object.entries(amounts)
      .map(([invoiceId, value]) => ({ invoiceId, amount: Number.parseFloat(value) }))
      .filter((a) => a.amount > 0)
    if (allocations.length === 0 || saving) return
    if (total > unallocated + 0.0001) {
      flash(t('billing.payments.allocate.too_much', 'The total is more than the unallocated amount'), 'error')
      return
    }
    setSaving(true)
    try {
      await apiCallOrThrow('/api/billing/payments/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, allocations }),
      })
      flash(t('billing.payments.allocate.success', 'Payment allocated'), 'success')
      onDone()
      onClose()
    } catch (err) {
      flash(normalizeCrudServerError(err).message || t('billing.payments.allocate.failed', 'Allocation failed'), 'error')
    } finally {
      setSaving(false)
    }
  }, [amounts, onClose, onDone, paymentId, saving, t, total, unallocated])

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('billing.payments.allocate.title', 'Allocate payment')}</DialogTitle>
          <DialogDescription>
            {t('billing.payments.allocate.help', 'Unallocated')}: {formatMoney(String(unallocated), currencyCode)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-2 overflow-auto py-2 text-sm">
          {invoices.length === 0 ? (
            <div className="text-muted-foreground">{t('billing.payments.allocate.none', 'This account has no open invoices.')}</div>
          ) : (
            invoices.map((inv) => (
              <div key={inv.id} className="grid grid-cols-[1fr_auto_120px] items-center gap-3">
                <div>
                  <div className="font-medium">{inv.number}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('billing.invoices.columns.due', 'Due')}: {inv.due_date?.slice(0, 10) ?? '—'}
                  </div>
                </div>
                <span className="tabular-nums text-muted-foreground">{formatMoney(inv.outstanding, inv.currency_code)}</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amounts[inv.id] ?? ''}
                  onChange={(e) => {
                    const value = e.currentTarget.value
                    setAmounts((prev) => ({ ...prev, [inv.id]: value }))
                  }}
                />
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t('billing.payments.allocate.total', 'Total')}: {formatMoney(String(total), currencyCode)} ·{' '}
              <KbdShortcut keys={['Ctrl/⌘', 'Enter']} /> · <Kbd>Esc</Kbd>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('billing.common.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={saving || total <= 0}>
                {t('billing.payments.allocate.action', 'Allocate')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
