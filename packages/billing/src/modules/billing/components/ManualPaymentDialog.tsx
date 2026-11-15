"use client"
import * as React from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { AccountPicker } from './AccountPicker'

/**
 * Manual payment entry (Spec C). With an account the payment is matched and
 * applied as credit to the account's open invoices; without one it stays
 * unmatched. `billAccountId` pre-selects the account (account page).
 */
export function ManualPaymentDialog({
  open,
  onClose,
  onCreated,
  billAccountId,
  currencyCode,
}: {
  open: boolean
  onClose: () => void
  onCreated: (paymentId: string) => void
  billAccountId?: string
  currencyCode?: string
}) {
  const t = useT()
  const today = new Date().toISOString().slice(0, 10)
  const [receivedAt, setReceivedAt] = React.useState(today)
  const [amount, setAmount] = React.useState('')
  const [currency, setCurrency] = React.useState(currencyCode ?? 'PLN')
  const [reference, setReference] = React.useState('')
  const [payerName, setPayerName] = React.useState('')
  const [accountId, setAccountId] = React.useState(billAccountId ?? '')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setReceivedAt(new Date().toISOString().slice(0, 10))
    setAmount('')
    setReference('')
    setPayerName('')
    setAccountId(billAccountId ?? '')
    setCurrency(currencyCode ?? 'PLN')
  }, [billAccountId, currencyCode, open])

  const submit = React.useCallback(async () => {
    const value = Number.parseFloat(amount)
    if (!(value > 0) || saving) {
      flash(t('billing.payments.manual.amount_invalid', 'Amount must be greater than 0'), 'error')
      return
    }
    setSaving(true)
    try {
      const call = await apiCallOrThrow<{ paymentId: string }>('/api/billing/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivedAt,
          amount: value,
          currencyCode: currency.trim().toUpperCase(),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
          ...(accountId ? { billAccountId: accountId } : {}),
        }),
      })
      flash(t('billing.payments.manual.saved', 'Payment recorded'), 'success')
      onClose()
      if (call.result?.paymentId) onCreated(call.result.paymentId)
    } catch (err) {
      flash(normalizeCrudServerError(err).message || t('billing.payments.manual.failed', 'Could not record the payment'), 'error')
    } finally {
      setSaving(false)
    }
  }, [accountId, amount, currency, onClose, onCreated, payerName, receivedAt, reference, saving, t])

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
          <DialogTitle>{t('billing.payments.manual.title', 'Record payment')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('billing.payments.columns.received', 'Received')}</span>
            <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('billing.payments.columns.amount', 'Amount')}</span>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('billing.payments.fields.currency', 'Currency')}</span>
            <Input value={currency} maxLength={3} disabled={Boolean(currencyCode)} onChange={(e) => setCurrency(e.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('billing.payments.columns.payer', 'Payer')}</span>
            <Input value={payerName} onChange={(e) => setPayerName(e.currentTarget.value)} />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted-foreground">{t('billing.payments.columns.reference', 'Reference')}</span>
            <Input value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
          </label>
          {!billAccountId ? (
            <div className="col-span-2 flex flex-col gap-1">
              <span className="text-muted-foreground">{t('billing.payments.fields.account_optional', 'Billing account (optional)')}</span>
              <AccountPicker value={accountId} onChange={setAccountId} currencyCode={currency.trim().toUpperCase()} billingMode="postpaid" />
            </div>
          ) : null}
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
                {t('billing.common.save', 'Save')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
