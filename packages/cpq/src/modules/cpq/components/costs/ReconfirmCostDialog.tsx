'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import type { FullCostRow } from '../../lib/orderInventoryCostView'
import {
  RECONFIRM_ISSUE_FALLBACKS,
  buildReconfirmPatch,
  reconfirmErrorCode,
  reconfirmErrorFallback,
  reconfirmFormFromCost,
  reconfirmIssues,
  type ReconfirmForm,
} from '../../lib/orderReconfirmView'

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
 * Re-confirm an order line cost before activation (ARC costs spec Q-D13): value, currency, supplier, quote ref, validity, term and note.
 * Margin only; the order's charges and totals never change. Ctrl/Cmd+Enter saves, Escape cancels (Radix dialog).
 */
export function ReconfirmCostDialog({ orderId, cost, lineName, currency, onClose, onDone }: {
  orderId: string
  cost: FullCostRow
  lineName: string
  /** The order currency: the default when the cost holds none. */
  currency: string
  onClose: () => void
  /** Called after a successful write (the caller refreshes its read). */
  onDone: () => void
}) {
  const t = useT()
  const [form, setForm] = React.useState<ReconfirmForm>(() => reconfirmFormFromCost(cost, currency))
  const [showIssues, setShowIssues] = React.useState(false)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const issues = reconfirmIssues(form, cost)
  const set = <K extends keyof ReconfirmForm>(key: K, value: ReconfirmForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setErrorCode(null)
    const call = await apiCall<unknown>(`/api/cpq/orders/${orderId}/costs/${cost.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildReconfirmPatch(form, cost)),
    })
    setSaving(false)
    if (call.ok) { onDone(); return }
    setErrorCode(reconfirmErrorCode(call.status, call.result))
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }
  const shown = showIssues ? issues.map((issue) => t(`cpq.orderCosts.reconfirm.issues.${issue}`, RECONFIRM_ISSUE_FALLBACKS[issue])) : []
  const errorText = errorCode ? t(`cpq.orderCosts.reconfirm.errors.${errorCode}`, reconfirmErrorFallback(errorCode)) : null
  const needsNote = issues.includes('NOTE_REQUIRED') || issues.includes('VALIDITY_EVIDENCE_REQUIRED')

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-reconfirm-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.orderCosts.reconfirm.title', 'Re-confirm cost')}</DialogTitle>
          <DialogDescription>{[cost.name, lineName].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('cpq.orderCosts.reconfirm.hint', 'Changes the margin only — the order price does not change. At activation the subscription takes these values.')}
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label={t('cpq.quoteCosts.value', 'Value')}>
                <Input autoFocus inputMode="decimal" value={form.unitAmount} onChange={(event) => set('unitAmount', event.target.value)} />
              </Field>
            </div>
            <Field label={t('cpq.quoteCosts.currency', 'Currency')}>
              <Input value={form.currencyCode} maxLength={3} onChange={(event) => set('currencyCode', event.target.value.toUpperCase())} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('cpq.quoteCosts.supplier', 'Supplier')}>
              <Input value={form.supplierName} maxLength={255} onChange={(event) => set('supplierName', event.target.value)} />
            </Field>
            <Field label={t('cpq.quoteCosts.dialog.supplierQuoteRef', 'Supplier quote ref')}>
              <Input value={form.supplierQuoteRef} maxLength={255} onChange={(event) => set('supplierQuoteRef', event.target.value)} />
            </Field>
            <Field label={t('cpq.quoteCosts.validUntil', 'Valid until')}>
              <Input type="date" value={form.validUntil} onChange={(event) => set('validUntil', event.target.value)} />
            </Field>
            <Field label={t('cpq.quoteCosts.dialog.supplierTermEnd', 'Supplier term end')}>
              <Input type="date" value={form.supplierTermEnd} onChange={(event) => set('supplierTermEnd', event.target.value)} />
            </Field>
            <Field label={t('cpq.quoteCosts.dialog.supplierMinTermMonths', 'Min. term (months)')}>
              <Input inputMode="numeric" value={form.supplierMinTermMonths} onChange={(event) => set('supplierMinTermMonths', event.target.value)} />
            </Field>
          </div>
          <Field label={`${t('cpq.quoteCosts.dialog.note', 'Note')}${needsNote ? ' *' : ''}`}>
            <Textarea rows={2} maxLength={500} value={form.note} onChange={(event) => set('note', event.target.value)} />
          </Field>
          {(shown.length > 0 || errorText) && (
            <Alert variant="warning" data-testid="cpq-reconfirm-errors">
              <AlertDescription>
                {shown.length > 0 && <span className="block">{shown.join(' · ')}</span>}
                {errorText && <span className="block">{errorText}</span>}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.quoteCosts.dialog.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving} title={t('cpq.common.submitShortcut', 'Ctrl/Cmd+Enter')}>
            {saving ? t('cpq.quoteCosts.dialog.saving', 'Saving…') : t('cpq.orderCosts.reconfirm.confirm', 'Re-confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
