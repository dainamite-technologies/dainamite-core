/**
 * Display labels for a charge billing period (D5): "/ year", "every 3 months".
 * Takes the page's `t` so it stays usable from any client component.
 */
import { chargeBillingPeriod, normalizeBillingPeriod, type ChargeBillingPeriod } from './chargeBillingPeriod'

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

type Translate = TranslateFn

/** Price suffix: "/ month", "/ year", "/ 3 months", "/ 2 years". */
export function billingPeriodSuffix(t: Translate, period: ChargeBillingPeriod): string {
  if (period.interval === 1) {
    return period.unit === 'year'
      ? t('cpq.billingPeriod.suffix.year', '/ year')
      : t('cpq.billingPeriod.suffix.month', '/ month')
  }
  return period.unit === 'year'
    ? t('cpq.billingPeriod.suffix.years', '/ {count} years', { count: period.interval })
    : t('cpq.billingPeriod.suffix.months', '/ {count} months', { count: period.interval })
}

/** Field value: "Every month", "Every 2 years". */
export function billingPeriodLabel(t: Translate, period: ChargeBillingPeriod): string {
  if (period.interval === 1) {
    return period.unit === 'year'
      ? t('cpq.billingPeriod.every.year', 'Every year')
      : t('cpq.billingPeriod.every.month', 'Every month')
  }
  return period.unit === 'year'
    ? t('cpq.billingPeriod.every.years', 'Every {count} years', { count: period.interval })
    : t('cpq.billingPeriod.every.months', 'Every {count} months', { count: period.interval })
}

/** Suffix for a catalog charge row (entity columns). */
export function catalogChargePeriodSuffix(
  t: Translate,
  charge: { chargeType?: string | null; billingPeriodUnit?: string | null; billingPeriodInterval?: number | null },
): string {
  if (charge.chargeType !== 'mrc') return ''
  return billingPeriodSuffix(t, normalizeBillingPeriod(charge))
}

/** Suffix for a priced (resolved) MRC charge; empty for NRC / usage. */
export function resolvedChargePeriodSuffix(t: Translate, charge: { chargeType?: string | null; billingPeriod?: unknown }): string {
  if (charge.chargeType !== 'mrc') return ''
  return billingPeriodSuffix(t, chargeBillingPeriod(charge))
}
