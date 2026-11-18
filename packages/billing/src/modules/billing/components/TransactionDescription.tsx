"use client"

import * as React from 'react'
import { transactionServicePeriod } from '../lib/linePeriod'
import { formatDateOnly } from '../lib/dateOnly'

/**
 * Description cell for balance-transaction lists: the stored description plus,
 * for recurring charges, the service period as a muted second line in the
 * viewer's locale (skipped when the description already carries the dates).
 */
export function TransactionDescription({
  description,
  metadata,
}: {
  description: string
  metadata: Record<string, unknown> | null | undefined
}) {
  const period = transactionServicePeriod({ description, metadata })
  return (
    <span className="flex flex-col">
      <span className="text-sm">{description}</span>
      {period ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDateOnly(period.start)} – {formatDateOnly(period.end)}
        </span>
      ) : null}
    </span>
  )
}
