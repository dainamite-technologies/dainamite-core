'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { formatMoney } from '../lib/formatMoney'
import type { ChargeScheduleSegment } from '../lib/priceSchedule'

/** "Month 1", "Months 2–3", "From month 25". */
export function useMonthRangeLabel() {
  const t = useT()
  return React.useCallback((fromMonth: number, toMonth: number | null) => {
    if (toMonth === null) return t('cpq.phases.monthsFrom', 'From month {from}', { from: fromMonth })
    if (toMonth === fromMonth) return t('cpq.phases.month', 'Month {from}', { from: fromMonth })
    return t('cpq.phases.months', 'Months {from}–{to}', { from: fromMonth, to: toMonth })
  }, [t])
}

const SOURCE_FALLBACKS: Record<ChargeScheduleSegment['source'], string> = { list: 'List', rule: 'Rule', manual: 'Manual' }

/**
 * Price phases of one recurring charge (spec P §4.3): each month range with its
 * price and source (price rule or manual), then the regular price after the
 * last phase. Prices are per the charge's billing period.
 */
export function PriceScheduleTable({ schedule, currency, termMonths }: {
  schedule: ChargeScheduleSegment[]
  currency: string
  /** Line term; months after it are greyed out. */
  termMonths?: number | null
}) {
  const t = useT()
  const rangeLabel = useMonthRangeLabel()
  return (
    <table className="w-full" data-testid="cpq-price-schedule">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left py-0.5 font-medium">{t('cpq.phases.columns.months', 'Months')}</th>
          <th className="text-left py-0.5 font-medium">{t('cpq.phases.columns.phase', 'Phase')}</th>
          <th className="text-left py-0.5 font-medium">{t('cpq.phases.columns.source', 'Source')}</th>
          <th className="text-right py-0.5 font-medium">{t('cpq.priceAdjustments.standardUnit', 'Standard')}</th>
          <th className="text-right py-0.5 font-medium">{t('cpq.phases.columns.price', 'Price')}</th>
        </tr>
      </thead>
      <tbody>
        {schedule.map((segment) => {
          const regular = segment.toMonth === null
          const outsideTerm = !!termMonths && segment.fromMonth > termMonths
          return (
            <tr key={segment.fromMonth} className={`border-t border-border/30 ${outsideTerm ? 'text-muted-foreground' : ''}`} data-testid="cpq-price-schedule-row">
              <td className="py-0.5">{rangeLabel(segment.fromMonth, segment.toMonth)}</td>
              <td className="py-0.5">
                {regular ? t('cpq.phases.regularPrice', 'Regular price') : segment.name ?? '—'}
              </td>
              <td className="py-0.5">
                <Tag variant={segment.source === 'manual' ? 'warning' : 'neutral'} className="px-1.5 text-xs">
                  {t(`cpq.phases.sources.${segment.source}`, SOURCE_FALLBACKS[segment.source])}
                </Tag>
              </td>
              <td className="py-0.5 text-right font-mono text-muted-foreground">
                {segment.standardTotalPrice != null ? formatMoney(segment.standardTotalPrice, currency) : '—'}
              </td>
              <td className="py-0.5 text-right font-mono">{segment.totalPrice != null ? formatMoney(segment.totalPrice, currency) : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
