'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasAnyCosts, marginCardView } from '../../lib/quoteCostView'
import { costChips, hasCostAccess, type CostRow, type FullCostRow, type OrderCostsResponse } from '../../lib/orderInventoryCostView'
import { CostChips } from './CostRowsTable'
import { useCostsRead } from './useCostsRead'

const todayIso = () => new Date().toISOString().slice(0, 10)

/** Compact cost summary of the `order-cpq-tab` widget: status chips for everyone, margin figures for holders. */
export function OrderCostsSummaryView({ response, currency, today }: { response: OrderCostsResponse; currency: string; today: string }) {
  const t = useT()
  const costs: Array<CostRow | FullCostRow> = response.lines.flatMap((line) => line.costs)
  if (!hasAnyCosts(response.lines) && !hasCostAccess(response)) return null
  const view = hasCostAccess(response) && response.margin && costs.length > 0 ? marginCardView(response.margin, response.currencyCode ?? currency) : null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 text-xs" data-testid="cpq-order-costs-summary">
      <CostChips costs={costs} today={today} />
      {view ? (
        <>
          <span><span className="text-muted-foreground">{t('cpq.orderCosts.margin', 'Order margin')} </span><span className="font-mono font-medium" data-testid="cpq-order-summary-margin">{view.contractMargin}</span></span>
          <span><span className="text-muted-foreground">{t('cpq.margin.percent', 'Margin %')} </span><span className="font-mono font-medium">{view.marginPercent}</span></span>
          <span className="text-muted-foreground">{t('cpq.margin.coverage', 'Based on {coverage} coverage', { coverage: view.coverage })}</span>
        </>
      ) : (
        hasCostAccess(response) && <span className="text-muted-foreground">{t('cpq.orderCosts.noCosts', 'No costs')}</span>
      )}
    </div>
  )
}

/** Loads the order costs; nothing while the toggle is off (`404`) or on a load error (the page itself shows errors). */
export function OrderCostsSummary({ orderId, currency }: { orderId: string; currency: string }) {
  const { state, data } = useCostsRead<OrderCostsResponse>(`/api/cpq/orders/${orderId}/costs`)
  if (state !== 'ready' || !data) return null
  return <OrderCostsSummaryView response={data} currency={currency} today={todayIso()} />
}
