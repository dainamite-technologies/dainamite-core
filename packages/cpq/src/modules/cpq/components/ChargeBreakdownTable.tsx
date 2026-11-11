'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Info } from 'lucide-react'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { DepthBadge, PriceWaterfall } from './PriceWaterfall'
import { ADJUSTMENT_ERROR_FALLBACKS, type WaterfallChargeInput } from '../lib/priceAdjustmentView'
import { formatMoney } from '../lib/formatMoney'

type TierBreakdownEntry = { tier: number; from: number; to: number; pricePerUnit: number; quantity: number; subtotal: number }

/** One priced charge as stored on a quote or order line. */
export type ChargeRowView = WaterfallChargeInput & {
  chargeName: string
  quantity?: number | null
  note?: string | null
  breakdown?: { tiers: TierBreakdownEntry[] } | null
  adjustmentErrors?: Array<{ code: string }>
}

/** Right-aligned price column header with an explanatory hover tooltip. */
function PriceColumnHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <th className="text-right py-1 font-medium">
      <SimpleTooltip content={hint} size="sm">
        <span className="inline-flex items-center gap-1 cursor-help" tabIndex={0} aria-label={`${label}: ${hint}`}>
          {label}
          <Info className="h-3 w-3" aria-hidden />
        </span>
      </SimpleTooltip>
    </th>
  )
}

/**
 * Charge table shared by the quote and order detail pages: list / standard /
 * offer unit prices with depth badge, and a per-charge pricing detail (tiers +
 * price waterfall). Editing hooks are optional render props.
 */
export function ChargeBreakdownTable<C extends ChargeRowView>({
  charges,
  currency,
  openDetailIndex,
  onToggleDetail,
  reasonLabels,
  renderChargeActions,
  renderManualActions,
}: {
  charges: C[]
  currency: string
  openDetailIndex: number | null
  onToggleDetail: (chargeIndex: number) => void
  reasonLabels?: Record<string, string>
  renderChargeActions?: (charge: C) => React.ReactNode
  renderManualActions?: (adjustmentId: string) => React.ReactNode
}) {
  const t = useT()
  return (
    <table className="w-full text-xs" data-testid="cpq-charge-breakdown">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left py-1 font-medium">{t('cpq.charges.charge', 'Charge')}</th>
          <th className="text-left py-1 font-medium">{t('cpq.charges.type', 'Type')}</th>
          <PriceColumnHeader
            label={t('cpq.priceAdjustments.listUnit', 'List')}
            hint={t('cpq.priceAdjustments.listUnitHint', 'Catalog unit price from the pricing table, before any price rules or manual adjustments.')}
          />
          <PriceColumnHeader
            label={t('cpq.priceAdjustments.standardUnit', 'Standard')}
            hint={t('cpq.priceAdjustments.standardUnitHint', 'Unit price after automatic price rules (e.g. volume or segment discounts), before manual adjustments.')}
          />
          <PriceColumnHeader
            label={t('cpq.priceAdjustments.offerUnit', 'Offer')}
            hint={t('cpq.priceAdjustments.offerUnitHint', 'Final unit price quoted to the customer, after price rules and manual adjustments. The badge shows the total change vs list.')}
          />
          <th className="text-right py-1 font-medium">{t('cpq.charges.qty', 'Qty')}</th>
          <th className="text-right py-1 font-medium">{t('cpq.charges.total', 'Total')}</th>
          <th className="w-16" />
        </tr>
      </thead>
      <tbody>
        {charges.map((c, i) => {
          const hasDetail = !!(c.breakdown?.tiers?.length || c.adjustments?.length)
          const isDetailOpen = openDetailIndex === i
          const listUnit = c.listUnitPrice ?? c.unitPrice
          const standardUnit = c.standardUnitPrice ?? c.unitPrice
          const errors = c.adjustmentErrors ?? []
          return (
            <React.Fragment key={i}>
              <tr className="border-t border-dashed border-border/50">
                <td className="py-1">
                  <span>{c.chargeName}</span>
                  {errors.length > 0 && (
                    <Tag variant="warning" className="ml-1.5 px-1.5 text-xs" data-testid="cpq-adjustment-invalid">
                      {t('cpq.priceAdjustments.invalid', 'Invalid')}: {t(`cpq.priceAdjustments.errors.${errors[0].code}`, ADJUSTMENT_ERROR_FALLBACKS[errors[0].code] ?? errors[0].code)}
                    </Tag>
                  )}
                </td>
                <td className="py-1 uppercase">{c.chargeType}</td>
                <td className="py-1 text-right font-mono text-muted-foreground">{formatMoney(listUnit, currency)}</td>
                <td className="py-1 text-right font-mono text-muted-foreground">{formatMoney(standardUnit, currency)}</td>
                <td className="py-1 text-right font-mono">
                  <span className="inline-flex items-center gap-1">
                    <DepthBadge before={listUnit} after={c.unitPrice} />
                    {formatMoney(c.unitPrice, currency)}
                  </span>
                </td>
                <td className="py-1 text-right font-mono">{c.quantity ?? '—'}</td>
                <td className="py-1 text-right font-mono">{c.totalPrice != null ? formatMoney(c.totalPrice, currency) : c.note ?? '—'}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  {renderChargeActions?.(c)}
                  {hasDetail && (
                    <button
                      type="button"
                      onClick={() => onToggleDetail(i)}
                      className="inline-flex items-center justify-center rounded p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      title={t('cpq.priceAdjustments.showBreakdown', 'Show price breakdown')}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
              {isDetailOpen && (
                <tr>
                  <td colSpan={8} className="pb-3 pt-1">
                    <ChargePricingDetail charge={c} currency={currency} reasonLabels={reasonLabels} renderManualActions={renderManualActions} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

function ChargePricingDetail({ charge: c, currency, reasonLabels, renderManualActions }: {
  charge: ChargeRowView
  currency: string
  reasonLabels?: Record<string, string>
  renderManualActions?: (adjustmentId: string) => React.ReactNode
}) {
  const t = useT()
  const tiers = c.breakdown?.tiers ?? []
  return (
    <div className="rounded border bg-background p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{t('cpq.charges.pricingDetails', 'Pricing Details')} — {c.chargeName}</span>
        <span className="text-muted-foreground">{c.pricingMethod ?? 'flat'}</span>
      </div>

      {tiers.length > 0 && (
        <div>
          <div className="font-medium text-muted-foreground mb-1">{t('cpq.charges.tierBreakdown', 'Tier Breakdown')}</div>
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left py-0.5 font-medium">{t('cpq.charges.tier', 'Tier')}</th>
                <th className="text-right py-0.5 font-medium">{t('cpq.charges.range', 'Range')}</th>
                <th className="text-right py-0.5 font-medium">{t('cpq.charges.pricePerUnit', 'Price/Unit')}</th>
                <th className="text-right py-0.5 font-medium">{t('cpq.charges.qty', 'Qty')}</th>
                <th className="text-right py-0.5 font-medium">{t('cpq.charges.subtotal', 'Subtotal')}</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.tier} className="border-t border-border/30">
                  <td className="py-0.5">{tier.tier}</td>
                  <td className="py-0.5 text-right font-mono">{tier.from}–{tier.to}</td>
                  <td className="py-0.5 text-right font-mono">{formatMoney(tier.pricePerUnit, currency)}</td>
                  <td className="py-0.5 text-right font-mono">{tier.quantity}</td>
                  <td className="py-0.5 text-right font-mono">{formatMoney(tier.subtotal, currency)}</td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td colSpan={4} className="py-0.5 text-right">{t('cpq.charges.tieredTotal', 'Tiered Total')}</td>
                <td className="py-0.5 text-right font-mono">
                  {formatMoney(tiers.reduce((sum, tier) => sum + tier.subtotal, 0), currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="font-medium text-muted-foreground mb-1">{t('cpq.priceAdjustments.waterfall.title', 'Price waterfall')}</div>
        <PriceWaterfall charge={c} currency={currency} reasonLabels={reasonLabels} renderManualActions={renderManualActions} />
      </div>

      <div className="flex items-center justify-between pt-1 border-t text-sm font-semibold">
        <span>{t('cpq.charges.finalTotal', 'Final Total')}</span>
        <span className="font-mono">{c.totalPrice != null ? formatMoney(c.totalPrice, currency) : '—'}</span>
      </div>
    </div>
  )
}
