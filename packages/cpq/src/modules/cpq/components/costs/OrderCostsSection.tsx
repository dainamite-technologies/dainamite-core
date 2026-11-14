'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasAnyCosts } from '../../lib/quoteCostView'
import {
  costsByOrderLine,
  hasCostAccess,
  type OrderCostsResponse,
} from '../../lib/orderInventoryCostView'
import { MarginCard } from '../../backend/cpq/quotes/[id]/_components/MarginCard'
import { CostChips, CostRowsTable } from './CostRowsTable'

export type OrderCostLine = { lineId: string; name: string; isBundle?: boolean }

/**
 * Order costs (read-only): status chips per costed line for everyone, and for `cpq.costs.view` holders the Costs
 * table per line, "No costs" for an uncosted line and the Order margin card. `response` is the server projection
 * of `GET /api/cpq/orders/{id}/costs`; the caller renders nothing on a 404 (toggle off). `assetLinks` maps an order
 * line to the asset that owns its costs once activated.
 */
export function OrderCostsSection({ response, lines, currency, assetLinks, today }: {
  response: OrderCostsResponse
  lines: ReadonlyArray<OrderCostLine>
  currency: string
  assetLinks?: ReadonlyMap<string, string>
  today: string
}) {
  const t = useT()
  const holder = hasCostAccess(response)
  const byLine = costsByOrderLine(response)
  const shown = holder ? lines : lines.filter((line) => (byLine.get(line.lineId) ?? []).length > 0)
  const bundleParents = lines.filter((line) => line.isBundle).map((line) => ({ lineId: line.lineId, name: line.name }))
  return (
    <div className="space-y-3" data-testid="cpq-order-costs">
      {holder && (
        <MarginCard
          margin={response.margin}
          hasCosts={hasAnyCosts(response.lines)}
          currency={response.currencyCode ?? currency}
          bundleParents={bundleParents}
          title={t('cpq.orderCosts.margin', 'Order margin')}
          emptyText={t('cpq.orderCosts.marginEmpty', 'No costs on this order. Margin is tracked once a line carries costs.')}
        />
      )}
      {shown.length > 0 && (
        <section className="rounded-lg border bg-card" aria-label={t('cpq.orderCosts.title', 'Costs')}>
          <h3 className="border-b px-4 py-2 text-sm font-medium">{t('cpq.orderCosts.title', 'Costs')}</h3>
          <div className="divide-y">
            {shown.map((line) => {
              const costs = byLine.get(line.lineId) ?? []
              const assetId = assetLinks?.get(line.lineId)
              return (
                <div key={line.lineId} className="px-4 py-2" data-testid="cpq-order-line-costs">
                  <div className="flex flex-wrap items-center gap-2 pb-1">
                    <span className="text-sm font-medium">{line.name}</span>
                    <CostChips costs={costs} today={today} />
                    {assetId && (
                      <a className="text-xs text-primary hover:underline" href={`/backend/cpq/inventory/assets/${assetId}`} data-testid="cpq-order-asset-link">
                        {t('cpq.orderCosts.openAsset', 'Open asset')}
                      </a>
                    )}
                  </div>
                  {costs.length === 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="cpq-order-line-no-costs">{t('cpq.orderCosts.noCosts', 'No costs')}</p>
                  ) : (
                    <CostRowsTable costs={costs} currency={currency} today={today} />
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
