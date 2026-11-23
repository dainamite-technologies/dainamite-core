'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { costErrorCode, costErrorFallback, markupClearQuery, type FullQuoteCost, type QuoteCostsResponse } from '../../../../../lib/quoteCostView'
import { CostDialog } from './CostDialog'
import { MarkupOverrideDialog } from './MarkupOverrideDialog'
import type { ChargeOption, CostDialogMode } from './CostFormBody'
import type { CostActions, CostLineRef } from './quoteCostsContext'

type DialogState =
  | { kind: 'cost'; mode: CostDialogMode; line: CostLineRef; cost: FullQuoteCost | null }
  | { kind: 'markup'; line: CostLineRef }

/**
 * Owns the cost write flows of the quote page: Add / Edit / Confirm / Delete a
 * cost and Override / clear a markup. Every write sends the `pricingRevision`
 * of the last costs read as `expectedRevision`; afterwards the costs read
 * (with margin) and the quote are refreshed.
 */
export function useCostActions({ quoteId, currency, data, canManage, chargesFor, reloadCosts, reloadQuote }: {
  quoteId: string | null
  currency: string
  data: QuoteCostsResponse | null
  canManage: boolean
  chargesFor: (lineId: string) => ChargeOption[]
  reloadCosts: () => Promise<void>
  reloadQuote: () => Promise<void>
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const revision = data?.pricingRevision ?? 0

  const refresh = React.useCallback(async () => { await Promise.all([reloadCosts(), reloadQuote()]) }, [reloadCosts, reloadQuote])

  /** Runs a write; returns an error code or null. */
  const write = React.useCallback(async (url: string, init: RequestInit): Promise<string | null> => {
    const call = await apiCall<unknown>(url, init)
    if (call.ok) { await refresh(); return null }
    return costErrorCode(call.status, call.result)
  }, [refresh])
  const json = (method: string, body: Record<string, unknown>): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const flashError = React.useCallback((code: string) => {
    flash(t(`cpq.quoteCosts.errors.${code}`, costErrorFallback(code)), 'error')
    if (code === 'STALE_REVISION') void refresh()
  }, [t, refresh])

  const actions: CostActions | undefined = canManage && quoteId ? {
    add: (line) => setDialog({ kind: 'cost', mode: 'add', line, cost: null }),
    edit: (cost, line) => setDialog({ kind: 'cost', mode: 'edit', line, cost }),
    confirm: (cost, line) => setDialog({ kind: 'cost', mode: 'confirm', line, cost }),
    overrideMarkup: (line) => setDialog({ kind: 'markup', line }),
    remove: (cost) => {
      void (async () => {
        const ok = await confirm({
          title: t('cpq.quoteCosts.deleteConfirm.title', 'Delete this cost?'),
          text: t('cpq.quoteCosts.deleteConfirm.text', 'The cost is removed and the margin is recalculated.'),
          confirmText: t('cpq.quoteCosts.deleteConfirm.confirm', 'Delete'),
          variant: 'destructive',
        })
        if (!ok) return
        const code = await write(`/api/cpq/quotes/${quoteId}/costs/${cost.id}?expectedRevision=${revision}`, { method: 'DELETE' })
        if (code) flashError(code)
      })()
    },
  } : undefined

  const close = () => setDialog(null)
  const onReload = () => { close(); void refresh() }
  let element: React.ReactNode = null
  if (quoteId && dialog?.kind === 'cost') {
    const { mode, line, cost } = dialog
    element = (
      <CostDialog
        mode={mode} quoteLineId={line.lineId} lineName={line.lineName} currency={currency} revision={revision} existing={cost}
        charges={chargesFor(line.lineId)} onClose={close} onReload={onReload}
        onSubmit={async (body) => {
          const code = await write(
            cost ? `/api/cpq/quotes/${quoteId}/costs/${cost.id}` : `/api/cpq/quotes/${quoteId}/costs`,
            json(cost ? 'PATCH' : 'POST', body),
          )
          if (!code) close()
          return code
        }}
      />
    )
  } else if (quoteId && dialog?.kind === 'markup') {
    const { line } = dialog
    element = (
      <MarkupOverrideDialog
        quoteLineId={line.lineId} lineName={line.lineName} revision={revision}
        charges={chargesFor(line.lineId).filter((charge) => charge.pricingMethod === 'cost_plus')}
        overrides={(data?.markupOverrides ?? []).filter((override) => override.quoteLineId === line.lineId)}
        onClose={close} onReload={onReload}
        onSubmit={async (body) => {
          const code = await write(`/api/cpq/quotes/${quoteId}/markup-overrides`, json('PUT', body))
          if (!code) close()
          return code
        }}
        onClear={async (chargeCode) => {
          const code = await write(`/api/cpq/quotes/${quoteId}/markup-overrides?${markupClearQuery(line.lineId, chargeCode, revision)}`, { method: 'DELETE' })
          if (!code) close()
          return code
        }}
      />
    )
  }

  return { actions, elements: <>{element}{ConfirmDialogElement}</> }
}
