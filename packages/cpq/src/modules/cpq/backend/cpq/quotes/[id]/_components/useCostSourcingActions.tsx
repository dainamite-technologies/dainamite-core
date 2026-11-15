'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FullQuoteCost, QuoteCostsResponse } from '../../../../../lib/quoteCostView'
import {
  ANSWER_OUTCOME_FALLBACKS,
  applyConfirmation,
  classifySourcingError,
  isSourcingClosed,
  sourcingErrorFallback,
  sourcingPermissions,
  type SourcingFailure,
} from '../../../../../lib/costSourcingView'
import { AnswerCostDialog } from '../../../cost-requests/_components/AnswerCostDialog'
import { DeclineCostDialog } from '../../../cost-requests/_components/DeclineCostDialog'
import type { SourcingTarget } from '../../../cost-requests/_components/sourcingDialogShared'
import type { CostLineRef, SourcingUi } from './quoteCostsContext'

type DialogState = { kind: 'answer' | 'decline'; target: SourcingTarget }

const json = (body: Record<string, unknown>): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/**
 * Supplier sourcing flows of the quote Costs panel: Request / Re-request / Cancel request, Answer / Decline (the
 * shared dialogs of the Cost requests page) and Reopen and apply supplier answer. Writes that move the quote
 * (request, cancel, apply) send the costs read's `pricingRevision` as `expectedRevision`; the answer and decline
 * routes take the quote lock themselves. Afterwards the costs read and the quote are refreshed.
 */
export function useCostSourcingActions({ quoteId, cpqStatus, convertedOrderId, currency, data, granted, reloadCosts, reloadQuote }: {
  quoteId: string | null
  cpqStatus: string
  convertedOrderId?: string | null
  currency: string
  data: QuoteCostsResponse | null
  granted: readonly string[]
  reloadCosts: () => Promise<void>
  reloadQuote: () => Promise<void>
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const revision = data?.pricingRevision ?? 0
  const permissions = sourcingPermissions(granted)
  const closed = isSourcingClosed(cpqStatus, convertedOrderId)
  const anyPermission = permissions.request || permissions.answer || permissions.apply

  const refresh = React.useCallback(async () => { await Promise.all([reloadCosts(), reloadQuote()]) }, [reloadCosts, reloadQuote])
  const flashFailure = React.useCallback((failure: SourcingFailure) => {
    flash(t(`cpq.costRequests.errors.${failure.code}`, sourcingErrorFallback(failure.code)), 'error')
    if (failure.effect !== 'stay') void refresh()
  }, [t, refresh])

  /** POST to a cost sub-route; flashes the failure, refreshes on success. */
  const post = React.useCallback(async (cost: FullQuoteCost, action: string, body: Record<string, unknown>, successKey: string, successFallback: string) => {
    const call = await apiCall<unknown>(`/api/cpq/quotes/${quoteId}/costs/${cost.id}/${action}`, json(body))
    if (!call.ok) { flashFailure(classifySourcingError(call.status, call.result)); return }
    flash(t(successKey, successFallback), 'success')
    await refresh()
  }, [quoteId, flashFailure, refresh, t])

  const targetOf = (cost: FullQuoteCost, line: CostLineRef): SourcingTarget | null => cost.costRequestId ? {
    quoteId: quoteId as string, costId: cost.id, costRequestId: cost.costRequestId, requestSeq: cost.requestSeq ?? null, costName: cost.name,
    contextLabel: line.lineName, cpqStatus, locked: !['new', 'incomplete', 'ready'].includes(cpqStatus) || Boolean(convertedOrderId),
    defaultCurrency: cost.currencyCode ?? currency, supplierId: cost.requestSupplierId ?? null, supplierName: cost.requestSupplierName ?? null,
  } : null

  const sourcing: SourcingUi | undefined = quoteId && anyPermission ? {
    permissions,
    closed,
    handlers: {
      request: (cost) => void post(cost, 'request', { expectedRevision: revision }, 'cpq.costRequests.flash.requested', 'Cost requested'),
      cancel: (cost) => {
        void (async () => {
          if (!cost.costRequestId) return
          const ok = await confirm({
            title: t('cpq.costRequests.cancelConfirm.title', 'Cancel this cost request?'),
            text: t('cpq.costRequests.cancelConfirm.text', 'The supplier request is closed without an answer. The current cost value stays.'),
            confirmText: t('cpq.costRequests.cancelConfirm.confirm', 'Cancel request'),
            variant: 'destructive',
          })
          if (!ok) return
          await post(cost, 'cancel-request', { costRequestId: cost.costRequestId, expectedRevision: revision }, 'cpq.costRequests.flash.cancelled', 'Cost request cancelled')
        })()
      },
      answer: (cost, line) => { const target = targetOf(cost, line); if (target) setDialog({ kind: 'answer', target }) },
      decline: (cost, line) => { const target = targetOf(cost, line); if (target) setDialog({ kind: 'decline', target }) },
      apply: (cost) => {
        void (async () => {
          const change = applyConfirmation({ unitAmount: cost.unitAmount, currencyCode: cost.currencyCode }, cost.proposedAnswer ?? null)
          const ok = await confirm({
            title: t('cpq.costRequests.applyConfirm.title', 'Reopen and apply supplier answer?'),
            text: [
              t('cpq.costRequests.applyConfirm.text', 'The quote returns to Ready and must be re-sent and re-accepted.'),
              t('cpq.costRequests.applyConfirm.change', 'New cost: {newCost} (was {previousCost}).', { newCost: change.newCost, previousCost: change.previousCost }),
              change.differentCurrency ? t('cpq.costRequests.applyConfirm.converted', 'Converted at the quote\'s rate on apply.') : '',
            ].filter(Boolean).join(' '),
            confirmText: t('cpq.costRequests.applyConfirm.confirm', 'Reopen and apply supplier answer'),
          })
          if (!ok) return
          await post(cost, 'apply-answer', { expectedRevision: revision }, 'cpq.costRequests.flash.applied', 'Supplier answer applied')
        })()
      },
    },
  } : undefined

  const close = () => setDialog(null)
  let element: React.ReactNode = null
  if (dialog) {
    const props = {
      target: dialog.target,
      onClose: close,
      onDone: (outcome?: string) => {
        close()
        const key = dialog.kind === 'decline' ? 'declined' : outcome ?? 'applied'
        flash(
          dialog.kind === 'decline'
            ? t('cpq.costRequests.flash.declined', 'Cost request declined')
            : t(`cpq.costRequests.outcomes.${key}`, ANSWER_OUTCOME_FALLBACKS[key] ?? ANSWER_OUTCOME_FALLBACKS.applied),
          'success',
        )
        void refresh()
      },
      onFailure: (failure: SourcingFailure) => { close(); flashFailure(failure) },
    }
    element = dialog.kind === 'answer' ? <AnswerCostDialog {...props} /> : <DeclineCostDialog {...props} />
  }
  return { sourcing, elements: <>{element}{ConfirmDialogElement}</> }
}
