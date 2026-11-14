'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  COST_BADGE_FALLBACKS,
  bundleRollupRows,
  marginCardView,
  type CostBadge,
  type QuoteMargin,
} from '../../../../../lib/quoteCostView'

const VARIANTS: Record<CostBadge, 'warning' | 'info' | 'error'> = { pending: 'warning', estimated: 'info', expired: 'error' }

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-medium" data-testid={testId}>{value}</dd>
    </div>
  )
}

/**
 * Quote margin (cost-plus). Rendered only for `cpq.costs.view` holders; the
 * caller decides. `margin` is the `margin` object of `GET …/costs`.
 */
export function MarginCard({ margin, hasCosts, currency, bundleParents, title: titleOverride, emptyText }: {
  margin: QuoteMargin | undefined
  /** False when no line carries a cost: the card shows its empty state. */
  hasCosts: boolean
  currency: string
  bundleParents: ReadonlyArray<{ lineId: string; name: string }>
  /** The order page reuses the card as "Order margin". */
  title?: string
  emptyText?: string
}) {
  const t = useT()
  const title = titleOverride ?? t('cpq.margin.title', 'Margin')
  if (!hasCosts || !margin) {
    return (
      <section className="rounded-lg border bg-card p-4" data-testid="cpq-margin-card" aria-label={title}>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="cpq-margin-empty">
          {emptyText ?? t('cpq.margin.empty', 'No costs on this quote yet. Margin is tracked once a line carries costs.')}
        </p>
      </section>
    )
  }
  const view = marginCardView(margin, currency)
  const rollups = bundleRollupRows(margin, bundleParents, currency)
  return (
    <section className="rounded-lg border bg-card p-4" data-testid="cpq-margin-card" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label={t('cpq.margin.contract', 'Contract margin')} value={view.contractMargin} testId="cpq-margin-contract" />
        <Figure label={t('cpq.margin.percent', 'Margin %')} value={view.marginPercent} testId="cpq-margin-percent" />
        <Figure label={t('cpq.margin.nrc', 'NRC margin')} value={view.nrcMargin} testId="cpq-margin-nrc" />
        <Figure label={t('cpq.margin.mrc', 'MRC margin')} value={view.mrcMargin} testId="cpq-margin-mrc" />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="cpq-margin-coverage">
        {t('cpq.margin.coverage', 'Based on {coverage} coverage', { coverage: view.coverage })}
      </p>
      {view.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="cpq-margin-flags">
          {view.flags.map((flag) => (
            <Tag key={flag} variant={VARIANTS[flag]} dot className="px-1.5 text-xs" data-testid={`cpq-margin-flag-${flag}`}>
              {t(`cpq.quoteCosts.badges.${flag}`, COST_BADGE_FALLBACKS[flag])}
            </Tag>
          ))}
        </div>
      )}
      {rollups.length > 0 && (
        <table className="mt-3 w-full text-xs" data-testid="cpq-margin-rollup">
          <caption className="pb-1 text-left text-muted-foreground">{t('cpq.margin.rollup', 'Bundle roll-up (bundle and its components)')}</caption>
          <tbody>
            {rollups.map((row) => (
              <tr key={row.lineId} className="border-t border-dashed border-border/50" data-testid="cpq-margin-rollup-row">
                <td className="py-1 font-medium">{row.name}</td>
                <td className="py-1 text-right font-mono">{row.contractMargin}</td>
                <td className="py-1 pl-3 text-right font-mono">{row.marginPercent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
