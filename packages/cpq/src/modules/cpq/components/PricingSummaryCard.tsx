'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDepth } from '../lib/priceAdjustmentView'
import { chargeTypeDepths, formatChangePct, type ArcRecurringDelta } from '../lib/quoteSummaryView'
import { formatMoney } from '../lib/formatMoney'

/** Pricing summary fields shared by quote and order results. Waterfall fields are absent on legacy snapshots. */
export type PricingSummaryView = {
  nrcTotal: number
  mrcTotal: number
  listNrcTotal?: number
  listMrcTotal?: number
  dealValue?: { list: number; standard: number; offer: number }
  discountDepth?: { total: number | null } | null
  usageTotalEstimated?: number | null
  usageCharges?: Array<{ chargeName: string; unitPrice: number }>
}

export function SummaryFigure({
  label,
  value,
  note,
  title,
  size = 'lg',
  valueClassName,
  testId,
}: {
  label: string
  value: string
  note?: string | null
  title?: string
  size?: 'lg' | 'sm'
  valueClassName?: string
  testId?: string
}) {
  return (
    <div data-testid={testId}>
      <p className="text-xs text-muted-foreground" title={title}>{label}</p>
      <p className={`${size === 'lg' ? 'text-lg' : 'text-sm'} font-semibold font-mono ${valueClassName ?? ''}`}>
        {value}
        {note && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({note})</span>}
      </p>
    </div>
  )
}

/**
 * NRC / MRC / deal value with discount depth in brackets, plus the ARC
 * current → new MRC row on Amend / Renew documents. Shared by the quote and
 * order detail pages so both read the same.
 */
export function PricingSummaryCard({ summary, currency, arcDelta }: {
  summary: PricingSummaryView
  currency: string
  arcDelta?: ArcRecurringDelta | null
}) {
  const t = useT()
  const typeDepths = chargeTypeDepths(summary)
  const usageCharges = summary.usageCharges ?? []
  return (
    <div className="rounded-lg border bg-card p-4" data-testid="cpq-pricing-summary">
      <h3 className="text-sm font-medium mb-3">{t('cpq.quotes.summary.title', 'Pricing Summary')}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryFigure
          label={t('cpq.quotes.summary.nrc', 'Non-Recurring (NRC)')}
          value={formatMoney(summary.nrcTotal, currency)}
          note={formatDepth(typeDepths.nrc)}
          testId="cpq-summary-nrc"
        />
        <SummaryFigure
          label={t('cpq.quotes.summary.mrc', 'Monthly Recurring (MRC)')}
          value={formatMoney(summary.mrcTotal, currency)}
          note={formatDepth(typeDepths.mrc)}
          testId="cpq-summary-mrc"
        />
        {summary.dealValue && (
          <SummaryFigure
            label={t('cpq.priceAdjustments.summary.dealValue', 'Deal value')}
            title={t('cpq.priceAdjustments.summary.hint', 'Deal value counts recurring charges over the term plus one-time charges; existing subscription items on change quotes are excluded.')}
            value={formatMoney(summary.dealValue.offer, currency)}
            note={formatDepth(summary.discountDepth?.total ?? null)}
            testId="cpq-deal-value"
          />
        )}
        {summary.usageTotalEstimated != null && (
          <SummaryFigure
            label={t('cpq.quotes.summary.usageEstimated', 'Usage (est.)')}
            value={formatMoney(summary.usageTotalEstimated, currency)}
          />
        )}
        {usageCharges.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">{t('cpq.quotes.summary.usageCharges', 'Usage Charges')}</p>
            {usageCharges.map((uc, i) => (
              <p key={i} className="text-xs mt-0.5">{uc.chargeName}: {formatMoney(uc.unitPrice, currency)}/unit</p>
            ))}
          </div>
        )}
      </div>
      {arcDelta && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t pt-3" data-testid="cpq-arc-delta">
          <SummaryFigure
            size="sm"
            testId="cpq-arc-current-mrc"
            label={t('cpq.quotes.summary.arc.currentMrc', 'Current MRC')}
            value={formatMoney(arcDelta.currentMrc, currency)}
          />
          <SummaryFigure
            size="sm"
            testId="cpq-arc-new-mrc"
            label={t('cpq.quotes.summary.arc.newMrc', 'New MRC')}
            value={formatMoney(arcDelta.newMrc, currency)}
          />
          <SummaryFigure
            size="sm"
            testId="cpq-arc-mrc-change"
            label={t('cpq.quotes.summary.arc.mrcChange', 'MRC change')}
            value={`${arcDelta.delta > 0 ? '+' : ''}${formatMoney(arcDelta.delta, currency)}`}
            valueClassName={arcDelta.delta > 0 ? 'text-status-success-text' : arcDelta.delta < 0 ? 'text-destructive' : undefined}
            note={formatChangePct(arcDelta.deltaPct)}
          />
        </div>
      )}
    </div>
  )
}
