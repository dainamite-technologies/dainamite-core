"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../lib/displayDate'
import { lineServicePeriod } from '../lib/linePeriod'
import { creditReasonText, parseCreditReason } from '../lib/creditReason'

/**
 * Muted second lines under an invoice line's description: the service period
 * (when the description does not already carry it) and, on credit lines, the
 * customer-facing credit reason.
 */
export function InvoiceLineExtras({
  description,
  servicePeriodStart,
  servicePeriodEnd,
  metadata,
}: {
  description: string | null
  servicePeriodStart: string | null
  servicePeriodEnd: string | null
  metadata: Record<string, unknown> | null | undefined
}) {
  const t = useT()
  const locale = useLocale()
  const period = lineServicePeriod({ description, servicePeriodStart, servicePeriodEnd })
  const reason = parseCreditReason(metadata?.credit_reason)
  return (
    <>
      {period ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatBillingDay(period.start, locale)} – {formatBillingDay(period.end, locale)}
        </span>
      ) : null}
      {reason ? (
        <span className="text-xs text-muted-foreground">
          {t('billing.invoices.lines.credit_reason', 'Reason')}: {creditReasonText(reason, t, (day) => formatBillingDay(day, locale))}
        </span>
      ) : null}
    </>
  )
}
