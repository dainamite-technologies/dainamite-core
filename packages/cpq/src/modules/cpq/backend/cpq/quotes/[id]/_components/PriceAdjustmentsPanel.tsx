'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { ADJUSTMENT_ERROR_FALLBACKS } from '../../../../../lib/priceAdjustmentView'
import { ManualAdjustmentActions, useAccessReasonText, usePriceAdjustmentUi } from './priceAdjustmentContext'

export const PRICE_ADJUSTMENTS_SPOT_ID = 'data-table:cpq.quote_price_adjustments'

export type StoredAdjustment = {
  id: string
  level: 'charge' | 'line'
  quoteLineId: string
  chargeCode?: string | null
  chargeTypeFilter?: 'nrc' | 'mrc' | null
  adjustmentType: 'discount_percent' | 'discount_absolute' | 'price_override'
  value: number
  currencyCode?: string | null
  reasonCode: string
  reasonNote?: string | null
  createdByUserId: string
  createdAt: string
}

type LineRef = { lineId: string; offeringName: string; offeringId: string | null; configuration?: Record<string, unknown> | null; charges: Array<{ chargeCode: string; chargeName: string }> }

const TYPE_FALLBACKS: Record<StoredAdjustment['adjustmentType'], string> = {
  price_override: 'Price override',
  discount_percent: '% discount',
  discount_absolute: 'Amount off',
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export function PriceAdjustmentsPanel({ quoteId, items, total, lines, currency, errorsById }: {
  quoteId: string
  items: StoredAdjustment[]
  total: number
  lines: LineRef[]
  currency: string
  /** adjustmentId → first error code reported by the latest pricing. */
  errorsById: Map<string, string>
}) {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  const lineById = React.useMemo(() => new Map(lines.map((line) => [line.lineId, line])), [lines])
  const accessText = useAccessReasonText()
  // Toggle off: stored adjustments still price the quote, so keep them visible (read-only).
  if (!ui || (ui.access.reason === 'disabled' && items.length === 0)) return null

  return (
    <div className="rounded-lg border bg-card" data-testid="cpq-price-adjustments-panel">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-medium">
          {t('cpq.priceAdjustments.panel.title', 'Price adjustments')}
          <span className="ml-2 text-xs text-muted-foreground">{total}</span>
        </h3>
        {accessText && ui.access.reason !== 'loading' && (
          <span className="text-xs text-muted-foreground" data-testid="cpq-price-adjustments-locked">{accessText}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {t('cpq.priceAdjustments.panel.empty', 'No negotiated prices yet. Use “Adjust price” on a charge or “Discount line” on a line.')}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-4 py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.target', 'Applies to')}</th>
              <th className="py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.type', 'Type')}</th>
              <th className="py-1.5 text-right font-medium">{t('cpq.priceAdjustments.panel.value', 'Value')}</th>
              <th className="py-1.5 pl-4 text-left font-medium">{t('cpq.priceAdjustments.panel.reason', 'Reason')}</th>
              <th className="py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.author', 'Author')}</th>
              <th className="py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.date', 'Date')}</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const line = lineById.get(item.quoteLineId)
              const chargeName = item.chargeCode ? line?.charges.find((charge) => charge.chargeCode === item.chargeCode)?.chargeName ?? item.chargeCode : null
              const scope = item.level === 'line'
                ? item.chargeTypeFilter === 'mrc' ? t('cpq.priceAdjustments.panel.lineMrc', 'whole line, recurring')
                  : item.chargeTypeFilter === 'nrc' ? t('cpq.priceAdjustments.panel.lineNrc', 'whole line, one-time')
                    : t('cpq.priceAdjustments.panel.line', 'whole line')
                : chargeName
              const error = errorsById.get(item.id)
              return (
                <tr key={item.id} className="border-t" data-testid="cpq-price-adjustment-row">
                  <td className="px-4 py-1.5">
                    <span className="font-medium">{line?.offeringName ?? t('cpq.priceAdjustments.panel.removedLine', 'Removed line')}</span>
                    <span className="text-muted-foreground"> · {scope}</span>
                    {error && (
                      <Tag variant="warning" className="ml-1.5 px-1.5 text-xs">
                        {t('cpq.priceAdjustments.invalid', 'Invalid')}: {t(`cpq.priceAdjustments.errors.${error}`, ADJUSTMENT_ERROR_FALLBACKS[error] ?? error)}
                      </Tag>
                    )}
                  </td>
                  <td className="py-1.5">{t(`cpq.priceAdjustments.panel.types.${item.adjustmentType}`, TYPE_FALLBACKS[item.adjustmentType])}</td>
                  <td className="py-1.5 text-right font-mono">
                    {item.adjustmentType === 'discount_percent' ? `${item.value}%` : money(item.value, item.currencyCode ?? currency)}
                  </td>
                  <td className="py-1.5 pl-4">
                    {ui.reasonLabels[item.reasonCode] ?? item.reasonCode}
                    {item.reasonNote && <span className="block text-muted-foreground">{item.reasonNote}</span>}
                  </td>
                  <td className="py-1.5 font-mono text-muted-foreground" title={item.createdByUserId}>{item.createdByUserId.slice(0, 8)}</td>
                  <td className="py-1.5 text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="py-1.5 pr-2 text-right"><ManualAdjustmentActions adjustmentId={item.id} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <InjectionSpot spotId={PRICE_ADJUSTMENTS_SPOT_ID} context={{ quoteId, adjustments: items }} />
    </div>
  )
}
