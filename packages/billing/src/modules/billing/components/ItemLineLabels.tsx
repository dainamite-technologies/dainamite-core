"use client"
import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { formatBillingDay } from '../lib/displayDate'
import type { ItemStatus } from '../lib/itemStatusPeriods'
import type { PhasePriceType } from '../lib/pricePhases'
import {
  currentPhasePill,
  currentStatusPill,
  ownBillingPeriod,
  type ItemStatusPill,
  type OwnPeriodUnit,
  type PhaseRow,
  type StatusPeriodRow,
} from '../lib/itemStatusLabel'

/**
 * Translated labels + pills for a billing line's own period, price phase and
 * status (line-period-and-status spec §4.2–4.3, price-phases spec §4.1). The
 * pure "what to show" lives in `lib/itemStatusLabel.ts`.
 */

type Translate = ReturnType<typeof useT>

export function statusName(t: Translate, status: ItemStatus | string): string {
  switch (status) {
    case 'paused':
      return t('billing.items.status.paused', 'Paused')
    case 'suspended':
      return t('billing.items.status.suspended', 'Suspended')
    case 'grace':
      return t('billing.items.status.grace', 'Grace period')
    default:
      return String(status)
  }
}

export function statusVariant(status: ItemStatus | string): 'warning' | 'error' | 'info' {
  if (status === 'suspended') return 'error'
  if (status === 'grace') return 'info'
  return 'warning'
}

/** "every 1 year", "every 3 months" … */
export function periodLabel(t: Translate, unit: OwnPeriodUnit, count: number): string {
  switch (unit) {
    case 'day':
      return count === 1 ? t('billing.items.period.every_day', 'every 1 day') : t('billing.items.period.every_days', 'every {count} days', { count })
    case 'week':
      return count === 1 ? t('billing.items.period.every_week', 'every 1 week') : t('billing.items.period.every_weeks', 'every {count} weeks', { count })
    case 'month':
      return count === 1 ? t('billing.items.period.every_month', 'every 1 month') : t('billing.items.period.every_months', 'every {count} months', { count })
    case 'year':
      return count === 1 ? t('billing.items.period.every_year', 'every 1 year') : t('billing.items.period.every_years', 'every {count} years', { count })
  }
}

/** Own billing period of a line, or "Same as account". */
export function ownPeriodText(t: Translate, unit: string | null | undefined, interval: number | string | null | undefined): string {
  const own = ownBillingPeriod(unit, interval)
  return own ? periodLabel(t, own.unit, own.count) : t('billing.items.period.same_as_account', 'Same as account')
}

/** "Free", "12.50 EUR", "20% off", "5 EUR off". */
export function phasePriceLabel(
  t: Translate,
  priceType: PhasePriceType,
  value: number | null,
  currencyCode?: string | null,
): string {
  const amount = `${value ?? 0}${currencyCode ? ` ${currencyCode}` : ''}`
  switch (priceType) {
    case 'free':
      return t('billing.items.phases.price.free', 'Free')
    case 'fixed':
      return amount
    case 'percent_off':
      return t('billing.items.phases.price.percent_off_value', '{value}% off', { value: value ?? 0 })
    case 'amount_off':
      return t('billing.items.phases.price.amount_off_value', '{amount} off', { amount })
  }
}

export function phaseDisplayName(t: Translate, name: string | null, index: number, priceType: PhasePriceType): string {
  if (name) return name
  if (priceType === 'free') return t('billing.items.phases.default_name_free', 'Free period')
  return t('billing.items.phases.default_name', 'Phase {n}', { n: index + 1 })
}

export function useStatusPillText(): (pill: ItemStatusPill) => string {
  const t = useT()
  const locale = useLocale()
  return React.useCallback(
    (pill: ItemStatusPill) => {
      if (!pill.until) return statusName(t, pill.status)
      const date = formatBillingDay(pill.until, locale)
      switch (pill.status) {
        case 'paused':
          return t('billing.items.status.paused_until', 'Paused until {date}', { date })
        case 'suspended':
          return t('billing.items.status.suspended_until', 'Suspended until {date}', { date })
        case 'grace':
          return t('billing.items.status.grace_until', 'Grace period until {date}', { date })
      }
    },
    [locale, t],
  )
}

/** Service status pill (status in force today), or nothing when the line is active. */
export function ItemStatusTag({ periods, today }: { periods: readonly StatusPeriodRow[] | null | undefined; today: string }) {
  const t = useT()
  const text = useStatusPillText()
  const pill = currentStatusPill(periods, today)
  if (!pill) return null
  return (
    <Tag variant={statusVariant(pill.status)}>
      {text(pill)}
      {pill.noCharge ? ` · ${t('billing.items.status.no_charge_short', 'not charged')}` : ''}
    </Tag>
  )
}

/** Current (or first upcoming) price phase pill, e.g. "Free trial until 13 Dec". */
export function ItemPhaseTag({
  phases,
  phasesEnabled,
  today,
}: {
  phases: readonly PhaseRow[] | null | undefined
  phasesEnabled: boolean | null | undefined
  today: string
}) {
  const t = useT()
  const locale = useLocale()
  const pill = currentPhasePill(phases, phasesEnabled, today)
  if (!pill) return null
  const name = phaseDisplayName(t, pill.name, pill.index, pill.priceType)
  const date = formatBillingDay(pill.endDate, locale)
  return (
    <Tag variant="brand">
      {pill.upcoming
        ? t('billing.items.phases.pill_upcoming', '{name} from start, until {date}', { name, date })
        : t('billing.items.phases.pill_current', '{name} until {date}', { name, date })}
    </Tag>
  )
}
