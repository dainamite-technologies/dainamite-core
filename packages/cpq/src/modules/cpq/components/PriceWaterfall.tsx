'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  discountDepth,
  formatDepth,
  waterfallRows,
  type WaterfallChargeInput,
} from '../lib/priceAdjustmentView'

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

const TYPE_FALLBACKS: Record<string, string> = {
  discount_percent: '% discount',
  discount_absolute: 'amount off',
  surcharge_percent: '% surcharge',
  surcharge_absolute: 'fixed surcharge',
  price_override: 'price override',
}

/** Signed depth badge: "−20%" for a discount, "+5%" for a surcharge; text, never colour only. */
export function DepthBadge({ before, after, title }: { before: number | null | undefined; after: number | null | undefined; title?: string }) {
  const label = formatDepth(discountDepth(before, after))
  if (!label) return null
  return <Tag variant="neutral" className="px-1.5 text-xs font-mono" title={title}>{label}</Tag>
}

export type PriceWaterfallProps = {
  charge: WaterfallChargeInput & { chargeName?: string }
  currency: string
  /** Reason code → label; manual rows fall back to the code. */
  reasonLabels?: Record<string, string>
  /** Optional per-adjustment actions (edit / delete) rendered on manual rows. */
  renderManualActions?: (adjustmentId: string) => React.ReactNode
}

/** Read-only list → rule → standard → manual → offer breakdown for one charge (unit prices). */
export function PriceWaterfall({ charge, currency, reasonLabels, renderManualActions }: PriceWaterfallProps) {
  const t = useT()
  const rows = waterfallRows(charge)
  const fmtValue = (ruleType: string, value: number) =>
    ruleType.endsWith('_percent') ? `${value}%` : money(value, currency)
  return (
    <table className="w-full text-xs" data-testid="cpq-price-waterfall">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left py-0.5 font-medium">{t('cpq.priceAdjustments.waterfall.step', 'Step')}</th>
          <th className="text-left py-0.5 font-medium">{t('cpq.priceAdjustments.waterfall.source', 'Source')}</th>
          <th className="text-right py-0.5 font-medium">{t('cpq.priceAdjustments.waterfall.value', 'Value')}</th>
          <th className="text-right py-0.5 font-medium">{t('cpq.priceAdjustments.waterfall.delta', 'Delta')}</th>
          <th className="text-right py-0.5 font-medium">{t('cpq.priceAdjustments.waterfall.unitPrice', 'Unit price')}</th>
          {renderManualActions && <th className="w-16" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          if (row.kind === 'list' || row.kind === 'standard' || row.kind === 'offer') {
            const label = row.kind === 'list'
              ? t('cpq.priceAdjustments.waterfall.list', 'List price')
              : row.kind === 'standard'
                ? t('cpq.priceAdjustments.waterfall.standard', 'Standard price')
                : t('cpq.priceAdjustments.waterfall.offer', 'Offer price')
            return (
              <tr key={`${row.kind}-${index}`} className={`border-t border-border/30 ${row.kind === 'offer' ? 'font-semibold' : 'font-medium'}`}>
                <td className="py-0.5" colSpan={4}>{label}</td>
                <td className="py-0.5 text-right font-mono">{money(row.unitPrice, currency)}</td>
                {renderManualActions && <td />}
              </tr>
            )
          }
          const source = row.kind === 'rule'
            ? `${t('cpq.priceAdjustments.waterfall.rule', 'Price rule')}: ${row.label}`
            : `${t('cpq.priceAdjustments.waterfall.manual', 'Negotiated')}: ${reasonLabels?.[row.reasonCode ?? ''] ?? row.reasonCode ?? row.label}`
          return (
            <tr key={`${row.kind}-${index}`} className="border-t border-border/30">
              <td className="py-0.5 pl-3 text-muted-foreground">{t(`cpq.priceAdjustments.types.${row.ruleType}`, TYPE_FALLBACKS[row.ruleType] ?? row.ruleType)}</td>
              <td className="py-0.5">{source}</td>
              <td className="py-0.5 text-right font-mono">{fmtValue(row.ruleType, row.value)}</td>
              <td className="py-0.5 text-right font-mono">{row.delta > 0 ? '+' : ''}{money(row.delta, currency)}</td>
              <td className="py-0.5 text-right font-mono">{money(row.unitPriceAfter, currency)}</td>
              {renderManualActions && (
                <td className="py-0.5 text-right">{row.kind === 'manual' && row.adjustmentId ? renderManualActions(row.adjustmentId) : null}</td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
