'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { chargeBillingPeriod, isDefaultBillingPeriod, toMonthlyEquivalent } from '../lib/chargeBillingPeriod'
import { billingPeriodSuffix } from '../lib/chargeBillingPeriodLabel'
import { formatMoney } from '../lib/formatMoney'

/**
 * A priced charge's total with its billing period (D5): "480,000.00 / year"
 * and, below it, the monthly equivalent that MRC totals use ("≈ 40,000.00 / month").
 * A monthly charge (or an NRC / usage charge) renders the plain total, as before.
 */
export function ChargePeriodTotal({
  charge,
  currency,
  amount,
  format = formatMoney,
}: {
  charge: { chargeType?: string | null; totalPrice?: number | null; billingPeriod?: unknown; note?: string | null }
  currency: string
  /** Amount to show; defaults to `charge.totalPrice`. */
  amount?: number | null
  format?: (value: number, currency: string) => string
}) {
  const t = useT()
  const value = amount !== undefined ? amount : charge.totalPrice ?? null
  if (value == null) return <>{charge.note ?? '—'}</>
  const period = chargeBillingPeriod(charge as Record<string, unknown>)
  if (charge.chargeType !== 'mrc' || isDefaultBillingPeriod(period)) return <>{format(value, currency)}</>
  return (
    <span className="inline-flex flex-col items-end">
      <span>{format(value, currency)} {billingPeriodSuffix(t, period)}</span>
      <span className="text-[10px] text-muted-foreground" title={t('cpq.billingPeriod.monthlyEquivalent.hint', 'Monthly equivalent used in MRC totals')}>
        {t('cpq.billingPeriod.monthlyEquivalent.value', '≈ {amount} / month', { amount: format(toMonthlyEquivalent(value, period), currency) })}
      </span>
    </span>
  )
}

export default ChargePeriodTotal
