"use client"

import * as React from 'react'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import { localizeDescriptionPeriod, transactionServicePeriod } from '../lib/linePeriod'
import { formatBillingDay } from '../lib/displayDate'

/**
 * Description cell for balance-transaction lists: the stored description (its
 * dated suffix localized, #129) plus, for recurring charges, the service
 * period as a muted second line in the app locale (#130; skipped when the
 * description already carries the dates).
 */
export function TransactionDescription({
  description,
  metadata,
}: {
  description: string
  metadata: Record<string, unknown> | null | undefined
}) {
  const locale = useLocale()
  const formatDay = (day: Date | string) => formatBillingDay(day, locale)
  const period = transactionServicePeriod({ description, metadata })
  return (
    <span className="flex flex-col">
      <span className="text-sm">{localizeDescriptionPeriod(description, formatDay)}</span>
      {period ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDay(period.start)} – {formatDay(period.end)}
        </span>
      ) : null}
    </span>
  )
}
