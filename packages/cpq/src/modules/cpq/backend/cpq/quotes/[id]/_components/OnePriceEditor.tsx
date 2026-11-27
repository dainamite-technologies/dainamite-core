'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { overrideSetsChargeTotal, type AdjustmentType } from '../../../../../lib/priceAdjustmentView'
import type { DialogCharge, EditorState, TargetOption } from '../../../../../lib/priceDialogView'

const TYPE_FALLBACKS: Record<AdjustmentType, string> = { price_override: 'Set price', discount_percent: '% off', discount_absolute: 'Amount off' }

/** One price (D1): one permanent row `[1, null]`, with today's hints (spread over the charges, charge total on volume / tiered). */
export function OnePriceEditor({ option, charge, value, onChange }: {
  option: TargetOption
  /** The charge of a charge target (drives the Set charge total hint). */
  charge?: DialogCharge
  value: EditorState['one']
  onChange: (value: EditorState['one']) => void
}) {
  const t = useT()
  const setsTotal = option.kind === 'charge' && overrideSetsChargeTotal(charge)
  const scope = option.kind === 'line_nrc' ? t('cpq.priceAdjustments.dialog.scopeNrc', 'one-time') : t('cpq.priceAdjustments.dialog.scopeMrc', 'recurring')
  const typeLabel = (type: AdjustmentType) => type === 'price_override' && setsTotal
    ? t('cpq.priceAdjustments.dialog.types.price_override_total', 'Set charge total')
    : t(`cpq.priceAdjustments.dialog.types.${type}`, TYPE_FALLBACKS[type])
  const hint = value.adjustmentType === 'discount_percent'
    ? t('cpq.priceAdjustments.dialog.percentHint', 'Percent off the standard price (0–100)')
    : option.kind !== 'charge'
      ? value.adjustmentType === 'price_override'
        ? t('cpq.priceAdjustments.dialog.lineOverrideHint', 'New {scope} total for this line (all quantities), spread over its charges', { scope })
        : t('cpq.priceAdjustments.dialog.lineAbsoluteHint', 'Amount taken off this line’s {scope} total, spread over its charges', { scope })
      : value.adjustmentType === 'price_override'
        ? setsTotal
          ? t('cpq.priceAdjustments.dialog.totalOverrideHint', 'New charge total (volume and tiered charges have no single unit price)')
          : t('cpq.priceAdjustments.dialog.overrideHint', 'New unit price')
        : t('cpq.priceAdjustments.dialog.absoluteHint', 'Amount taken off this charge’s total')

  return (
    <div className="grid grid-cols-[12rem_10rem_1fr] items-start gap-2" data-testid="cpq-price-one">
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.type', 'Adjustment')}</span>
        <Select value={value.adjustmentType} onValueChange={(next) => onChange({ ...value, adjustmentType: next as AdjustmentType })}>
          <SelectTrigger data-testid="cpq-price-one-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {option.types.map((type) => <SelectItem key={type} value={type}>{typeLabel(type)}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.value', 'Value')}</span>
        <Input inputMode="decimal" autoFocus value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })}
          aria-describedby="cpq-price-one-hint" data-testid="cpq-price-one-value" />
      </label>
      <span id="cpq-price-one-hint" className="pt-6 text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}
