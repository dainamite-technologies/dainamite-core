"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../../lib/displayDate'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  BILL_CYCLES,
  BILL_CYCLE_INTERVAL_MAX,
  WEEKDAYS,
  defaultCycleDay,
  type BillCycle,
  type CycleSpec,
} from '../../lib/billCycle'
import { nextCycleDay } from '../../lib/billPeriod'
import { resolveCycleUpdate } from '../../lib/accountCycle'
import { parseCycleInterval, type BillCycleFormValues } from '../../lib/billCyclePayload'
import { localTodayIso, toUtcMidnight } from '../../lib/dateOnly'
import { useBillCycleSummary } from './useBillCycleSummary'

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1))
// Monday-first for the picker; storage codes stay `sun`…`sat`.
const WEEKDAY_ORDER = [...WEEKDAYS.slice(1), WEEKDAYS[0]]

export type BillCycleFieldsProps = {
  mode: 'create' | 'edit'
  values: BillCycleFormValues
  onChange: (patch: Partial<BillCycleFormValues>) => void
  /** Edit mode: the stored cycle + dates, to preview a re-aligned next bill date. */
  stored?: { spec: CycleSpec; nextBillDate: string; lastBillDate: string | null }
}

/**
 * "Every [N] [unit] on day [d]" + the next bill date it produces. The preview
 * runs the same pure rules the API applies (`lib/accountCycle.ts`), so what
 * the operator sees is what gets saved.
 */
export function BillCycleFields({ mode, values, onChange, stored }: BillCycleFieldsProps) {
  const t = useT()
  const locale = useLocale()
  const summarize = useBillCycleSummary()
  const interval = parseCycleInterval(values.billCycleInterval)
  const spec: CycleSpec = {
    cycle: values.billCycle,
    interval: interval ?? 1,
    day: values.billCycle === 'daily' ? null : values.billCycleDay || null,
  }

  // Cheap pure computation — the same rules the API applies on save.
  const previewNextBill = ((): string | null => {
    if (values.nextBillDateOverride) return values.nextBillDate || null
    const today = toUtcMidnight(localTodayIso())
    if (mode === 'create' || !stored) return nextCycleDay(today, spec).toISOString().slice(0, 10)
    const result = resolveCycleUpdate({ ...stored.spec, lastBillDate: stored.lastBillDate }, spec, today)
    if (!result.ok) return null
    return result.nextBillDate ? result.nextBillDate.toISOString().slice(0, 10) : stored.nextBillDate
  })()

  const unitLabel = (unit: BillCycle) => {
    switch (unit) {
      case 'daily':
        return t('billing.cycle.unit.daily', 'day(s)')
      case 'weekly':
        return t('billing.cycle.unit.weekly', 'week(s)')
      case 'monthly':
        return t('billing.cycle.unit.monthly', 'month(s)')
      case 'annually':
        return t('billing.cycle.unit.annually', 'year(s)')
    }
  }

  const changeUnit = (unit: BillCycle) => {
    const max = BILL_CYCLE_INTERVAL_MAX[unit]
    onChange({
      billCycle: unit,
      billCycleDay: defaultCycleDay(unit, null) ?? '',
      billCycleInterval: interval && interval > max ? String(max) : values.billCycleInterval,
    })
  }

  return (
    <div className="col-span-2 flex flex-col gap-2 text-sm">
      <span className="text-muted-foreground">{t('billing.accounts.form.bill_cycle', 'Bill cycle')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span>{t('billing.accounts.form.cycle.every', 'Every')}</span>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={BILL_CYCLE_INTERVAL_MAX[values.billCycle]}
          className="w-20"
          aria-label={t('billing.accounts.form.cycle.interval', 'Number of units per cycle')}
          value={values.billCycleInterval}
          onChange={(event) => onChange({ billCycleInterval: event.currentTarget.value })}
        />
        <Select value={values.billCycle} onValueChange={(next) => changeUnit(next as BillCycle)}>
          <SelectTrigger className="w-36" aria-label={t('billing.accounts.form.cycle.unit', 'Cycle unit')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BILL_CYCLES.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {unitLabel(unit)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {values.billCycle !== 'daily' ? (
          <>
            <span>{t('billing.accounts.form.cycle.on', 'on')}</span>
            <Select value={values.billCycleDay} onValueChange={(next) => onChange({ billCycleDay: next })}>
              <SelectTrigger className="w-36" aria-label={t('billing.accounts.form.cycle_day', 'Bill cycle day')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {values.billCycle === 'weekly'
                  ? WEEKDAY_ORDER.map((code) => (
                      <SelectItem key={code} value={code}>
                        {t(`billing.weekday.${code}`, code)}
                      </SelectItem>
                    ))
                  : MONTH_DAYS.map((day) => (
                      <SelectItem key={day} value={day}>
                        {t('billing.accounts.form.cycle.day_n', 'day {day}', { day })}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>
      {values.billCycle !== 'weekly' && values.billCycle !== 'daily' && Number(values.billCycleDay) > 28 ? (
        <span className="text-xs text-muted-foreground">
          {t('billing.accounts.form.cycle.short_month_hint', 'Shorter months bill on their last day.')}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {interval ? summarize(spec) : t('billing.accounts.form.cycle.invalid_interval', 'Enter a whole number of units')}
        {previewNextBill
          ? ` · ${t('billing.accounts.form.cycle.next_bill', 'Next bill: {date}', { date: formatBillingDay(previewNextBill, locale) })}`
          : null}
      </span>
      {mode === 'edit' && stored && !values.nextBillDateOverride && previewNextBill && previewNextBill !== stored.nextBillDate ? (
        <span className="text-xs text-muted-foreground">
          {t(
            'billing.accounts.form.cycle.realign_hint',
            'The next bill moves to the new cycle day; that bill covers a shorter period and prorates recurring charges.',
          )}
        </span>
      ) : null}
      <label className="flex items-center gap-2">
        <Switch
          checked={values.nextBillDateOverride}
          onCheckedChange={(checked) =>
            onChange({
              nextBillDateOverride: checked,
              nextBillDate: checked ? values.nextBillDate || previewNextBill || '' : values.nextBillDate,
            })
          }
        />
        <span>{t('billing.accounts.form.cycle.override', 'Set the next bill date manually')}</span>
      </label>
      {values.nextBillDateOverride ? (
        <Input
          type="date"
          className="w-48"
          aria-label={t('billing.accounts.form.next_bill_date', 'Next bill date')}
          value={values.nextBillDate}
          onChange={(event) => onChange({ nextBillDate: event.currentTarget.value })}
        />
      ) : null}
    </div>
  )
}
