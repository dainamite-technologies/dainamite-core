'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  buildCostCreateBody,
  buildCostPatch,
  costFormFromCost,
  costFormIssues,
  emptyCostForm,
  type CostForm,
  type FullQuoteCost,
} from '../../../../../lib/quoteCostView'
import { CostFormBody, type ChargeOption, type CostDialogMode } from './CostFormBody'

export type CostDialogProps = {
  mode: CostDialogMode
  quoteLineId: string
  lineName: string
  currency: string
  /** The `pricingRevision` of the costs read; sent as `expectedRevision`. */
  revision: number
  existing: FullQuoteCost | null
  charges: ChargeOption[]
  /** Sends the request body; resolves to an error code, or null on success. */
  onSubmit: (body: Record<string, unknown>) => Promise<string | null>
  onClose: () => void
  onReload: () => void
}

/** Add / Edit / Confirm a cost. Ctrl/Cmd+Enter saves; Escape cancels (Radix dialog). */
export function CostDialog({ mode, quoteLineId, lineName, currency, revision, existing, charges, onSubmit, onClose, onReload }: CostDialogProps) {
  const t = useT()
  const [form, setForm] = React.useState<CostForm>(() => existing ? costFormFromCost(existing, currency, mode === 'confirm') : emptyCostForm(currency))
  const [showIssues, setShowIssues] = React.useState(false)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const issues = costFormIssues(form, existing)

  const save = async () => {
    if (saving) return
    if (issues.length > 0) { setShowIssues(true); return }
    setSaving(true); setErrorCode(null)
    const body = existing ? buildCostPatch(form, existing, mode === 'confirm', revision) : buildCostCreateBody(form, quoteLineId, revision)
    const code = await onSubmit(body)
    setSaving(false)
    if (code) setErrorCode(code)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }
  const title = mode === 'add'
    ? t('cpq.quoteCosts.dialog.addTitle', 'Add cost')
    : mode === 'confirm' ? t('cpq.quoteCosts.dialog.confirmTitle', 'Confirm cost') : t('cpq.quoteCosts.dialog.editTitle', 'Edit cost')

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-cost-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{lineName}</DialogDescription>
        </DialogHeader>
        <CostFormBody form={form} onChange={setForm} mode={mode} existing={existing} charges={charges}
          issues={showIssues ? issues : []} errorCode={errorCode} onReload={onReload} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cpq.quoteCosts.dialog.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving} title="Ctrl/Cmd+Enter">
            {saving ? t('cpq.quoteCosts.dialog.saving', 'Saving…') : mode === 'confirm' ? t('cpq.quoteCosts.dialog.confirm', 'Confirm') : t('cpq.quoteCosts.dialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
