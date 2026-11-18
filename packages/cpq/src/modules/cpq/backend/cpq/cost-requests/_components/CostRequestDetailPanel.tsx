'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  CANCEL_REASON_FALLBACKS,
  SOURCING_STATUS_FALLBACKS,
  attributePairs,
  applyConfirmation,
  formatCostAmount,
  historyRows,
  type CostRequestDetail,
} from '../../../../lib/costSourcingView'

/**
 * Lazy detail of one cost request (`GET /api/cpq/cost-requests/{costId}`): line configuration, current value
 * and supplier, note, request history and a pending proposal. Used by the page's row expansion and by the
 * quote Costs panel (read-only for reps). `reloadToken` refetches after a write.
 */
export function CostRequestDetailPanel({ costId, reloadToken = 0 }: { costId: string; reloadToken?: number }) {
  const t = useT()
  const [detail, setDetail] = React.useState<CostRequestDetail | null>(null)
  const [state, setState] = React.useState<'loading' | 'error' | 'notFound' | 'ready'>('loading')

  React.useEffect(() => {
    let cancelled = false
    setState('loading')
    void (async () => {
      const call = await apiCall<CostRequestDetail>(`/api/cpq/cost-requests/${costId}`)
      if (cancelled) return
      if (call.ok && call.result) { setDetail(call.result); setState('ready'); return }
      setState(call.status === 404 ? 'notFound' : 'error')
    })()
    return () => { cancelled = true }
  }, [costId, reloadToken])

  if (state === 'loading') return <LoadingMessage label={t('cpq.costRequests.detail.loading', 'Loading request…')} />
  if (state === 'notFound') {
    return <ErrorMessage label={t('cpq.costRequests.detail.notFound', 'This request no longer exists')} description={t('cpq.costRequests.detail.notFoundHint', 'Its quote may have been deleted.')} />
  }
  if (state === 'error' || !detail) return <ErrorMessage label={t('cpq.costRequests.detail.error', 'Failed to load the request')} />

  const pairs = attributePairs(detail.lineConfiguration)
  const history = historyRows(detail.requestHistory)
  const proposal = detail.proposedAnswer ? applyConfirmation(detail.current, detail.proposedAnswer) : null
  return (
    <div className="space-y-3 py-2 text-xs" data-testid="cpq-cost-request-detail">
      <section>
        <h5 className="pb-1 font-medium">{t('cpq.costRequests.detail.configuration', 'Line configuration')}</h5>
        {pairs.length === 0
          ? <p className="text-muted-foreground">—</p>
          : <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">{pairs.map(([key, value]) => (
              <React.Fragment key={key}><dt className="text-muted-foreground">{key}</dt><dd>{value}</dd></React.Fragment>
            ))}</dl>}
      </section>
      <section>
        <h5 className="pb-1 font-medium">{t('cpq.costRequests.detail.current', 'Current value')}</h5>
        <p>
          <span className="font-mono">{formatCostAmount(detail.current.unitAmount, detail.current.currencyCode)}</span>
          {' · '}{t(`cpq.quoteCosts.statuses.${detail.current.valueStatus}`, detail.current.valueStatus)}
          {detail.current.supplierName ? ` · ${detail.current.supplierName}` : ''}
          {detail.current.supplierQuoteRef ? ` · ${detail.current.supplierQuoteRef}` : ''}
          {detail.current.validUntil ? ` · ${t('cpq.quoteCosts.validUntil', 'Valid until')} ${detail.current.validUntil}` : ''}
        </p>
        <p className="text-muted-foreground">
          {t(`cpq.costRequests.status.${detail.sourcingStatus}`, SOURCING_STATUS_FALLBACKS[detail.sourcingStatus] ?? detail.sourcingStatus)}
          {detail.cancelReason ? ` · ${t(`cpq.costRequests.cancelReasons.${detail.cancelReason}`, CANCEL_REASON_FALLBACKS[detail.cancelReason] ?? detail.cancelReason)}` : ''}
        </p>
      </section>
      {proposal && (
        <section data-testid="cpq-cost-request-proposal">
          <h5 className="pb-1 font-medium">{t('cpq.costRequests.detail.proposal', 'Proposed supplier answer')}</h5>
          <p>
            <span className="font-mono">{proposal.newCost}</span>
            {typeof detail.proposedAnswer?.supplierQuoteRef === 'string' ? ` · ${detail.proposedAnswer.supplierQuoteRef}` : ''}
            {typeof detail.proposedAnswer?.supplierName === 'string' ? ` · ${detail.proposedAnswer.supplierName}` : ''}
          </p>
        </section>
      )}
      {detail.note && (
        <section>
          <h5 className="pb-1 font-medium">{t('cpq.costRequests.detail.note', 'Note')}</h5>
          <p className="whitespace-pre-wrap">{detail.note}</p>
        </section>
      )}
      <section>
        <h5 className="pb-1 font-medium">{t('cpq.costRequests.detail.history', 'Request history')}</h5>
        {history.length === 0
          ? <p className="text-muted-foreground">{t('cpq.costRequests.detail.noHistory', 'No closed requests yet.')}</p>
          : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-medium">{t('cpq.costRequests.detail.seq', 'Request')}</th>
                  <th className="font-medium">{t('cpq.costRequests.detail.requestedClosed', 'Requested → closed')}</th>
                  <th className="font-medium">{t('cpq.costRequests.detail.outcome', 'Outcome')}</th>
                  <th className="font-medium">{t('cpq.costRequests.detail.reason', 'Reason')}</th>
                  <th className="font-medium">{t('cpq.costRequests.detail.ref', 'Supplier ref')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, index) => (
                  <tr key={`${row.seq}-${index}`} className="border-t border-dashed border-border/50">
                    <td>{row.seq}</td>
                    <td>{row.requested} → {row.closed}</td>
                    <td>{t(`cpq.costRequests.status.${row.outcome}`, SOURCING_STATUS_FALLBACKS[row.outcome] ?? row.outcome)}</td>
                    <td>{CANCEL_REASON_FALLBACKS[row.reason] ? t(`cpq.costRequests.cancelReasons.${row.reason}`, CANCEL_REASON_FALLBACKS[row.reason]) : row.reason}</td>
                    <td>{row.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  )
}
