"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CycleSpec } from '../../lib/billCycle'

/**
 * Human sentence for a bill cycle: "Monthly on day 15", "Every 30 days",
 * "Every 2 weeks on Monday". Used by the accounts list, the account view and
 * the form preview.
 */
export function useBillCycleSummary(): (spec: CycleSpec) => string {
  const t = useT()
  const weekday = React.useCallback(
    (code: string) => t(`billing.weekday.${code}`, code),
    [t],
  )
  return React.useCallback(
    (spec: CycleSpec) => {
      const count = spec.interval
      const many = count > 1 ? 'other' : 'one'
      const day = spec.day ?? ''
      switch (spec.cycle) {
        case 'daily':
          return many === 'one'
            ? t('billing.cycle.summary.daily.one', 'Daily')
            : t('billing.cycle.summary.daily.other', 'Every {count} days', { count })
        case 'weekly':
          return many === 'one'
            ? t('billing.cycle.summary.weekly.one', 'Weekly on {weekday}', { weekday: weekday(day) })
            : t('billing.cycle.summary.weekly.other', 'Every {count} weeks on {weekday}', { count, weekday: weekday(day) })
        case 'monthly':
          return many === 'one'
            ? t('billing.cycle.summary.monthly.one', 'Monthly on day {day}', { day })
            : t('billing.cycle.summary.monthly.other', 'Every {count} months on day {day}', { count, day })
        case 'annually':
          return many === 'one'
            ? t('billing.cycle.summary.annually.one', 'Yearly on day {day}', { day })
            : t('billing.cycle.summary.annually.other', 'Every {count} years on day {day}', { count, day })
      }
    },
    [t, weekday],
  )
}
