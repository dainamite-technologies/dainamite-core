'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import type { StoredRow } from '../../../../../lib/priceDialogView'
import { PriceAdjustmentsTable } from '../../../../../components/PriceAdjustmentsTable'

export const ORDER_PRICE_ADJUSTMENTS_SPOT_ID = 'data-table:cpq.order_price_adjustments'

export type OrderPriceAdjustment = StoredRow & { reasonLabel?: string | null }
/** Stored order charges are jsonb copies: code and name may be missing on old rows. */
type LineRef = { lineId: string; sourceQuoteLineId: string | null; offeringName: string; charges: Array<{ chargeCode?: unknown; chargeName?: string }> }

/**
 * The source quote's negotiated prices on the order (D8): the quote panel's
 * table, read-only (frozen once the quote is converted). Rows point at quote
 * lines, matched to the order lines by `sourceQuoteLineId`. Hidden when the
 * order has no adjustments.
 */
export function OrderPriceAdjustmentsPanel({ orderId, adjustments, lines }: { orderId: string; adjustments: OrderPriceAdjustment[]; lines: LineRef[] }) {
  const t = useT()
  const quoteLines = React.useMemo(() => lines.map((line) => ({ lineId: line.sourceQuoteLineId ?? line.lineId, offeringName: line.offeringName,
    charges: line.charges.map((charge) => ({ chargeCode: String(charge.chargeCode ?? ''), chargeName: charge.chargeName ?? String(charge.chargeCode ?? '') })) })), [lines])
  if (!adjustments.length) return null
  return (
    <div className="mt-4 rounded-lg border bg-card" data-testid="cpq-order-price-adjustments-panel">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">
          {t('cpq.priceAdjustments.panel.title', 'Price adjustments')}
          <span className="ml-2 text-xs text-muted-foreground">{adjustments.length}</span>
        </h3>
        <p className="text-xs text-muted-foreground">{t('cpq.priceDialog.order.hint', 'Negotiated on the source quote; frozen when it was converted.')}</p>
      </div>
      <PriceAdjustmentsTable rows={adjustments} lines={quoteLines} reasonLabel={(row) => (row as OrderPriceAdjustment).reasonLabel ?? row.reasonCode} />
      <InjectionSpot spotId={ORDER_PRICE_ADJUSTMENTS_SPOT_ID} context={{ orderId, adjustments }} />
    </div>
  )
}
