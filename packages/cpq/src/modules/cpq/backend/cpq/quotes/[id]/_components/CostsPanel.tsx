'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import {
  COST_ROLE_FALLBACKS,
  COST_SOURCE_FALLBACKS,
  COST_STATUS_FALLBACKS,
  costErrorFallback,
  isFullCost,
  type FullQuoteCost,
  type RedactedQuoteCost,
} from '../../../../../lib/quoteCostView'
import { ARC_COST_BADGE_FALLBACKS, previousParts } from '../../../../../lib/arcCostView'
import { FxNote } from '../../../../../components/FxNote'
import { costErrorText, formatConverted, fxTooltip } from '../../../../../lib/fxView'
import { hasIndexNoValue, indexLockHint, indexSnapshotLine, indexSnapshotTooltip, INDEX_NO_VALUE_FALLBACK, readIndexSnapshot, type IndexLabel } from '../../../../../lib/indexView'
import { SOURCING_STATUS_FALLBACKS, SOURCING_STATUS_VARIANTS } from '../../../../../lib/costSourcingView'
import { CostRequestDetailPanel } from '../../../cost-requests/_components/CostRequestDetailPanel'

export const QUOTE_LINE_COSTS_SPOT_ID = 'data-table:cpq.quote_line_costs'

const STATUS_VARIANTS: Record<string, 'warning' | 'info' | 'success'> = { none: 'warning', estimated: 'info', confirmed: 'success' }

/** Rendered per cost row in the actions column (step 20 supplies Edit / Confirm / Delete). */
export type CostRowActions = (cost: FullQuoteCost) => React.ReactNode

function QuoteCostConverted({ cost, locked }: { cost: FullQuoteCost; locked: boolean }) {
  const t = useT()
  const line = formatConverted(cost, null, t)
  return line ? <FxNote text={line.text} tooltip={fxTooltip(cost, { locked }, t)} /> : null
}

/** Index cost: the snapshot line (index, value, date, revision, formula) and, while the quote is locked, the freeze hint. */
function QuoteCostIndexNote({ cost, locked, labels }: { cost: FullQuoteCost; locked: boolean; labels: Readonly<Record<string, IndexLabel>> }) {
  const t = useT()
  const snapshot = readIndexSnapshot(cost.indexSnapshot)
  if (!snapshot) return null
  return (
    <SimpleTooltip content={indexSnapshotTooltip(snapshot, { locked }, t)} size="sm">
      <span className="cursor-help" tabIndex={0} aria-label={indexSnapshotTooltip(snapshot, { locked }, t)}>
        <span className="block font-sans text-xs font-normal text-muted-foreground" data-testid="cpq-cost-index-snapshot">{indexSnapshotLine(snapshot, labels[snapshot.indexId], t)}</span>
        {locked && (
          <span className="inline-flex items-center gap-1 font-sans text-xs font-normal text-muted-foreground" data-testid="cpq-cost-index-frozen">
            <Lock className="h-3 w-3" aria-hidden />
            {indexLockHint(t)}
          </span>
        )}
      </span>
    </SimpleTooltip>
  )
}

/**
 * Index code and unit by index id, for the snapshot line (the snapshot only carries the id). Fetched once, and only when a
 * row has a snapshot; a failure (the viewer may lack `cpq.pricing.view`, or cost-plus is off) just leaves the labels out.
 */
function useIndexLabels(enabled: boolean, given?: Readonly<Record<string, IndexLabel>>): Readonly<Record<string, IndexLabel>> {
  const [fetched, setFetched] = React.useState<Record<string, IndexLabel>>({})
  React.useEffect(() => {
    if (!enabled || given) return
    let cancelled = false
    void (async () => {
      const call = await apiCall<{ items?: Array<{ id: string; code: string; unit: string }> }>('/api/cpq/cost-indices?pageSize=100')
      if (cancelled || !call.ok) return
      setFetched(Object.fromEntries((call.result?.items ?? []).map((item) => [item.id, { code: item.code, unit: item.unit }])))
    })()
    return () => { cancelled = true }
  }, [enabled, given])
  return given ?? fetched
}

export function CostsPanel({ quoteId, lineId, lineName, costs, locked, status, canManage, renderRowActions, headerActions, frozen, dropped, indexLabels }: {
  quoteId: string
  lineId: string
  lineName: string
  costs: Array<RedactedQuoteCost | FullQuoteCost>
  locked: boolean
  status: string
  canManage: boolean
  renderRowActions?: CostRowActions
  headerActions?: React.ReactNode
  /** ARC: the line keeps the subscription's contracted price (shows the lock hint). */
  frozen?: boolean
  /** ARC Renew, `cpq.costs.view` only: item costs the renewal no longer carries. */
  dropped?: ReadonlyArray<{ inventoryCostId: string; name: string }>
  /** Index code and unit by index id (the snapshot line names the index); loaded from the index list when absent. */
  indexLabels?: Readonly<Record<string, IndexLabel>>
}) {
  const t = useT()
  const rows = costs.filter(isFullCost)
  const labels = useIndexLabels(rows.some((cost) => readIndexSnapshot(cost.indexSnapshot) !== null), indexLabels)
  // Request detail (history, supplier answer, proposal) opens inline; read-only for every cost viewer.
  const [openDetails, setOpenDetails] = React.useState<ReadonlySet<string>>(new Set())
  const toggleDetail = (id: string) => setOpenDetails((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const columnCount = 8 + (renderRowActions ? 1 : 0)
  const lockedText = t(
    'cpq.quoteCosts.locked',
    'Costs that change the price are locked in status {status} — margin-only costs and confirmations remain possible.',
    { status },
  )
  return (
    <div className="border-t bg-muted/5 px-12 py-2" data-testid="cpq-costs-panel">
      <div className="flex items-center justify-between pb-1">
        <h4 className="text-xs font-medium">
          {t('cpq.quoteCosts.title', 'Costs')}
          <span className="ml-2 text-muted-foreground">{rows.length}</span>
          {!canManage && (
            <span className="ml-2 font-normal text-muted-foreground" data-testid="cpq-costs-readonly">{t('cpq.quoteCosts.readOnly', 'read-only')}</span>
          )}
        </h4>
        <div className="flex items-center gap-2">
          {locked && (
            <SimpleTooltip content={lockedText} size="sm">
              <span className="inline-flex cursor-help items-center gap-1 text-xs text-muted-foreground" tabIndex={0} aria-label={lockedText} data-testid="cpq-costs-locked">
                <Lock className="h-3 w-3" aria-hidden />
                {t('cpq.quoteCosts.lockedShort', 'Locked in {status}', { status })}
              </span>
            </SimpleTooltip>
          )}
          {headerActions}
        </div>
      </div>
      {frozen && (
        <p className="pb-1 text-xs text-muted-foreground" data-testid="cpq-costs-frozen-hint">
          {t('cpq.arc.costs.frozenHint', 'Price locked — cost changes move margin only')}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground" data-testid="cpq-costs-empty">
          {t('cpq.quoteCosts.empty', 'No costs on this line. Margin is not tracked for it.')}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.name', 'Name')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.role', 'Role')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.source', 'Source')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.status', 'Status')}</th>
              <th className="py-1 text-right font-medium">{t('cpq.quoteCosts.value', 'Value')}</th>
              <th className="py-1 pl-2 text-left font-medium">{t('cpq.quoteCosts.currency', 'Currency')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.supplier', 'Supplier')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.validUntil', 'Valid until')}</th>
              {renderRowActions && <th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((cost) => {
              const source = cost.origin === 'manual' ? 'manual' : cost.source
              const sourcingStatus = cost.sourcingStatus ?? 'not_requested'
              const hasRequest = sourcingStatus !== 'not_requested'
              const detailOpen = hasRequest && openDetails.has(cost.id)
              return (
                <React.Fragment key={cost.id}>
                  <tr className="border-t border-dashed border-border/50" data-testid="cpq-cost-row">
                    <td className="py-1 font-medium">
                      {hasRequest && (
                        <IconButton variant="ghost" size="xs" className="mr-1 align-middle" aria-expanded={detailOpen}
                          aria-label={t('cpq.quoteCosts.requestDetails', 'Request details')} title={t('cpq.quoteCosts.requestDetails', 'Request details')}
                          onClick={() => toggleDetail(cost.id)} data-testid="cpq-cost-request-toggle">
                          {detailOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </IconButton>
                      )}
                      {cost.name}
                      {cost.chargeCode && <span className="ml-1 font-mono font-normal text-muted-foreground">{cost.chargeCode}</span>}
                    </td>
                    <td className="py-1">{t(`cpq.quoteCosts.roles.${cost.role}`, COST_ROLE_FALLBACKS[cost.role] ?? cost.role)}</td>
                    <td className="py-1">{t(`cpq.quoteCosts.sources.${source}`, COST_SOURCE_FALLBACKS[source] ?? source)}</td>
                    <td className="py-1">
                      <Tag variant={STATUS_VARIANTS[cost.valueStatus] ?? 'neutral'} className="px-1.5 text-xs">
                        {t(`cpq.quoteCosts.statuses.${cost.valueStatus}`, COST_STATUS_FALLBACKS[cost.valueStatus] ?? cost.valueStatus)}
                      </Tag>
                      {cost.expired && (
                        <Tag variant="error" className="ml-1 px-1.5 text-xs">{t('cpq.quoteCosts.badges.expired', 'Expired cost')}</Tag>
                      )}
                      {hasRequest && (
                        <Tag variant={SOURCING_STATUS_VARIANTS[sourcingStatus] ?? 'neutral'} className="ml-1 px-1.5 text-xs" data-testid="cpq-cost-sourcing-status">
                          {t(`cpq.costRequests.status.${sourcingStatus}`, SOURCING_STATUS_FALLBACKS[sourcingStatus] ?? sourcingStatus)}
                          {cost.requestSeq ? ` #${cost.requestSeq}` : ''}
                        </Tag>
                      )}
                      {cost.origin === 'carried' && (
                        <Tag variant="neutral" className="ml-1 px-1.5 text-xs" data-testid="cpq-cost-carried">{t('cpq.quoteCosts.badges.carried', ARC_COST_BADGE_FALLBACKS.carried)}</Tag>
                      )}
                      {cost.renegotiationDue && (
                        <Tag variant="warning" className="ml-1 px-1.5 text-xs" data-testid="cpq-cost-renegotiation-due">{t('cpq.quoteCosts.badges.renegotiationDue', ARC_COST_BADGE_FALLBACKS.renegotiationDue)}</Tag>
                      )}
                      {(() => {
                        const parts = previousParts(cost)
                        if (!parts) return null
                        return (
                          <span className="mt-0.5 block text-muted-foreground" data-testid="cpq-cost-was">
                            {[t('cpq.arc.costs.was', 'Was {value}', { value: parts.value }), parts.supplierName, parts.termEnd ? t('cpq.arc.costs.termTo', 'term to {date}', { date: parts.termEnd }) : null].filter(Boolean).join(' · ')}
                          </span>
                        )
                      })()}
                      {hasIndexNoValue(cost) && (
                        <Tag variant="warning" className="ml-1 px-1.5 text-xs" data-testid="cpq-cost-index-no-value">{t('cpq.quoteCosts.badges.indexNoValue', INDEX_NO_VALUE_FALLBACK)}</Tag>
                      )}
                      {cost.error && !hasIndexNoValue(cost) && <span className="ml-1 text-destructive" data-testid="cpq-cost-error">{costErrorText(cost, t, costErrorFallback)}</span>}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {cost.unitAmount ?? '—'}
                      <QuoteCostConverted cost={cost} locked={locked} />
                      <QuoteCostIndexNote cost={cost} locked={locked} labels={labels} />
                    </td>
                    <td className="py-1 pl-2">{cost.currencyCode ?? '—'}</td>
                    <td className="py-1">{cost.supplierName ?? '—'}</td>
                    <td className="py-1">{cost.validUntil ?? '—'}</td>
                    {renderRowActions && <td className="py-1 text-right whitespace-nowrap">{renderRowActions(cost)}</td>}
                  </tr>
                  {detailOpen && (
                    <tr data-testid="cpq-cost-request-detail-row">
                      <td colSpan={columnCount} className="bg-muted/10 px-2">
                        <CostRequestDetailPanel key={`${cost.id}:${sourcingStatus}:${cost.requestSeq ?? ''}:${cost.hasAnswerPending ?? false}`} costId={cost.id} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {dropped && dropped.length > 0 && (
        <div className="pt-2 text-xs" data-testid="cpq-costs-dropped">
          <h5 className="font-medium">{t('cpq.arc.costs.dropped', 'Dropped at renewal')}</h5>
          <ul className="text-muted-foreground">
            {dropped.map((item) => <li key={item.inventoryCostId}>{item.name}</li>)}
          </ul>
        </div>
      )}
      <InjectionSpot spotId={QUOTE_LINE_COSTS_SPOT_ID} context={{ quoteId, lineId, lineName, costs: rows }} />
    </div>
  )
}
