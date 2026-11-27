'use client'

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { ADJUSTMENT_ERROR_FALLBACKS } from '../lib/priceAdjustmentView'
import { authorText, groupByTarget, groupSummary, kindOfTarget, targetName, type PanelGroup, type StoredRow } from '../lib/priceDialogView'

type LineRef = { lineId: string; offeringName: string; charges: Array<{ chargeCode: string; chargeName: string }> }

/**
 * Negotiated prices, one row per target (§4.2 / §4.3): what is set (a phased
 * target reads "2 phases: Free trial (month 1) → …"), the reason, and the
 * author (name, else email; the id in the tooltip, D7) and date of the set's
 * latest change. Shared by the quote panel (with actions) and the read-only
 * order panel.
 */
export function PriceAdjustmentsTable({ rows, lines, reasonLabel, errorsById, renderActions }: {
  rows: StoredRow[]
  lines: LineRef[]
  reasonLabel: (row: StoredRow) => string
  /** adjustmentId → first error code reported by the latest pricing. */
  errorsById?: Map<string, string>
  renderActions?: (group: PanelGroup) => React.ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  const lineById = React.useMemo(() => new Map(lines.map((line) => [line.lineId, line])), [lines])
  const groups = React.useMemo(() => groupByTarget(rows), [rows])
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="px-4 py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.target', 'Applies to')}</th>
          <th className="py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.price', 'Price')}</th>
          <th className="py-1.5 pl-4 text-left font-medium">{t('cpq.priceAdjustments.panel.reason', 'Reason')}</th>
          <th className="py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.author', 'Author')}</th>
          <th className="py-1.5 text-left font-medium">{t('cpq.priceAdjustments.panel.date', 'Date')}</th>
          {renderActions && <th className="w-16" />}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const line = lineById.get(group.target.quoteLineId)
          const chargeName = group.target.level === 'charge'
            ? line?.charges.find((charge) => group.target.level === 'charge' && charge.chargeCode === group.target.chargeCode)?.chargeName
            : undefined
          const errors = [...new Set(group.rows.map((row) => errorsById?.get(row.id)).filter((code): code is string => !!code))]
          const reasons = [...new Set(group.rows.map(reasonLabel))]
          const notes = [...new Set(group.rows.map((row) => row.reasonNote?.trim()).filter(Boolean))]
          return (
            <tr key={group.key} className="border-t align-top" data-testid="cpq-price-adjustment-row">
              <td className="px-4 py-1.5">
                <span className="font-medium">{line?.offeringName ?? t('cpq.priceAdjustments.panel.removedLine', 'Removed line')}</span>
                <span className="text-muted-foreground"> · {targetName(t, { kind: kindOfTarget(group.target), target: group.target, chargeName })}</span>
                {errors.map((code) => (
                  <Tag key={code} variant="warning" className="ml-1.5 px-1.5 text-xs">
                    {t('cpq.priceAdjustments.invalid', 'Invalid')}: {t(`cpq.priceAdjustments.errors.${code}`, ADJUSTMENT_ERROR_FALLBACKS[code] ?? code)}
                  </Tag>
                ))}
              </td>
              <td className="py-1.5" data-testid="cpq-price-adjustment-summary">{groupSummary(t, group.rows)}</td>
              <td className="py-1.5 pl-4">
                {reasons.join(', ')}
                {notes.map((note) => <span key={note} className="block text-muted-foreground">{note}</span>)}
              </td>
              <td className="py-1.5 text-muted-foreground" title={group.latest.createdByUserId} data-testid="cpq-price-adjustment-author">{authorText(group.latest)}</td>
              <td className="py-1.5 text-muted-foreground">{formatDisplayDate(group.latest.updatedAt ?? group.latest.createdAt, locale) ?? '—'}</td>
              {renderActions && <td className="py-1.5 pr-2 text-right">{renderActions(group)}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
