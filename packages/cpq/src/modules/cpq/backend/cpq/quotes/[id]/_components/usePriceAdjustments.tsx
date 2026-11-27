'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  ADJUSTMENT_ERROR_FALLBACKS,
  adjustmentAccess,
  adjustmentErrorCode,
  canDeleteInvalidAdjustment,
  collectAdjustmentErrors,
  type AdjustmentErrorSourceQuote,
} from '../../../../../lib/priceAdjustmentView'
import { removalBody, targetName, kindOfTarget, type DialogLine, type StoredRow } from '../../../../../lib/priceDialogView'
import { isOnTarget, targetKey, targetOf, type PriceTarget } from '../../../../../lib/targetPrice'
import { PriceDialog, type AdjustmentReason } from './PriceDialog'
import type { AdjustableCharge, AdjustableLine, PriceAdjustmentUi } from './priceAdjustmentContext'

type ControllerQuote = {
  id: string
  cpqStatus: string
  currencyCode: string
  convertedOrderId: string | null
  pricingRevision?: number
  adjustmentErrors?: Array<{ adjustmentId: string; code: string }>
  lines: Array<AdjustableLine & DialogLine & { charges: AdjustableCharge[] }>
}

type ListResponse = {
  items: StoredRow[]
  total: number
  pricingRevision: number
  enabled: boolean
  reasons?: AdjustmentReason[]
}

type DialogState = { lineId: string; chargeCode?: string; targetKey?: string }

/**
 * Owns negotiated-price state for the quote page: the adjustment list,
 * reason options, the Price dialog and remove confirmation. Every write
 * returns the repriced quote, which is handed back through `onQuote`.
 */
export function usePriceAdjustments<Q extends ControllerQuote>({ quote, quoteType, canAdjust, onQuote, reloadQuote }: {
  quote: Q | null
  quoteType: string
  canAdjust: boolean
  onQuote: (quote: Q) => void
  reloadQuote: () => Promise<void>
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [list, setList] = React.useState<ListResponse | null>(null)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const quoteId = quote?.id ?? null
  const revision = quote?.pricingRevision ?? 0

  const loadList = React.useCallback(async () => {
    if (!quoteId) return
    const call = await apiCall<ListResponse>(`/api/cpq/quotes/${quoteId}/price-adjustments?pageSize=100`)
    if (call.ok && call.result) setList(call.result)
    else setList({ items: [], total: 0, pricingRevision: 0, enabled: false })
  }, [quoteId])

  // Refresh whenever the quote's pricing revision moves (own writes, line edits, recalculation).
  React.useEffect(() => { void loadList() }, [loadList, revision])

  const items = React.useMemo(() => list?.items ?? [], [list])
  const reasons = React.useMemo(() => list?.reasons ?? [], [list])
  const reasonLabels = React.useMemo(() => Object.fromEntries(reasons.map((reason) => [reason.value, reason.label])), [reasons])
  const errorsById = React.useMemo(() => collectAdjustmentErrors(quote as AdjustmentErrorSourceQuote | null), [quote])

  const accessInput = {
    enabled: list ? list.enabled : null,
    canAdjust,
    cpqStatus: quote?.cpqStatus ?? 'new',
    convertedOrderId: quote?.convertedOrderId ?? null,
  }
  const access = adjustmentAccess(accessInput)

  const failed = React.useCallback(async (status: number, body: unknown) => {
    const code = adjustmentErrorCode(status, body)
    flash(t(`cpq.priceAdjustments.errors.${code}`, ADJUSTMENT_ERROR_FALLBACKS[code] ?? code), 'error')
    if (code === 'STALE_REVISION') await reloadQuote()
  }, [t, reloadQuote])

  /** Confirm, then one PUT with nothing on the target (§3.4 / §4.2). */
  const removeTarget = React.useCallback(async (target: PriceTarget, label: string): Promise<boolean> => {
    if (!quoteId) return false
    const ok = await confirm({
      title: t('cpq.priceAdjustments.deleteConfirm.title', 'Remove this price adjustment?'),
      text: t('cpq.priceDialog.removeConfirm', '{target} goes back to its standard price.', { target: label }),
      confirmText: t('cpq.priceAdjustments.deleteConfirm.confirm', 'Remove'),
      variant: 'destructive',
    })
    if (!ok) return false
    const call = await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments/target`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...removalBody(target), expectedRevision: revision }),
    })
    if (call.ok && call.result?.quote) { onQuote(call.result.quote); return true }
    await failed(call.status, call.result)
    return false
  }, [quoteId, revision, confirm, t, onQuote, failed])

  /** Locked-quote exception (§4.2): only the invalid rows, one DELETE each, as before. */
  const removeInvalid = React.useCallback(async (ids: string[]) => {
    if (!quoteId || !ids.length) return
    const ok = await confirm({
      title: t('cpq.priceAdjustments.deleteConfirm.title', 'Remove this price adjustment?'),
      text: t('cpq.priceAdjustments.deleteConfirm.text', 'The charge goes back to its standard price.'),
      confirmText: t('cpq.priceAdjustments.deleteConfirm.confirm', 'Remove'),
      variant: 'destructive',
    })
    if (!ok) return
    let current = revision
    for (const id of ids) {
      const call = await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments/${id}?expectedRevision=${current}`, { method: 'DELETE' })
      if (!call.ok || !call.result?.quote) { await failed(call.status, call.result); return }
      onQuote(call.result.quote)
      current = call.result.quote.pricingRevision ?? current + 1
    }
  }, [quoteId, revision, confirm, t, onQuote, failed])

  const labelOf = React.useCallback((target: PriceTarget) => {
    const line = quote?.lines.find((entry) => entry.lineId === target.quoteLineId)
    const chargeName = target.level === 'charge' ? line?.charges.find((entry) => entry.chargeCode === target.chargeCode)?.chargeName : undefined
    return `${line?.offeringName ?? ''} · ${targetName(t, { kind: kindOfTarget(target), target, chargeName })}`
  }, [quote, t])

  const ui: PriceAdjustmentUi = {
    access,
    quoteType,
    cpqStatus: accessInput.cpqStatus,
    reasonLabels,
    invalidIds: new Set(errorsById.keys()),
    canDeleteInvalid: canDeleteInvalidAdjustment(accessInput),
    openPrice: (line, charge) => setDialog({ lineId: line.lineId, ...(charge ? { chargeCode: charge.chargeCode } : {}) }),
    edit: (adjustmentId) => {
      const row = items.find((entry) => entry.id === adjustmentId)
      if (row) setDialog({ lineId: row.quoteLineId, targetKey: targetKey(targetOf(row)) })
    },
    remove: (adjustmentId) => {
      const row = items.find((entry) => entry.id === adjustmentId)
      if (!row) return
      const target = targetOf(row)
      if (access.editable) { void removeTarget(target, labelOf(target)); return }
      void removeInvalid(items.filter((entry) => isOnTarget(entry, target) && errorsById.has(entry.id)).map((entry) => entry.id))
    },
  }

  const line = dialog ? quote?.lines.find((entry) => entry.lineId === dialog.lineId) : undefined
  const dialogElement = quote && dialog && line ? (
    <PriceDialog<Q>
      key={`${dialog.lineId}:${dialog.chargeCode ?? ''}:${dialog.targetKey ?? ''}`}
      open
      quoteId={quote.id}
      currency={quote.currencyCode}
      pricingRevision={revision}
      line={line}
      lines={quote.lines}
      rows={items}
      chargeCode={dialog.chargeCode}
      targetKey={dialog.targetKey}
      reasons={reasons}
      onClose={() => setDialog(null)}
      onSaved={(next) => onQuote(next)}
      onStale={() => { void reloadQuote() }}
      onRemove={(option) => removeTarget(option.target, labelOf(option.target))}
    />
  ) : null

  return {
    ui,
    items,
    total: list?.total ?? 0,
    errorsById,
    elements: <>{dialogElement}{ConfirmDialogElement}</>,
  }
}
