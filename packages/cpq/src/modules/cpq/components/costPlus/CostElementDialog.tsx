'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import {
  allowedCostModels,
  buildCostElementPayload,
  costElementFormError,
  costElementToForm,
  costErrorMessage,
  emptyCostElementForm,
  type CostElementForm,
  type CostElementRow,
} from '../../lib/costPlusView'

type CostTable = { id: string; code: string; name: string; priceColumns: Array<{ key: string; label: string }> }

const SOURCE_FALLBACKS = { fixed: 'Fixed amount', table: 'Cost table', on_request: 'On request (supplier)' } as const
const MODEL_FALLBACKS = { flat: 'Flat', per_unit: 'Per unit', tiered: 'Tiered', volume: 'Volume' } as const

const selectClass = 'w-full rounded-md border bg-background px-2 py-1.5 text-sm'

type Props = {
  open: boolean
  charge: { id: string; chargeType: string; currencyCode: string | null; quantityAttributeCode: string | null; isCostPlus: boolean }
  /** The element being edited; null adds a new one. */
  element: CostElementRow | null
  onClose: () => void
  onSaved: () => void
}

/** Add / edit dialog for a charge cost element. `Cmd/Ctrl+Enter` saves, `Escape` cancels. */
export function CostElementDialog({ open, charge, element, onClose, onSaved }: Props) {
  const t = useT()
  const mode = element ? 'edit' : 'create'
  const [form, setForm] = React.useState<CostElementForm>(() => emptyCostElementForm(charge.chargeType, charge.currencyCode, charge.isCostPlus))
  const [tables, setTables] = React.useState<CostTable[]>([])
  const [errorCode, setErrorCode] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const set = (patch: Partial<CostElementForm>) => setForm((prev) => ({ ...prev, ...patch }))

  React.useEffect(() => {
    if (!open) return
    setForm(element ? costElementToForm(element) : emptyCostElementForm(charge.chargeType, charge.currencyCode, charge.isCostPlus))
    setErrorCode(null)
    // Reset only when the dialog (re)opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Cost tables only: purpose `cost` (price tables are refused with WRONG_TABLE_PURPOSE).
  React.useEffect(() => {
    if (!open || form.source !== 'table' || tables.length > 0) return
    let cancelled = false
    void (async () => {
      const call = await apiCall<{ items?: CostTable[] }>('/api/cpq/pricing-tables?purpose=cost&pageSize=100')
      if (!cancelled && call.ok) setTables(call.result?.items ?? [])
    })()
    return () => { cancelled = true }
  }, [open, form.source, tables.length])

  const models = allowedCostModels(charge.quantityAttributeCode)
  const selectedTable = tables.find((table) => table.id === form.costTableId)
  const localError = costElementFormError(form, mode)
  const message = (code: string) => t(`cpq.costElements.errors.${code}`, costErrorMessage(code, code))

  const save = async () => {
    if (saving) return
    if (localError) { setErrorCode(localError); return }
    setSaving(true); setErrorCode(null)
    const body = buildCostElementPayload(form, mode, { productChargeId: charge.id, id: element?.id })
    const call = await apiCall<{ error?: string }>('/api/cpq/charge-cost-elements', {
      method: mode === 'create' ? 'POST' : 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (call.ok) { onSaved(); onClose(); return }
    setErrorCode(call.result?.error ?? (call.status === 404 ? 'COST_PLUS_DISABLED' : 'SAVE_FAILED'))
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent onKeyDown={onKeyDown} data-testid="cpq-cost-element-dialog">
        <DialogHeader>
          <DialogTitle>
            {element ? t('cpq.costElements.dialog.editTitle', 'Edit cost element') : t('cpq.costElements.dialog.addTitle', 'Add cost element')}
          </DialogTitle>
          <DialogDescription>{t('cpq.costElements.dialog.description', 'What this charge costs us. Price-basis costs set a cost-plus price; margin-only costs only feed margin.')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.code', 'Code')}</span>
            <Input value={form.code} disabled={mode === 'edit'} autoFocus={mode === 'create'} onChange={(e) => set({ code: e.target.value })} placeholder="e.g. transport" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.name', 'Name')}</span>
            <Input value={form.name} autoFocus={mode === 'edit'} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.role', 'Role')}</span>
            <select className={selectClass} value={form.role} onChange={(e) => set({ role: e.target.value as CostElementForm['role'] })}>
              <option value="price_basis" disabled={!charge.isCostPlus}>{t('cpq.costElements.roles.price_basis', 'Price basis')}</option>
              <option value="margin_only">{t('cpq.costElements.roles.margin_only', 'Margin only')}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.costType', 'Cost type')}</span>
            <select className={selectClass} value={form.costType} onChange={(e) => set({ costType: e.target.value as CostElementForm['costType'] })}>
              <option value="mrc">{t('cpq.costElements.types.mrc', 'MRC (recurring)')}</option>
              <option value="nrc">{t('cpq.costElements.types.nrc', 'NRC (one-time)')}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.source', 'Source')}</span>
            <select
              className={selectClass}
              value={form.source}
              onChange={(e) => {
                const source = e.target.value as CostElementForm['source']
                // Tiered / volume only work from a table.
                set({ source, ...(source !== 'table' && (form.costModel === 'tiered' || form.costModel === 'volume') ? { costModel: 'flat' as const } : {}) })
              }}
            >
              {(['fixed', 'table', 'on_request'] as const).map((source) => (
                <option key={source} value={source}>{t(`cpq.costElements.sources.${source}`, SOURCE_FALLBACKS[source])}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.model', 'Cost model')}</span>
            <select className={selectClass} value={form.costModel} onChange={(e) => set({ costModel: e.target.value as CostElementForm['costModel'] })}>
              {models.map((model) => (
                <option key={model} value={model} disabled={(model === 'tiered' || model === 'volume') && form.source !== 'table'}>
                  {t(`cpq.costElements.models.${model}`, MODEL_FALLBACKS[model])}
                </option>
              ))}
            </select>
          </label>

          {form.source === 'fixed' && (
            <>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t('cpq.costElements.amount', 'Amount')} *</span>
                <Input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t('cpq.costElements.currency', 'Currency')} *</span>
                <Input value={form.currencyCode} maxLength={3} onChange={(e) => set({ currencyCode: e.target.value.toUpperCase() })} />
              </label>
            </>
          )}
          {form.source === 'table' && (
            <>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t('cpq.costElements.costTable', 'Cost table')} *</span>
                <select className={selectClass} value={form.costTableId} onChange={(e) => set({ costTableId: e.target.value, costColumnKey: '' })}>
                  <option value="">{t('cpq.costElements.selectTable', 'Select table…')}</option>
                  {tables.map((table) => <option key={table.id} value={table.id}>{table.name} ({table.code})</option>)}
                </select>
                {tables.length === 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {t('cpq.costElements.noCostTables', 'No cost tables yet. Create a pricing table with purpose “cost”.')}
                  </span>
                )}
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t('cpq.costElements.costColumn', 'Column')} *</span>
                <select className={selectClass} value={form.costColumnKey} disabled={!selectedTable} onChange={(e) => set({ costColumnKey: e.target.value })}>
                  <option value="">{t('cpq.costElements.selectColumn', 'Select column…')}</option>
                  {selectedTable?.priceColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                </select>
              </label>
            </>
          )}
          {form.source === 'on_request' && (
            <>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t('cpq.costElements.estimate', 'Estimate (optional)')}</span>
                <Input inputMode="decimal" value={form.estimateAmount} onChange={(e) => set({ estimateAmount: e.target.value })} placeholder="0.00" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t('cpq.costElements.currency', 'Currency')}{form.estimateAmount.trim() ? ' *' : ''}</span>
                <Input value={form.currencyCode} maxLength={3} onChange={(e) => set({ currencyCode: e.target.value.toUpperCase() })} />
              </label>
            </>
          )}

          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.supplier', 'Default supplier')}</span>
            <Input value={form.defaultSupplierName} onChange={(e) => set({ defaultSupplierName: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">{t('cpq.costElements.validityDays', 'Validity (days)')}</span>
            <Input inputMode="numeric" value={form.defaultValidityDays} onChange={(e) => set({ defaultValidityDays: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.requiresSourcing} onChange={(e) => set({ requiresSourcing: e.target.checked })} />
            {t('cpq.costElements.requiresSourcing', 'Needs a supplier answer')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            {t('cpq.costElements.active', 'Active')}
          </label>
        </div>

        {errorCode && (
          <Alert variant="destructive" data-testid="cpq-cost-element-error">
            <AlertDescription>{message(errorCode)}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving} title="Ctrl/Cmd+Enter">
            {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
