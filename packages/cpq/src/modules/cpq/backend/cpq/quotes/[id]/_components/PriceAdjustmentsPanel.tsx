'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import type { StoredRow } from '../../../../../lib/priceDialogView'
import { PriceAdjustmentsTable } from '../../../../../components/PriceAdjustmentsTable'
import { ManualAdjustmentActions, useAccessReasonText, usePriceAdjustmentUi } from './priceAdjustmentContext'

export const PRICE_ADJUSTMENTS_SPOT_ID = 'data-table:cpq.quote_price_adjustments'

/** A stored adjustment as the list GET returns it (with its author, D7). */
export type StoredAdjustment = StoredRow

type LineRef = { lineId: string; offeringName: string; offeringId: string | null; configuration?: Record<string, unknown> | null; charges: Array<{ chargeCode: string; chargeName: string }> }

/**
 * The quote's Price adjustments panel (§4.2): one row per target with author
 * names. Edit opens the Price dialog on that target; Delete removes the whole
 * target (on a locked quote: only its invalid rows).
 */
export function PriceAdjustmentsPanel({ quoteId, items, total, lines, errorsById }: {
  quoteId: string
  items: StoredAdjustment[]
  total: number
  lines: LineRef[]
  /** Kept for callers; amounts are formatted from the rows. */
  currency?: string
  /** adjustmentId → first error code reported by the latest pricing. */
  errorsById: Map<string, string>
}) {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  const accessText = useAccessReasonText()
  // Toggle off: stored adjustments still price the quote, so keep them visible (read-only).
  if (!ui || (ui.access.reason === 'disabled' && items.length === 0)) return null

  return (
    <div className="rounded-lg border bg-card" data-testid="cpq-price-adjustments-panel">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-medium">
          {t('cpq.priceAdjustments.panel.title', 'Price adjustments')}
          <span className="ml-2 text-xs text-muted-foreground">{total}</span>
        </h3>
        {accessText && ui.access.reason !== 'loading' && (
          <span className="text-xs text-muted-foreground" data-testid="cpq-price-adjustments-locked">{accessText}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {t('cpq.priceAdjustments.panel.emptyPercent', 'No negotiated prices yet. Use the % button on a line or on a charge.')}
        </p>
      ) : (
        <PriceAdjustmentsTable
          rows={items}
          lines={lines}
          reasonLabel={(row) => ui.reasonLabels[row.reasonCode] ?? row.reasonCode}
          errorsById={errorsById}
          renderActions={(group) => {
            // Delete on a locked quote targets the invalid rows only; the action decides per row.
            const anchor = group.rows.find((row) => errorsById.has(row.id)) ?? group.rows[0]
            return <ManualAdjustmentActions adjustmentId={anchor.id} />
          }}
        />
      )}
      <InjectionSpot spotId={PRICE_ADJUSTMENTS_SPOT_ID} context={{ quoteId, adjustments: items }} />
    </div>
  )
}
