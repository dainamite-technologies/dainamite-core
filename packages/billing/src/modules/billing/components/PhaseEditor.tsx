"use client"
import * as React from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { formatBillingDay } from '../lib/displayDate'
import { MAX_PHASES_PER_ITEM, PHASE_DURATION_UNITS, PHASE_PRICE_TYPES, type PhaseDurationUnit, type PhasePriceType } from '../lib/pricePhases'
import {
  canAddPhase,
  movePhaseRow,
  newPhaseRow,
  phaseRowRanges,
  type PhaseEditorRow,
} from '../lib/phaseEditorRows'
import { shiftIsoDay } from '../lib/itemStatusLabel'
import { MoneyInput } from './MoneyInput'

/**
 * Price-phase editor of a recurring item (price-phases spec §4.1): ordered
 * rows of name, duration (count + unit) or "until" date, price type and value,
 * max 12. Each row shows the dates it resolves to from the bill start date —
 * phases run back to back, the regular price applies after the last one.
 * Prices are per the item's billing period.
 */

export type PhaseEditorProps = {
  rows: PhaseEditorRow[]
  onChange: (rows: PhaseEditorRow[]) => void
  billStartDate: string
  currencyCode?: string
  /** Index of the row the last validation flagged (highlighted). */
  errorIndex?: number | null
}

export function PhaseEditor({ rows, onChange, billStartDate, currencyCode, errorIndex = null }: PhaseEditorProps) {
  const t = useT()
  const locale = useLocale()
  const ranges = React.useMemo(() => phaseRowRanges(billStartDate, rows), [billStartDate, rows])

  const update = (index: number, patch: Partial<PhaseEditorRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const unitLabel = (unit: PhaseDurationUnit): string => {
    switch (unit) {
      case 'day':
        return t('billing.items.phases.unit.day', 'days')
      case 'week':
        return t('billing.items.phases.unit.week', 'weeks')
      case 'month':
        return t('billing.items.phases.unit.month', 'months')
      case 'year':
        return t('billing.items.phases.unit.year', 'years')
    }
  }

  const priceTypeLabel = (type: PhasePriceType): string => {
    switch (type) {
      case 'free':
        return t('billing.items.phases.price.free', 'Free')
      case 'fixed':
        return t('billing.items.phases.price.fixed', 'Fixed price')
      case 'percent_off':
        return t('billing.items.phases.price.percent_off', '% off')
      case 'amount_off':
        return t('billing.items.phases.price.amount_off', 'Amount off')
    }
  }

  const lastEnd = ranges.length > 0 ? ranges[ranges.length - 1] : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t(
          'billing.items.phases.help',
          'Phases run back to back from the bill start date; the regular price applies after the last one. Prices are per the item’s billing period.',
        )}
      </p>
      {rows.map((row, index) => {
        const range = ranges[index]
        const flagged = errorIndex === index
        return (
          <div
            key={row.key}
            className={`rounded-md border p-3 ${flagged ? 'border-destructive' : 'border-border'}`}
            data-testid={`billing-phase-row-${index}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('billing.items.phases.row_title', 'Phase {n}', { n: index + 1 })}
                {' · '}
                {range
                  ? `${formatBillingDay(range.start, locale)} – ${formatBillingDay(range.end, locale)}`
                  : t('billing.items.phases.range_pending', 'dates appear once the phase is complete')}
              </span>
              <div className="flex items-center gap-1">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('billing.items.phases.move_up', 'Move up')}
                  disabled={index === 0}
                  onClick={() => onChange(movePhaseRow(rows, index, index - 1))}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('billing.items.phases.move_down', 'Move down')}
                  disabled={index === rows.length - 1}
                  onClick={() => onChange(movePhaseRow(rows, index, index + 1))}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('billing.items.phases.remove', 'Remove phase')}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.items.phases.name', 'Name (optional)')}</span>
                <Input
                  value={row.name}
                  maxLength={120}
                  placeholder={t('billing.items.phases.name_placeholder', 'e.g. Free trial')}
                  onChange={(event) => update(index, { name: event.currentTarget.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.items.phases.length', 'Length')}</span>
                <Select
                  value={row.mode}
                  onValueChange={(next) => update(index, { mode: next === 'until' ? 'until' : 'duration' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="duration">{t('billing.items.phases.mode.duration', 'For a duration')}</SelectItem>
                    <SelectItem value="until">{t('billing.items.phases.mode.until', 'Until a date')}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {row.mode === 'duration' ? (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{t('billing.items.phases.duration', 'Duration')}</span>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      className="w-20"
                      aria-label={t('billing.items.phases.duration_count', 'Duration count')}
                      value={row.durationCount}
                      onChange={(event) => update(index, { durationCount: event.currentTarget.value })}
                    />
                    <Select
                      value={row.durationUnit}
                      onValueChange={(next) => update(index, { durationUnit: next as PhaseDurationUnit })}
                    >
                      <SelectTrigger aria-label={t('billing.items.phases.duration_unit', 'Duration unit')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PHASE_DURATION_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unitLabel(unit)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{t('billing.items.phases.until', 'Last day')}</span>
                  <Input
                    type="date"
                    value={row.untilDate}
                    min={range?.start ?? billStartDate}
                    onChange={(event) => update(index, { untilDate: event.currentTarget.value })}
                  />
                </label>
              )}
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('billing.items.phases.price', 'Price')}</span>
                <div className="flex gap-2">
                  <Select
                    value={row.priceType}
                    onValueChange={(next) => update(index, { priceType: next as PhasePriceType })}
                  >
                    <SelectTrigger aria-label={t('billing.items.phases.price_type', 'Price type')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PHASE_PRICE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {priceTypeLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.priceType === 'percent_off' ? (
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="w-24"
                      aria-label={t('billing.items.phases.value_percent', 'Percent off')}
                      value={row.value}
                      onChange={(event) => update(index, { value: event.currentTarget.value })}
                    />
                  ) : row.priceType !== 'free' ? (
                    <MoneyInput
                      currencyCode={currencyCode}
                      step="0.01"
                      min="0"
                      aria-label={t('billing.items.phases.value_amount', 'Amount')}
                      value={row.value}
                      onChange={(event) => update(index, { value: event.currentTarget.value })}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAddPhase(rows)}
          onClick={() => onChange([...rows, newPhaseRow(rows.length === 0 ? {} : { priceType: 'percent_off', value: '' })])}
        >
          <Plus size={14} />
          {t('billing.items.phases.add', 'Add phase')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {!canAddPhase(rows)
            ? t('billing.items.phases.max_reached', 'At most {max} phases per item', { max: MAX_PHASES_PER_ITEM })
            : lastEnd
              ? t('billing.items.phases.regular_from', 'Regular price from {date}', {
                  date: formatBillingDay(shiftIsoDay(lastEnd.end, 1), locale),
                })
              : null}
        </span>
      </div>
    </div>
  )
}
