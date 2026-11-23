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
  type AdjustmentTarget,
} from '../../../../../lib/priceAdjustmentView'
import { PriceAdjustmentDialog, type AdjustmentReason, type ExistingAdjustment } from './PriceAdjustmentDialog'
import type { AdjustableCharge, AdjustableLine, PriceAdjustmentUi } from './priceAdjustmentContext'
import type { StoredAdjustment } from './PriceAdjustmentsPanel'

type ControllerQuote = {
  id: string
  cpqStatus: string
  currencyCode: string
  convertedOrderId: string | null
  pricingRevision?: number
  adjustmentErrors?: Array<{ adjustmentId: string; code: string }>
  lines: Array<AdjustableLine & { mrcTotal: number; nrcTotal: number; charges: Array<MaybeUnpricedCharge> }>
}

/** A resolved charge; `unitPrice` is null for an unpriced cost-plus charge, which cannot be adjusted. */
type MaybeUnpricedCharge = Omit<AdjustableCharge, 'unitPrice'> & { unitPrice: number | null }
const isPriced = (charge: MaybeUnpricedCharge | undefined): charge is AdjustableCharge => charge !== undefined && charge.unitPrice !== null

type ListResponse = {
  items: StoredAdjustment[]
  total: number
  pricingRevision: number
  enabled: boolean
  reasons?: AdjustmentReason[]
}

type DialogState = {
  target: AdjustmentTarget
  targetLabel: string
  charge?: AdjustableCharge
  existing?: ExistingAdjustment | null
}

/**
 * Owns negotiated-price state for the quote page: the adjustment list,
 * reason options, the dialog and delete confirmation. Every write returns the
 * repriced quote, which is handed back through `onQuote`.
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

  const remove = React.useCallback(async (adjustmentId: string) => {
    if (!quoteId) return
    const ok = await confirm({
      title: t('cpq.priceAdjustments.deleteConfirm.title', 'Remove this price adjustment?'),
      text: t('cpq.priceAdjustments.deleteConfirm.text', 'The charge goes back to its standard price.'),
      confirmText: t('cpq.priceAdjustments.deleteConfirm.confirm', 'Remove'),
      variant: 'destructive',
    })
    if (!ok) return
    const call = await apiCall<{ quote: Q }>(`/api/cpq/quotes/${quoteId}/price-adjustments/${adjustmentId}?expectedRevision=${revision}`, { method: 'DELETE' })
    if (call.ok && call.result?.quote) { onQuote(call.result.quote); return }
    const code = adjustmentErrorCode(call.status, call.result)
    flash(t(`cpq.priceAdjustments.errors.${code}`, ADJUSTMENT_ERROR_FALLBACKS[code] ?? code), 'error')
    if (code === 'STALE_REVISION') await reloadQuote()
  }, [quoteId, revision, confirm, t, onQuote, reloadQuote])

  const ui: PriceAdjustmentUi = {
    access,
    quoteType,
    cpqStatus: accessInput.cpqStatus,
    reasonLabels,
    invalidIds: new Set(errorsById.keys()),
    canDeleteInvalid: canDeleteInvalidAdjustment(accessInput),
    openCharge: (line, charge) => {
      const existing = list?.items.find((item) => item.level === 'charge' && item.quoteLineId === line.lineId && item.chargeCode === charge.chargeCode)
      setDialog({
        target: { level: 'charge', quoteLineId: line.lineId, chargeCode: charge.chargeCode },
        targetLabel: `${line.offeringName} · ${charge.chargeName}`,
        charge,
        existing: existing ?? null,
      })
    },
    openLine: (line) => {
      const existing = list?.items.find((item) => item.level === 'line' && item.quoteLineId === line.lineId)
      setDialog({ target: { level: 'line', quoteLineId: line.lineId }, targetLabel: line.offeringName, existing: existing ?? null })
    },
    edit: (adjustmentId) => {
      const item = list?.items.find((entry) => entry.id === adjustmentId)
      const line = quote?.lines.find((entry) => entry.lineId === item?.quoteLineId)
      if (!item || !line) return
      const found = item.chargeCode ? line.charges.find((entry) => entry.chargeCode === item.chargeCode) : undefined
      const charge = isPriced(found) ? found : undefined
      setDialog({
        target: item.level === 'charge' && item.chargeCode
          ? { level: 'charge', quoteLineId: item.quoteLineId, chargeCode: item.chargeCode }
          : { level: 'line', quoteLineId: item.quoteLineId },
        targetLabel: charge ? `${line.offeringName} · ${charge.chargeName}` : line.offeringName,
        charge,
        existing: item,
      })
    },
    remove: (adjustmentId) => { void remove(adjustmentId) },
  }

  const dialogElement = quote && dialog ? (
    <PriceAdjustmentDialog<Q>
      open
      quoteId={quote.id}
      currency={quote.currencyCode}
      pricingRevision={revision}
      target={dialog.target}
      targetLabel={dialog.targetLabel}
      charge={dialog.charge}
      existing={dialog.existing}
      storedAdjustmentIds={list?.items.map((item) => item.id) ?? []}
      reasons={reasons}
      onClose={() => setDialog(null)}
      onSaved={(next) => onQuote(next)}
      onStale={() => { void reloadQuote() }}
    />
  ) : null

  return {
    ui,
    items: list?.items ?? [],
    total: list?.total ?? 0,
    errorsById,
    elements: <>{dialogElement}{ConfirmDialogElement}</>,
  }
}
