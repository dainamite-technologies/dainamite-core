'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatMoney } from '../../../../../lib/formatMoney'
import { lineTypeTotals } from '../../../../../lib/priceAdjustmentView'
import { pricedByText, scheduleText, type DialogLine, type StoredRow } from '../../../../../lib/priceDialogView'

/**
 * Current prices (§3.1): the line's non-usage charges (the whole bundle for a
 * bundle parent) with list, standard, offer, quantity, total and what prices
 * each one, a one-line schedule under a phased charge, then the MRC / NRC totals.
 * The data is already on the quote: no extra call.
 */
export function CurrentPricesTable({ rootLineId, bundle, rows, currency }: {
  rootLineId: string
  bundle: DialogLine[]
  rows: StoredRow[]
  currency: string
}) {
  const t = useT()
  const money = (value: number | null | undefined) => (value == null ? '—' : formatMoney(value, currency))
  const totals = bundle.reduce((sum, line) => ({
    mrc: sum.mrc + lineTypeTotals(line, 'mrc').offer,
    nrc: sum.nrc + lineTypeTotals(line, 'nrc').offer,
  }), { mrc: 0, nrc: 0 })
  return (
    <section className="space-y-1" data-testid="cpq-current-prices">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('cpq.priceDialog.current.title', 'Current prices')}</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-medium">{t('cpq.priceDialog.current.charge', 'Charge')}</th>
            <th className="py-1 text-left font-medium">{t('cpq.priceDialog.current.type', 'Type')}</th>
            <th className="py-1 text-right font-medium">{t('cpq.priceDialog.current.list', 'List')}</th>
            <th className="py-1 text-right font-medium">{t('cpq.priceDialog.current.standard', 'Standard')}</th>
            <th className="py-1 text-right font-medium">{t('cpq.priceDialog.current.offer', 'Offer')}</th>
            <th className="py-1 text-right font-medium">{t('cpq.priceDialog.current.quantity', 'Qty')}</th>
            <th className="py-1 text-right font-medium">{t('cpq.priceDialog.current.total', 'Total')}</th>
            <th className="py-1 pl-4 text-left font-medium">{t('cpq.priceDialog.current.pricedBy', 'Priced by')}</th>
          </tr>
        </thead>
        <tbody>
          {bundle.flatMap((line) => line.charges.filter((charge) => charge.chargeType !== 'usage').map((charge) => {
            const schedule = charge.schedule?.length ? scheduleText(t, charge.schedule, line.termMonths) : null
            return (
              <React.Fragment key={`${line.lineId}:${charge.chargeCode}`}>
                <tr className="border-t" data-testid="cpq-current-price-row">
                  <td className="py-1 pr-2">
                    {line.lineId !== rootLineId && <span className="text-muted-foreground">{line.offeringName} · </span>}
                    {charge.chargeName}
                  </td>
                  <td className="py-1 pr-2">{charge.chargeType === 'mrc' ? t('cpq.lines.mrc', 'MRC') : t('cpq.lines.nrc', 'NRC')}</td>
                  <td className="py-1 text-right font-mono">{money(charge.listUnitPrice ?? charge.standardUnitPrice ?? charge.unitPrice)}</td>
                  <td className="py-1 text-right font-mono">{money(charge.standardUnitPrice ?? charge.unitPrice)}</td>
                  <td className="py-1 text-right font-mono">{money(charge.unitPrice)}</td>
                  <td className="py-1 text-right font-mono">{charge.quantity ?? 1}</td>
                  <td className="py-1 text-right font-mono">{money(charge.totalPrice)}</td>
                  <td className="py-1 pl-4" data-testid="cpq-current-priced-by">{pricedByText(t, charge, rootLineId, rows)}</td>
                </tr>
                {schedule && (
                  <tr>
                    <td colSpan={8} className="pb-1 pl-3 text-muted-foreground" data-testid="cpq-current-schedule">{schedule}</td>
                  </tr>
                )}
              </React.Fragment>
            )
          }))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="py-1" colSpan={8}>
              {t('cpq.priceDialog.current.totals', 'Line totals')}
              <span className="ml-4">{t('cpq.lines.mrc', 'MRC')} <span className="font-mono">{money(totals.mrc)}</span></span>
              <span className="ml-4">{t('cpq.lines.nrc', 'NRC')} <span className="font-mono">{money(totals.nrc)}</span></span>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
