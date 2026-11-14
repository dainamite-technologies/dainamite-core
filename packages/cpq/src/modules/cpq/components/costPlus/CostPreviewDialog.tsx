'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { formatMoney } from '../../lib/formatMoney'
import { costErrorMessage } from '../../lib/costPlusView'

export type PreviewAttribute = {
  code: string
  name: string
  attributeType: string
  options: Array<{ value: string; label: string }> | null
}

type PreviewCost = { costKey: string; name: string; role: string; source: string; valueStatus: string; unitAmount: string | null; instanceAmount: string | null; currencyCode: string | null; error?: string }
type PreviewCharge = { chargeCode: string; pricingMethod: string; costs: PreviewCost[]; costTotal: string; markupRule: string | null; markupValue: string | null; listTotalPrice: number | null; error?: string }
type PreviewResult = { currencyCode: string; charges: PreviewCharge[] }

/** Typed form values → the configuration object the API expects. */
export function buildPreviewConfiguration(attributes: PreviewAttribute[], values: Record<string, string>): Record<string, unknown> {
  const configuration: Record<string, unknown> = {}
  for (const attribute of attributes) {
    const raw = values[attribute.code]
    if (raw === undefined || raw === '') continue
    if (attribute.attributeType === 'number') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) configuration[attribute.code] = parsed
    } else if (attribute.attributeType === 'boolean') configuration[attribute.code] = raw === 'true'
    else configuration[attribute.code] = raw
  }
  return configuration
}

const selectClass = 'w-full rounded-md border bg-background px-2 py-1.5 text-sm'

type Props = {
  open: boolean
  offeringId: string
  attributes: PreviewAttribute[]
  /** Highlighted in the result. */
  chargeCode?: string
  onClose: () => void
}

/** Sample-configuration form for `POST /api/cpq/cost-preview`: costs, markup and list price per charge. Persists nothing. */
export function CostPreviewDialog({ open, offeringId, attributes, chargeCode, onClose }: Props) {
  const t = useT()
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [result, setResult] = React.useState<PreviewResult | null>(null)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)

  React.useEffect(() => {
    if (open) { setResult(null); setErrorCode(null) }
  }, [open])

  const run = async () => {
    if (running) return
    setRunning(true); setErrorCode(null)
    const call = await apiCall<PreviewResult & { error?: string }>('/api/cpq/cost-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offeringId, configuration: buildPreviewConfiguration(attributes, values) }),
    })
    setRunning(false)
    if (call.ok && call.result?.charges) { setResult(call.result); return }
    setResult(null)
    setErrorCode(call.result?.error ?? (call.status === 404 ? 'COST_PLUS_DISABLED' : 'PREVIEW_FAILED'))
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void run() }
  }

  const money = (amount: string | null, currency: string | null) => (amount !== null && currency ? formatMoney(Number(amount), currency) : '—')

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-cost-preview-dialog">
        <DialogHeader>
          <DialogTitle>{t('cpq.costPreview.title', 'Preview cost')}</DialogTitle>
          <DialogDescription>{t('cpq.costPreview.description', 'Enter a sample configuration to see the costs and the resulting list price. Nothing is saved.')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {attributes.length === 0 && (
            <p className="col-span-2 text-xs text-muted-foreground">{t('cpq.costPreview.noAttributes', 'This specification has no attributes: the preview uses an empty configuration.')}</p>
          )}
          {attributes.map((attribute) => (
            <label key={attribute.code} className="space-y-1">
              <span className="text-xs font-medium">{attribute.name}</span>
              {attribute.options && attribute.options.length > 0 ? (
                <select className={selectClass} value={values[attribute.code] ?? ''} onChange={(e) => setValues({ ...values, [attribute.code]: e.target.value })}>
                  <option value="">—</option>
                  {attribute.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : attribute.attributeType === 'boolean' ? (
                <select className={selectClass} value={values[attribute.code] ?? ''} onChange={(e) => setValues({ ...values, [attribute.code]: e.target.value })}>
                  <option value="">—</option>
                  <option value="true">{t('common.yes', 'Yes')}</option>
                  <option value="false">{t('common.no', 'No')}</option>
                </select>
              ) : (
                <Input
                  inputMode={attribute.attributeType === 'number' ? 'decimal' : undefined}
                  value={values[attribute.code] ?? ''}
                  onChange={(e) => setValues({ ...values, [attribute.code]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>

        {errorCode && (
          <Alert variant="destructive"><AlertDescription>{t(`cpq.costElements.errors.${errorCode}`, costErrorMessage(errorCode, 'Preview failed'))}</AlertDescription></Alert>
        )}

        {result && (
          <div className="space-y-2 text-xs" aria-live="polite" data-testid="cpq-cost-preview-result">
            {result.charges.map((charge) => (
              <div key={charge.chargeCode} className={`rounded border p-2 ${charge.chargeCode === chargeCode ? 'border-primary' : ''}`}>
                <div className="flex justify-between font-medium">
                  <span className="font-mono">{charge.chargeCode}</span>
                  <span>
                    {t('cpq.costPreview.listPrice', 'List price')}: {charge.listTotalPrice !== null ? formatMoney(charge.listTotalPrice, result.currencyCode) : t('cpq.costPreview.noPrice', 'not priced')}
                  </span>
                </div>
                {charge.error && <p className="text-destructive">{t(`cpq.costElements.errors.${charge.error}`, costErrorMessage(charge.error))}</p>}
                {charge.costs.map((cost) => (
                  <div key={cost.costKey} className="flex justify-between text-muted-foreground">
                    <span>{cost.name} · {t(`cpq.costElements.roles.${cost.role}`, cost.role)} · {cost.valueStatus}{cost.error ? ` (${cost.error})` : ''}</span>
                    <span className="font-mono">{money(cost.instanceAmount, cost.currencyCode)}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between">
                  <span>{t('cpq.costPreview.costTotal', 'Cost total')}</span>
                  <span className="font-mono">{formatMoney(Number(charge.costTotal), result.currencyCode)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.close', 'Close')}</Button>
          <Button onClick={() => void run()} disabled={running} title="Ctrl/Cmd+Enter">
            {running ? t('cpq.costPreview.running', 'Calculating…') : t('cpq.costPreview.run', 'Preview cost')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
