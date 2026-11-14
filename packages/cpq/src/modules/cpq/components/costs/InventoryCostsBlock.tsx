'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  assetMarginView,
  itemMarginView,
  noCostRecorded,
  type CostRow,
  type FullCostRow,
} from '../../lib/orderInventoryCostView'
import type { AssetMargin, ItemMargin } from '../../services/costs/itemMargin'
import { CostChips, CostRowsTable } from './CostRowsTable'

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-medium" data-testid={testId}>{value}</dd>
    </div>
  )
}

/** Item margin (recurring and at-activation figures) or the subscription roll-up, `cpq.costs.view` holders only. */
export function ItemMarginFigures({ margin, currency, title, testId }: { margin: ItemMargin; currency: string; title: string; testId: string }) {
  const t = useT()
  const view = itemMarginView(margin, currency)
  return (
    <section className="rounded-md border bg-card p-3" data-testid={testId} aria-label={title}>
      <h4 className="text-xs font-medium">{title}</h4>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label={t('cpq.inventoryCosts.mrcMargin', 'MRC margin')} value={view.mrcMargin} testId={`${testId}-mrc`} />
        <Figure label={t('cpq.margin.percent', 'Margin %')} value={view.mrcMarginPercent} testId={`${testId}-percent`} />
        <Figure label={t('cpq.inventoryCosts.nrcMargin', 'NRC margin (at activation)')} value={view.nrcMargin} testId={`${testId}-nrc`} />
        <Figure label={t('cpq.margin.coverageLabel', 'Coverage')} value={view.coverage} testId={`${testId}-coverage`} />
      </dl>
    </section>
  )
}

/** Asset margin: an NRC margin; a recurring cost is shown as a cost with "no recurring revenue on this asset". */
export function AssetMarginFigures({ margin, currency, testId }: { margin: AssetMargin; currency: string; testId: string }) {
  const t = useT()
  const view = assetMarginView(margin, currency)
  const title = t('cpq.inventoryCosts.assetMargin', 'Asset margin')
  return (
    <section className="rounded-md border bg-card p-3" data-testid={testId} aria-label={title}>
      <h4 className="text-xs font-medium">{title}</h4>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        <Figure label={t('cpq.inventoryCosts.nrcMargin', 'NRC margin (at activation)')} value={view.nrcMargin} testId={`${testId}-nrc`} />
        {view.hasRecurringCost && (
          <Figure label={t('cpq.inventoryCosts.recurringCost', 'Recurring cost')} value={view.recurringCost} testId={`${testId}-recurring`} />
        )}
      </dl>
      {view.hasRecurringCost && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid={`${testId}-no-revenue`}>
          {t('cpq.inventoryCosts.noRecurringRevenue', 'No recurring revenue on this asset')}
        </p>
      )}
    </section>
  )
}

/**
 * The costs of one owner (a subscription item or an asset): status chips for everyone, the cost rows, "No cost
 * recorded" when it has none, and (holders) the margin passed as `margin`.
 */
export function InventoryCostsBlock({ costs, currency, today, margin, emptyText }: {
  costs: ReadonlyArray<CostRow | FullCostRow> | undefined
  currency: string
  today: string
  margin?: React.ReactNode
  emptyText?: string
}) {
  const t = useT()
  const list = costs ?? []
  return (
    <div className="space-y-2" data-testid="cpq-inventory-costs">
      <CostChips costs={list} today={today} />
      {noCostRecorded(list) ? (
        <p className="text-xs text-muted-foreground" data-testid="cpq-inventory-no-cost">{emptyText ?? t('cpq.inventoryCosts.noCostRecorded', 'No cost recorded')}</p>
      ) : (
        <CostRowsTable costs={list} currency={currency} today={today} />
      )}
      {margin}
    </div>
  )
}
