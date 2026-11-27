'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import type { AdjustmentType } from '../../../../../lib/priceAdjustmentView'
import { MAX_TARGET_STEPS } from '../../../../../lib/targetPrice'
import { emptyStep, monthRangeText, stepRanges, suggestedPhaseName, type StepForm, type StepKind, type ThenForm } from '../../../../../lib/priceDialogView'

export const STEP_KIND_FALLBACKS: Record<StepKind, string> = {
  regular: 'Regular price',
  free: 'Free',
  price_override: 'Set price',
  discount_percent: '% off',
  discount_absolute: 'Amount off',
}

/**
 * Price phases editor (D1): steps back to back from month 1 (years = 12
 * months), each a Regular price gap, Free, Set price, % off or Amount off with
 * a name prefilled from §3.5 until the rep types one; then the Then row.
 */
export function PhaseScheduleEditor({ steps, then, types, currency, errorStep, onChange }: {
  steps: StepForm[]
  then: ThenForm
  /** Types the target takes; the Then row offers the same. */
  types: AdjustmentType[]
  currency: string
  /** Step the current error points at (`steps.length` = Then). */
  errorStep?: number
  onChange: (steps: StepForm[], then: ThenForm) => void
}) {
  const t = useT()
  const ranges = stepRanges(steps)
  const last = ranges.at(-1)
  const thenFrom = steps.length === 0 ? 1 : last ? last.toMonth + 1 : null
  const kinds: StepKind[] = ['regular', 'free', ...types]
  const kindLabel = (kind: StepKind) => t(`cpq.priceDialog.kinds.${kind}`, STEP_KIND_FALLBACKS[kind])
  const update = (index: number, patch: Partial<StepForm>) => onChange(steps.map((step, at) => (at === index ? { ...step, ...patch } : step)), then)
  const move = (index: number, by: -1 | 1) => {
    const next = [...steps]
    const [step] = next.splice(index, 1)
    next.splice(index + by, 0, step)
    onChange(next, then)
  }
  const invalid = (index: number) => (errorStep === index ? 'border-destructive' : undefined)

  return (
    <div className="space-y-2" data-testid="cpq-price-phases">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-medium">{t('cpq.phases.columns.months', 'Months')}</th>
            <th className="py-1 text-left font-medium">{t('cpq.phases.dialog.length', 'Length')}</th>
            <th className="py-1 text-left font-medium">{t('cpq.phases.dialog.price', 'Price')}</th>
            <th className="py-1 text-left font-medium">{t('cpq.phases.dialog.value', 'Value')}</th>
            <th className="py-1 text-left font-medium">{t('cpq.priceDialog.phases.name', 'Name')}</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => {
            const range = ranges[index]
            const suggestion = suggestedPhaseName(t, step, index, range)
            return (
              <tr key={index} className="border-t align-middle" data-testid="cpq-price-step">
                <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">{range ? monthRangeText(t, range.fromMonth, range.toMonth) : '—'}</td>
                <td className="py-1 pr-2">
                  <div className="flex gap-1">
                    <Input className={`w-16 ${invalid(index) ?? ''}`} inputMode="numeric" value={step.length} aria-label={t('cpq.phases.dialog.length', 'Length')}
                      onChange={(event) => update(index, { length: event.target.value })} data-testid="cpq-price-step-length" />
                    <Select value={step.unit} onValueChange={(value) => update(index, { unit: value as StepForm['unit'] })}>
                      <SelectTrigger className="w-28" aria-label={t('cpq.priceDialog.phases.unit', 'Unit')}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="month">{t('cpq.phases.dialog.units.month', 'months')}</SelectItem>
                        <SelectItem value="year">{t('cpq.phases.dialog.units.year', 'years')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </td>
                <td className="py-1 pr-2">
                  <Select value={step.kind} onValueChange={(value) => update(index, { kind: value as StepKind })}>
                    <SelectTrigger className="w-36" data-testid="cpq-price-step-kind" aria-label={t('cpq.phases.dialog.price', 'Price')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {kinds.map((kind) => <SelectItem key={kind} value={kind}>{kindLabel(kind)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  {step.kind === 'regular' ? <span className="text-muted-foreground">—</span>
                    : step.kind === 'free' ? <span className="text-muted-foreground">0</span> : (
                      <Input className={`w-24 ${invalid(index) ?? ''}`} inputMode="decimal" value={step.value} placeholder={step.kind === 'discount_percent' ? '%' : currency}
                        aria-label={t('cpq.phases.dialog.value', 'Value')} onChange={(event) => update(index, { value: event.target.value })} data-testid="cpq-price-step-value" />
                    )}
                </td>
                <td className="py-1 pr-2">
                  {step.kind === 'regular' ? <span className="text-muted-foreground">{t('cpq.priceDialog.phases.noName', 'No name (regular price)')}</span> : (
                    <Input maxLength={100} value={step.nameTouched ? step.name : suggestion} aria-label={t('cpq.priceDialog.phases.name', 'Name')}
                      onChange={(event) => update(index, { name: event.target.value, nameTouched: true })} data-testid="cpq-price-step-name" />
                  )}
                </td>
                <td className="py-1 whitespace-nowrap text-right">
                  <IconButton type="button" variant="ghost" size="xs" aria-label={t('cpq.priceDialog.phases.up', 'Move up')} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton type="button" variant="ghost" size="xs" aria-label={t('cpq.priceDialog.phases.down', 'Move down')} disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton type="button" variant="ghost" size="xs" aria-label={t('cpq.phases.dialog.removeStep', 'Remove phase')} disabled={steps.length === 1}
                    onClick={() => onChange(steps.filter((_, at) => at !== index), then)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </td>
              </tr>
            )
          })}
          <tr className="border-t align-middle" data-testid="cpq-price-then">
            <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">{thenFrom ? monthRangeText(t, thenFrom, null) : '—'}</td>
            <td className="py-1 pr-2 text-muted-foreground">{t('cpq.priceDialog.phases.then', 'Then')}</td>
            <td className="py-1 pr-2">
              <Select value={then.kind} onValueChange={(value) => onChange(steps, { ...then, kind: value as ThenForm['kind'] })}>
                <SelectTrigger className="w-36" data-testid="cpq-price-then-kind" aria-label={t('cpq.priceDialog.phases.then', 'Then')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['regular', ...types] as const).map((kind) => <SelectItem key={kind} value={kind}>{kindLabel(kind)}</SelectItem>)}
                </SelectContent>
              </Select>
            </td>
            <td className="py-1 pr-2">
              {then.kind === 'regular' ? <span className="text-muted-foreground">—</span> : (
                <Input className={`w-24 ${invalid(steps.length) ?? ''}`} inputMode="decimal" value={then.value} placeholder={then.kind === 'discount_percent' ? '%' : currency}
                  aria-label={t('cpq.phases.dialog.value', 'Value')} onChange={(event) => onChange(steps, { ...then, value: event.target.value })} data-testid="cpq-price-then-value" />
              )}
            </td>
            <td colSpan={2} className="py-1 text-muted-foreground">
              {then.kind === 'regular'
                ? t('cpq.priceDialog.phases.thenRegular', 'The regular price runs to the end')
                : t('cpq.priceDialog.phases.thenPrice', 'This price runs to the end; billing shows it as the regular price')}
            </td>
          </tr>
        </tbody>
      </table>
      <Button type="button" variant="outline" size="sm" disabled={steps.length >= MAX_TARGET_STEPS}
        onClick={() => onChange([...steps, emptyStep('discount_percent')], then)} data-testid="cpq-price-add-step">
        <Plus className="h-4 w-4" />
        {t('cpq.phases.dialog.addStep', 'Add phase')}
      </Button>
    </div>
  )
}
