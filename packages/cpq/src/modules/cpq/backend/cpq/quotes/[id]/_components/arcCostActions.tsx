'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { REFRESH_CONFIRM_FALLBACK, canKeepCurrent, canRefreshFromSubscription } from '../../../../../lib/arcCostView'
import { costErrorCode, costErrorFallback, type FullQuoteCost, type QuoteCostsResponse, type RedactedQuoteCost } from '../../../../../lib/quoteCostView'
import { KeepCurrentCostDialog } from './KeepCurrentCostDialog'
import type { CostLineRef } from './quoteCostsContext'

type RefreshableLine = { action?: string | null; configuration?: Record<string, unknown> | null; targetSubscriptionId?: string | null }

/** ARC cost actions: Keep current cost on a cost row and Refresh from subscription on a line. Visibility is `lib/arcCostView`'s decision. */
export type ArcCostActionsUi = {
  quoteType: string
  keepCurrentVisible: (cost: RedactedQuoteCost | FullQuoteCost) => boolean
  keepCurrent: (cost: FullQuoteCost, line: CostLineRef) => void
  refreshVisible: (line: RefreshableLine, removed: boolean) => boolean
  /** Resolves true when the line was refreshed. */
  refresh: (line: CostLineRef) => Promise<boolean>
}

const Context = React.createContext<ArcCostActionsUi | null>(null)
export const ArcCostActionsProvider = Context.Provider
export const useArcCostActionsUi = () => React.useContext(Context)

/**
 * Owns the ARC cost write flows of the quote page: Keep current cost (`PATCH /costs/{id}` with `keepCurrent`, via its dialog) and
 * Refresh from subscription (`POST /items/{lineId}/refresh-from-subscription` after a confirmation). Both send the pricing revision
 * of the last costs read as `expectedRevision`; `STALE_REVISION` reads "Quote changed, reload". Afterwards the costs read and the quote reload.
 */
export function useArcCostActions({ quoteId, quoteType, cpqStatus, convertedOrderId, granted, canManageCosts, data, newTermEndFor, reloadCosts, reloadQuote }: {
  quoteId: string | null
  quoteType: string
  cpqStatus: string
  convertedOrderId?: string | null
  granted: readonly string[]
  canManageCosts: boolean
  data: QuoteCostsResponse | null
  /** The new term end of the target subscription a line acts on (Renew), or null. */
  newTermEndFor: (lineId: string) => string | null
  reloadCosts: () => Promise<void>
  reloadQuote: () => Promise<void>
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [keeping, setKeeping] = React.useState<{ cost: FullQuoteCost; line: CostLineRef } | null>(null)
  const revision = data?.pricingRevision
  const refreshAll = React.useCallback(async () => { await Promise.all([reloadCosts(), reloadQuote()]) }, [reloadCosts, reloadQuote])

  const flashCode = React.useCallback((code: string) => {
    flash(code === 'STALE_REVISION' ? t('cpq.arc.staleRevision', 'Quote changed, reload') : t(`cpq.quoteCosts.errors.${code}`, costErrorFallback(code)), 'error')
    if (code === 'STALE_REVISION') void refreshAll()
  }, [t, refreshAll])

  const refresh = React.useCallback(async (line: CostLineRef): Promise<boolean> => {
    if (!quoteId) return false
    const ok = await confirm({
      title: t('cpq.arc.refresh.confirmTitle', 'Refresh {name} from the subscription?', { name: line.lineName }),
      text: t('cpq.arc.refresh.confirmText', REFRESH_CONFIRM_FALLBACK),
      confirmText: t('cpq.arc.refresh.confirm', 'Refresh'),
      variant: 'destructive',
    })
    if (!ok) return false
    const call = await apiCall<unknown>(`/api/cpq/quotes/${quoteId}/items/${line.lineId}/refresh-from-subscription`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(revision === undefined ? {} : { expectedRevision: revision }),
    })
    if (!call.ok) { flashCode(costErrorCode(call.status, call.result)); return false }
    flash(t('cpq.arc.refresh.done', 'Line refreshed from the subscription'), 'success')
    await refreshAll()
    return true
  }, [quoteId, confirm, t, revision, flashCode, refreshAll])

  const ui = React.useMemo<ArcCostActionsUi>(() => ({
    quoteType,
    keepCurrentVisible: (cost) => canKeepCurrent(cost, { canManage: canManageCosts, cpqStatus, convertedOrderId }),
    keepCurrent: (cost, line) => setKeeping({ cost, line }),
    refreshVisible: (line, removed) => canRefreshFromSubscription(quoteType, line, { granted, cpqStatus, convertedOrderId, removed }),
    refresh,
  }), [quoteType, canManageCosts, cpqStatus, convertedOrderId, granted, refresh])

  let element: React.ReactNode = null
  if (quoteId && keeping) {
    const { cost, line } = keeping
    element = (
      <KeepCurrentCostDialog
        cost={cost} lineName={line.lineName} newTermEnd={newTermEndFor(line.lineId)} revision={revision ?? 0}
        onClose={() => setKeeping(null)} onReload={() => { setKeeping(null); void refreshAll() }}
        onSubmit={async (body) => {
          const call = await apiCall<unknown>(`/api/cpq/quotes/${quoteId}/costs/${cost.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          if (call.ok) { setKeeping(null); flash(t('cpq.arc.keepCurrent.done', 'Cost kept'), 'success'); await refreshAll(); return null }
          return costErrorCode(call.status, call.result)
        }}
      />
    )
  }
  return { ui, elements: <>{element}{ConfirmDialogElement}</> }
}
