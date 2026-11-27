'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { targetOptionLabel, type EditorMode, type TargetOption } from '../../../../../lib/priceDialogView'

/**
 * *Applies to* (D2): every target of the line with what is set on it now;
 * picking one loads it. The One price / Price phases switcher shows only on
 * recurring targets (D1).
 */
export function TargetPicker({ options, value, onChange, mode, onModeChange }: {
  options: TargetOption[]
  value: string
  onChange: (key: string) => void
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}) {
  const t = useT()
  const selected = options.find((option) => option.key === value)
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="block min-w-[22rem] space-y-1">
        <span className="text-xs font-medium">{t('cpq.priceAdjustments.dialog.appliesTo', 'Applies to')}</span>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger data-testid="cpq-price-target"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.key} value={option.key} data-testid="cpq-price-target-option">{targetOptionLabel(t, option)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {selected?.takesPhases && (
        <SegmentedControl value={mode} onValueChange={(next) => onModeChange(next as EditorMode)} aria-label={t('cpq.priceDialog.mode.label', 'Price over time')}>
          <SegmentedControlItem value="one_price" data-testid="cpq-price-mode-one">{t('cpq.priceDialog.mode.one', 'One price')}</SegmentedControlItem>
          <SegmentedControlItem value="phases" data-testid="cpq-price-mode-phases">{t('cpq.priceDialog.mode.phases', 'Price phases')}</SegmentedControlItem>
        </SegmentedControl>
      )}
    </div>
  )
}
